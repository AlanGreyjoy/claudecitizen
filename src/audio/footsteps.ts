import type { Vec3 } from '../types';
import {
  getSfxAudioGraph,
  setSfxListenerPose,
  type SfxAudioGraph,
  type SfxListenerPose,
} from './sfx';

export type FootstepGait = 'walk' | 'sprint';
export type FootstepSurface = 'terrain' | 'metal';

export interface FootstepActor {
  id: string;
  position: Vec3;
  grounded: boolean;
  gait: FootstepGait | null;
  surface: FootstepSurface;
  /** Local-player steps stay centered; other characters use HRTF positioning. */
  spatial: boolean;
  volume01?: number;
}

export interface FootstepController {
  update(
    dtSeconds: number,
    listener: SfxListenerPose,
    actors: readonly FootstepActor[],
  ): void;
  reset(): void;
  dispose(): void;
}

interface ActorState {
  gait: FootstepGait | null;
  position: Vec3;
  stepIndex: number;
  timeUntilStepSeconds: number;
}

interface ActiveVoice {
  finished: boolean;
  nodes: AudioNode[];
  sources: Array<AudioBufferSourceNode | OscillatorNode>;
}

interface SurfaceProfile {
  durationSeconds: number;
  filterFrequencyHz: number;
  filterQ: number;
  filterType: BiquadFilterType;
  impactFrequencyHz: number;
  noiseGain: number;
  outputGain: number;
}

interface ActorAdvanceContext {
  dtSeconds: number;
  listener: SfxListenerPose;
  resolveGraph: () => SfxAudioGraph | null;
  activeVoices: Set<ActiveVoice>;
}

const MAX_SPATIAL_DISTANCE_METERS = 32;
const MAX_FRAME_DT_SECONDS = 0.1;
const MAX_CONTINUOUS_MOVE_METERS = 3;
const MIN_FRAME_MOVE_METERS = 0.001;
const NOISE_VARIANT_COUNT = 8;
const WALK_INTERVAL_SECONDS = 0.44;
const SPRINT_INTERVAL_SECONDS = 0.29;

const SURFACE_PROFILES: Record<FootstepSurface, SurfaceProfile> = {
  terrain: {
    durationSeconds: 0.16,
    filterFrequencyHz: 900,
    filterQ: 0.7,
    filterType: 'lowpass',
    impactFrequencyHz: 78,
    noiseGain: 0.8,
    outputGain: 0.24,
  },
  metal: {
    durationSeconds: 0.14,
    filterFrequencyHz: 1_850,
    filterQ: 1.4,
    filterType: 'bandpass',
    impactFrequencyHz: 138,
    noiseGain: 0.65,
    outputGain: 0.2,
  },
};

const noiseBuffers = new WeakMap<BaseAudioContext, readonly AudioBuffer[]>();

/**
 * Maps movement intent to footstep cadence. Animation clips are stance-idle
 * only, so gait must come from locomotion physics — not clip names.
 */
export function footstepGaitFromIntent(params: {
  isMoving: boolean;
  isSprinting: boolean;
}): FootstepGait | null {
  if (!params.isMoving) return null;
  return params.isSprinting ? 'sprint' : 'walk';
}

/** @deprecated Prefer footstepGaitFromIntent — clip names no longer encode gait. */
export function footstepGaitFromAnimation(animation: string): FootstepGait | null {
  const normalized = animation.toLowerCase();
  if (normalized.includes('sprint')) return 'sprint';
  if (
    normalized.includes('run')
    || normalized.includes('walk')
    || normalized.includes('strafe')
  ) {
    return 'walk';
  }
  return null;
}

function actorHash(text: string): number {
  let hash = 2_166_136_261;
  for (let index = 0; index < text.length; index += 1) {
    hash ^= text.charCodeAt(index);
    hash = Math.imul(hash, 16_777_619);
  }
  return hash >>> 0;
}

function variation01(actorId: string, stepIndex: number): number {
  let value = (actorHash(actorId) + Math.imul(stepIndex + 1, 0x9e3779b1)) >>> 0;
  value ^= value >>> 16;
  value = Math.imul(value, 0x21f0aaad);
  value ^= value >>> 15;
  return (value >>> 0) / 4_294_967_296;
}

