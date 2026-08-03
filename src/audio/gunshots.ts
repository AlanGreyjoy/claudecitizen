import { getSfxAudioGraph, type SfxAudioGraph } from './sfx';

/**
 * Procedural firearm SFX. Weapons carry optional authored samples on their
 * `weapon-combat` component; when a slot is empty this synthesises the shot so
 * every weapon in the catalog is audible without shipping 60+ audio files.
 *
 * First-person shots are centred (no panner): the muzzle is at the listener, so
 * HRTF positioning would only smear the transient. Impacts are non-spatial too
 * — the shooter always fires down camera forward, so the only physically
 * meaningful cues are travel delay and distance attenuation, and those stay
 * correct in every listener space (world / station-local / ship-local).
 */

export type ImpactSurface = 'terrain' | 'station' | 'ship';

export interface GunshotTone {
  /** Low-end thump centre frequency. */
  bodyHz: number;
  /** Bandpassed transient centre frequency. */
  crackHz: number;
  /** Peak output gain, pre master/SFX volume. */
  gain: number;
  /** Reflected tail length in seconds. */
  tailSeconds: number;
}

export interface GunshotWeaponStats {
  muzzleVelocityMps: number;
  roundsPerMinute: number;
}

interface ActiveVoice {
  nodes: AudioNode[];
  sources: AudioScheduledSourceNode[];
}

interface BurstParams {
  graph: SfxAudioGraph;
  at: number;
  centerHz: number;
  decaySeconds: number;
  filterType: BiquadFilterType;
  gain: number;
  q: number;
  rate: number;
  voice: ActiveVoice;
}

interface ToneParams {
  graph: SfxAudioGraph;
  at: number;
  decaySeconds: number;
  endHz: number;
  gain: number;
  startHz: number;
  voice: ActiveVoice;
}

const SPEED_OF_SOUND_MPS = 343;
const MAX_ACTIVE_VOICES = 18;
const MAX_IMPACT_DELAY_SECONDS = 1.5;
const NOISE_SECONDS = 1;

const noiseBuffers = new WeakMap<BaseAudioContext, AudioBuffer>();
const activeVoices = new Set<ActiveVoice>();

function clamp01(value: number): number {
  return Math.max(0, Math.min(1, value));
}

function lerp(a: number, b: number, t: number): number {
  return a + (b - a) * t;
}

/** Deterministic per-shot jitter so sustained auto fire never sounds looped. */
function variation01(shotIndex: number): number {
  let value = Math.imul(shotIndex + 1, 0x9e3779b1) >>> 0;
  value ^= value >>> 16;
  value = Math.imul(value, 0x21f0aaad);
  value ^= value >>> 15;
  return (value >>> 0) / 4_294_967_296;
}

function noiseBuffer(context: BaseAudioContext): AudioBuffer {
  const cached = noiseBuffers.get(context);
  if (cached) return cached;
  const buffer = context.createBuffer(
    1,
    Math.ceil(context.sampleRate * NOISE_SECONDS),
    context.sampleRate,
  );
  const samples = buffer.getChannelData(0);
  let state = 0x6d2b79f5;
  for (let index = 0; index < samples.length; index += 1) {
    state ^= state << 13;
    state ^= state >>> 17;
    state ^= state << 5;
    samples[index] = ((state >>> 0) / 2_147_483_648) - 1;
  }
  noiseBuffers.set(context, buffer);
  return buffer;
}

function endVoice(voice: ActiveVoice): void {
  if (!activeVoices.delete(voice)) return;
  for (const source of voice.sources) {
    try {
      source.stop();
    } catch {
      // The source may already have ended.
    }
    source.disconnect();
  }
  for (const node of voice.nodes) node.disconnect();
  voice.sources.length = 0;
  voice.nodes.length = 0;
}

/** Bounded polyphony: sustained auto fire must not accumulate Web Audio nodes. */
function beginVoice(): ActiveVoice {
  if (activeVoices.size >= MAX_ACTIVE_VOICES) {
    const oldest = activeVoices.values().next().value;
    if (oldest) endVoice(oldest);
  }
  const voice: ActiveVoice = { nodes: [], sources: [] };
  activeVoices.add(voice);
  return voice;
}

function finishVoiceAt(voice: ActiveVoice, longest: AudioScheduledSourceNode): void {
  longest.addEventListener('ended', () => endVoice(voice));
}

function decayEnvelope(
  graph: SfxAudioGraph,
  at: number,
  peak: number,
  decaySeconds: number,
): GainNode {
  const gain = graph.context.createGain();
  gain.gain.setValueAtTime(0.0001, at);
  gain.gain.linearRampToValueAtTime(peak, at + 0.0015);
  gain.gain.exponentialRampToValueAtTime(0.0001, at + decaySeconds);
  return gain;
}

/** Filtered white-noise burst — the crack, the tail, and mechanical clicks. */
function scheduleBurst(params: BurstParams): AudioBufferSourceNode {
  const { graph, at, voice } = params;
  const source = graph.context.createBufferSource();
  source.buffer = noiseBuffer(graph.context);
  source.playbackRate.value = params.rate;
  const filter = graph.context.createBiquadFilter();
  filter.type = params.filterType;
  filter.frequency.value = params.centerHz;
  filter.Q.value = params.q;
  const envelope = decayEnvelope(graph, at, params.gain, params.decaySeconds);
  source.connect(filter).connect(envelope).connect(graph.bus);
  source.start(at, (at * 7.13) % (NOISE_SECONDS * 0.5));
  source.stop(at + params.decaySeconds + 0.02);
  voice.sources.push(source);
  voice.nodes.push(filter, envelope);
  return source;
}

/** Pitched body: the chest thump under the crack, and metal ring on impacts. */
function scheduleTone(params: ToneParams): OscillatorNode {
  const { graph, at, voice } = params;
  const osc = graph.context.createOscillator();
  osc.type = 'sine';
  osc.frequency.setValueAtTime(params.startHz, at);
  osc.frequency.exponentialRampToValueAtTime(params.endHz, at + params.decaySeconds);
  const envelope = decayEnvelope(graph, at, params.gain, params.decaySeconds);
  osc.connect(envelope).connect(graph.bus);
  osc.start(at);
  osc.stop(at + params.decaySeconds + 0.02);
  voice.sources.push(osc);
  voice.nodes.push(envelope);
  return osc;
}

/**
 * Resolve a running graph, nudging a suspended context awake. A suspended
 * context drops the current shot rather than queueing it — a backlog of stale
 * gunshots firing on resume is worse than one silent round.
 */
function runningGraph(): SfxAudioGraph | null {
  const graph = getSfxAudioGraph();
  if (!graph) return null;
  if (graph.context.state !== 'running') {
    void graph.context.resume().catch(() => undefined);
    return null;
  }
  return graph;
}

/**
 * Derive timbre from the same stats that drive ballistics, so a bolt-action
 * magnum booms and an SMG snaps without any per-weapon audio authoring.
 */
export function gunshotToneForWeapon(stats: GunshotWeaponStats): GunshotTone {
  const cadence01 = clamp01((stats.roundsPerMinute - 60) / 840);
  const power01 = clamp01((stats.muzzleVelocityMps - 250) / 850);
  return {
    bodyHz: lerp(52, 124, cadence01 * 0.7 + power01 * 0.3),
    crackHz: lerp(1_250, 3_100, cadence01 * 0.55 + power01 * 0.45),
    // Fast weapons overlap many voices; trim per-shot gain to keep headroom.
    gain: lerp(0.5, 0.24, cadence01),
    tailSeconds: lerp(0.52, 0.16, cadence01 * 0.6 + (1 - power01) * 0.4),
  };
}

export function playGunshot(params: {
  tone: GunshotTone;
  shotIndex: number;
}): void {
  const graph = runningGraph();
  if (!graph) return;
  const { tone } = params;
  const jitter = variation01(params.shotIndex);
  const at = graph.context.currentTime;
  const voice = beginVoice();
  const detune = 0.94 + jitter * 0.12;

  scheduleBurst({
    graph,
    at,
    centerHz: tone.crackHz * detune,
    decaySeconds: 0.045,
    filterType: 'bandpass',
    gain: tone.gain,
    q: 1.1,
    rate: detune,
    voice,
  });
  scheduleTone({
    graph,
    at,
    decaySeconds: 0.085,
    endHz: tone.bodyHz * 0.6,
    gain: tone.gain * 0.85,
    startHz: tone.bodyHz * 2.4 * detune,
    voice,
  });
  const tail = scheduleBurst({
    graph,
    at: at + 0.012,
    centerHz: tone.crackHz * 0.4,
    decaySeconds: tone.tailSeconds,
    filterType: 'lowpass',
    gain: tone.gain * 0.3,
    q: 0.5,
    rate: 0.8 + jitter * 0.1,
    voice,
  });
  // Action cycling under the report.
  scheduleBurst({
    graph,
    at: at + 0.03,
    centerHz: 4_200,
    decaySeconds: 0.03,
    filterType: 'bandpass',
    gain: tone.gain * 0.16,
    q: 2.2,
    rate: 1.1,
    voice,
  });
  finishVoiceAt(voice, tail);
}