function createNoiseVariants(context: BaseAudioContext): readonly AudioBuffer[] {
  const cached = noiseBuffers.get(context);
  if (cached) return cached;
  const buffers = Array.from({ length: NOISE_VARIANT_COUNT }, (_, variant) => {
    const durationSeconds = 0.18;
    const buffer = context.createBuffer(
      1,
      Math.ceil(context.sampleRate * durationSeconds),
      context.sampleRate,
    );
    const samples = buffer.getChannelData(0);
    let state = (0x6d2b79f5 ^ Math.imul(variant + 1, 0x85ebca6b)) >>> 0;
    let previous = 0;
    for (let index = 0; index < samples.length; index += 1) {
      state ^= state << 13;
      state ^= state >>> 17;
      state ^= state << 5;
      const white = ((state >>> 0) / 2_147_483_648) - 1;
      previous = previous * 0.32 + white * 0.68;
      samples[index] = previous;
    }
    return buffer;
  });
  noiseBuffers.set(context, buffers);
  return buffers;
}

function distance(a: Vec3, b: Vec3): number {
  return Math.hypot(a.x - b.x, a.y - b.y, a.z - b.z);
}

function setPannerPosition(panner: PannerNode, position: Vec3, now: number): void {
  if ('positionX' in panner) {
    panner.positionX.setValueAtTime(position.x, now);
    panner.positionY.setValueAtTime(position.y, now);
    panner.positionZ.setValueAtTime(position.z, now);
    return;
  }
  const legacy = panner as unknown as {
    setPosition: (x: number, y: number, z: number) => void;
  };
  legacy.setPosition(position.x, position.y, position.z);
}

function connectVoiceOutput(
  graph: SfxAudioGraph,
  actor: FootstepActor,
  gain: GainNode,
  stepIndex: number,
  nodes: AudioNode[],
): void {
  if (actor.spatial) {
    const panner = graph.context.createPanner();
    panner.panningModel = 'HRTF';
    panner.distanceModel = 'linear';
    panner.refDistance = 1.5;
    panner.maxDistance = MAX_SPATIAL_DISTANCE_METERS;
    panner.rolloffFactor = 1;
    setPannerPosition(panner, actor.position, graph.context.currentTime);
    gain.connect(panner).connect(graph.bus);
    nodes.push(panner);
    return;
  }
  const stereo = graph.context.createStereoPanner();
  stereo.pan.value = stepIndex % 2 === 0 ? -0.06 : 0.06;
  gain.connect(stereo).connect(graph.bus);
  nodes.push(stereo);
}

function stopVoice(voice: ActiveVoice, activeVoices: Set<ActiveVoice>): void {
  if (voice.finished) return;
  voice.finished = true;
  activeVoices.delete(voice);
  for (const source of voice.sources) {
    try {
      source.stop();
    } catch {
      // The source may already have ended.
    }
    source.disconnect();
  }
  for (const node of voice.nodes) node.disconnect();
}

function playFootstep(
  graph: SfxAudioGraph,
  actor: FootstepActor,
  stepIndex: number,
  activeVoices: Set<ActiveVoice>,
): void {
  if (graph.context.state !== 'running') return;
  const profile = SURFACE_PROFILES[actor.surface];
  const variation = variation01(actor.id, stepIndex);
  const now = graph.context.currentTime;
  const duration = profile.durationSeconds;
  const actorVolume = Math.max(0, Math.min(1, actor.volume01 ?? 1));
  const gaitGain = actor.gait === 'sprint' ? 1.16 : 1;
  const output = graph.context.createGain();
  output.gain.value = profile.outputGain * actorVolume * gaitGain;

  const noise = graph.context.createBufferSource();
  const variants = createNoiseVariants(graph.context);
  noise.buffer = variants[Math.floor(variation * variants.length) % variants.length] ?? null;
  noise.playbackRate.value = 0.92 + variation * 0.16;
  const filter = graph.context.createBiquadFilter();
  filter.type = profile.filterType;
  filter.frequency.value = profile.filterFrequencyHz * (0.9 + variation * 0.2);
  filter.Q.value = profile.filterQ;
  const noiseGain = graph.context.createGain();
  noiseGain.gain.setValueAtTime(0.0001, now);
  noiseGain.gain.linearRampToValueAtTime(profile.noiseGain, now + 0.006);
  noiseGain.gain.exponentialRampToValueAtTime(0.0001, now + duration);
  noise.connect(filter).connect(noiseGain).connect(output);

  const impact = graph.context.createOscillator();
  impact.type = actor.surface === 'metal' ? 'triangle' : 'sine';
  impact.frequency.setValueAtTime(
    profile.impactFrequencyHz * (0.92 + variation * 0.18),
    now,
  );
  impact.frequency.exponentialRampToValueAtTime(
    profile.impactFrequencyHz * 0.58,
    now + duration,
  );
  const impactGain = graph.context.createGain();
  impactGain.gain.setValueAtTime(0.0001, now);
  impactGain.gain.linearRampToValueAtTime(0.48, now + 0.004);
  impactGain.gain.exponentialRampToValueAtTime(0.0001, now + duration * 0.8);
  impact.connect(impactGain).connect(output);

  const nodes: AudioNode[] = [output, filter, noiseGain, impactGain];
  connectVoiceOutput(graph, actor, output, stepIndex, nodes);
  const sources = [noise, impact];
  const voice: ActiveVoice = { finished: false, nodes, sources };
  activeVoices.add(voice);
  let sourcesEnded = 0;
  const onEnded = () => {
    sourcesEnded += 1;
    if (sourcesEnded >= sources.length) stopVoice(voice, activeVoices);
  };
  for (const source of sources) source.addEventListener('ended', onEnded, { once: true });
  noise.start(now);
  noise.stop(now + duration);
  impact.start(now);
  impact.stop(now + duration);
}

function gaitInterval(gait: FootstepGait, variation: number): number {
  const base = gait === 'sprint' ? SPRINT_INTERVAL_SECONDS : WALK_INTERVAL_SECONDS;
  return base * (0.94 + variation * 0.12);
}

function isSpatialActorAudible(actor: FootstepActor, listener: SfxListenerPose): boolean {
  return (
    actor.spatial &&
    actor.grounded &&
    actor.gait !== null &&
    distance(actor.position, listener.position) <= MAX_SPATIAL_DISTANCE_METERS
  );
}

function actorStateFor(
  actorStates: Map<string, ActorState>,
  actor: FootstepActor,
): ActorState {
  let state = actorStates.get(actor.id);
  if (!state) {
    state = {
      gait: null,
      position: { ...actor.position },
      stepIndex: 0,
      timeUntilStepSeconds: 0,
    };
    actorStates.set(actor.id, state);
  }
  return state;
}

function advanceActor(
  actor: FootstepActor,
  state: ActorState,
  context: ActorAdvanceContext,
): void {
  const frameMovement = distance(actor.position, state.position);
  state.position = { ...actor.position };
  const movedContinuously =
    frameMovement >= MIN_FRAME_MOVE_METERS &&
    frameMovement <= MAX_CONTINUOUS_MOVE_METERS;
  const gait = actor.grounded && movedContinuously ? actor.gait : null;
  if (!gait) {
    state.gait = null;
    state.timeUntilStepSeconds = 0;
    return;
  }
  if (state.gait !== gait) {
    state.gait = gait;
    state.timeUntilStepSeconds = gaitInterval(
      gait,
      variation01(actor.id, state.stepIndex),
    ) * 0.32;
    return;
  }
  state.timeUntilStepSeconds -= context.dtSeconds;
  if (state.timeUntilStepSeconds > 0) return;

  const withinRange =
    !actor.spatial ||
    distance(actor.position, context.listener.position) <= MAX_SPATIAL_DISTANCE_METERS;
  const graph = withinRange ? context.resolveGraph() : null;
  if (graph) playFootstep(graph, actor, state.stepIndex, context.activeVoices);
  state.stepIndex += 1;
  state.timeUntilStepSeconds = gaitInterval(
    gait,
    variation01(actor.id, state.stepIndex),
  );
}

function removeMissingActorStates(
  actorStates: Map<string, ActorState>,
  present: ReadonlySet<string>,
): void {
  for (const id of actorStates.keys()) {
    if (!present.has(id)) actorStates.delete(id);
  }
}

export function createFootstepController(): FootstepController {
  const actorStates = new Map<string, ActorState>();
  const activeVoices = new Set<ActiveVoice>();
  let disposed = false;

  function reset(): void {
    actorStates.clear();
  }

  return {
    update(dtSeconds, listener, actors) {
      if (disposed) return;
      const dt = Math.max(0, Math.min(MAX_FRAME_DT_SECONDS, dtSeconds));
      const present = new Set<string>();
      const audibleSpatialActor = actors.some((actor) =>
        isSpatialActorAudible(actor, listener),
      );
      let graph: SfxAudioGraph | null = null;
      if (audibleSpatialActor) {
        graph = getSfxAudioGraph();
        if (graph) setSfxListenerPose(graph, listener);
      }
      const resolveGraph = (): SfxAudioGraph | null => {
        graph ??= getSfxAudioGraph();
        return graph;
      };
      const advanceContext: ActorAdvanceContext = {
        dtSeconds: dt,
        listener,
        resolveGraph,
        activeVoices,
      };

      for (const actor of actors) {
        present.add(actor.id);
        const state = actorStateFor(actorStates, actor);
        advanceActor(actor, state, advanceContext);
      }
      removeMissingActorStates(actorStates, present);
    },
    reset,
    dispose() {
      if (disposed) return;
      disposed = true;
      reset();
      for (const voice of [...activeVoices]) stopVoice(voice, activeVoices);
    },
  };
}