/** Firing pin on an empty chamber: dry mechanical click, no report. */
export function playDryFireSound(): void {
  const graph = runningGraph();
  if (!graph) return;
  const at = graph.context.currentTime;
  const voice = beginVoice();
  const click = scheduleBurst({
    graph,
    at,
    centerHz: 3_400,
    decaySeconds: 0.05,
    filterType: 'bandpass',
    gain: 0.3,
    q: 3,
    rate: 1,
    voice,
  });
  finishVoiceAt(voice, click);
}

/** Magazine out / magazine in / bolt release, spread over the reload window. */
export function playReloadSound(): void {
  const graph = runningGraph();
  if (!graph) return;
  const at = graph.context.currentTime;
  const voice = beginVoice();
  scheduleBurst({
    graph,
    at,
    centerHz: 1_900,
    decaySeconds: 0.09,
    filterType: 'bandpass',
    gain: 0.26,
    q: 1.6,
    rate: 0.9,
    voice,
  });
  scheduleBurst({
    graph,
    at: at + 0.42,
    centerHz: 2_600,
    decaySeconds: 0.07,
    filterType: 'bandpass',
    gain: 0.3,
    q: 2,
    rate: 1.05,
    voice,
  });
  const bolt = scheduleBurst({
    graph,
    at: at + 0.72,
    centerHz: 3_800,
    decaySeconds: 0.06,
    filterType: 'bandpass',
    gain: 0.24,
    q: 2.6,
    rate: 1.15,
    voice,
  });
  finishVoiceAt(voice, bolt);
}

interface ImpactProfile {
  centerHz: number;
  decaySeconds: number;
  filterType: BiquadFilterType;
  q: number;
  ringHz: number;
  ringGain: number;
}

const IMPACT_PROFILES: Record<ImpactSurface, ImpactProfile> = {
  terrain: {
    centerHz: 620,
    decaySeconds: 0.12,
    filterType: 'lowpass',
    q: 0.7,
    ringHz: 0,
    ringGain: 0,
  },
  station: {
    centerHz: 2_700,
    decaySeconds: 0.09,
    filterType: 'bandpass',
    q: 1.5,
    ringHz: 1_850,
    ringGain: 0.16,
  },
  ship: {
    centerHz: 2_400,
    decaySeconds: 0.08,
    filterType: 'bandpass',
    q: 1.7,
    ringHz: 1_620,
    ringGain: 0.14,
  },
};

/**
 * Impact heard from the shooter's position: delayed by bullet flight plus the
 * return trip of the sound, and attenuated with distance.
 */
export function playBulletImpact(params: {
  distanceMeters: number;
  muzzleVelocityMps: number;
  shotIndex: number;
  surface: ImpactSurface;
}): void {
  const graph = runningGraph();
  if (!graph) return;
  const distance = Math.max(0, params.distanceMeters);
  const flightSeconds =
    params.muzzleVelocityMps > 0 ? distance / params.muzzleVelocityMps : 0;
  const delaySeconds = Math.min(
    MAX_IMPACT_DELAY_SECONDS,
    flightSeconds + distance / SPEED_OF_SOUND_MPS,
  );
  const attenuation = 1 / (1 + distance * 0.11);
  if (attenuation < 0.02) return;

  const profile = IMPACT_PROFILES[params.surface];
  const jitter = variation01(params.shotIndex ^ 0x5bf03635);
  const at = graph.context.currentTime + delaySeconds;
  const voice = beginVoice();
  // Distance rolls off the high end before it rolls off the level.
  const centerHz = profile.centerHz * lerp(1, 0.45, clamp01(distance / 60));

  const body = scheduleBurst({
    graph,
    at,
    centerHz: centerHz * (0.9 + jitter * 0.2),
    decaySeconds: profile.decaySeconds,
    filterType: profile.filterType,
    gain: 0.34 * attenuation,
    q: profile.q,
    rate: 0.9 + jitter * 0.2,
    voice,
  });
  if (profile.ringGain > 0) {
    scheduleTone({
      graph,
      at,
      decaySeconds: profile.decaySeconds * 1.6,
      endHz: profile.ringHz * 0.75,
      gain: profile.ringGain * attenuation,
      startHz: profile.ringHz * (0.92 + jitter * 0.16),
      voice,
    });
  }
  finishVoiceAt(voice, body);
}

/** Drop every scheduled voice — scene teardown, reset, and pause. */
export function stopAllGunshotVoices(): void {
  for (const voice of [...activeVoices]) endVoice(voice);
}
