import {
  GAME_SETTINGS_CHANGED_EVENT,
  loadGameSettings,
  type GameSettings,
} from '../settings/game_settings';

let audioContext: AudioContext | null = null;
let masterGain: GainNode | null = null;
const bufferCache = new Map<string, Promise<AudioBuffer>>();
let unlockListenersInstalled = false;

export interface SfxAudioGraph {
  context: AudioContext;
  bus: GainNode;
}

function installUnlockListeners(): void {
  if (unlockListenersInstalled || typeof window === 'undefined') return;
  unlockListenersInstalled = true;
  const resume = () => {
    if (audioContext?.state === 'suspended') void audioContext.resume().catch(() => undefined);
    if (audioContext?.state === 'running') {
      window.removeEventListener('pointerdown', resume);
      window.removeEventListener('keydown', resume);
      unlockListenersInstalled = false;
    }
  };
  window.addEventListener('pointerdown', resume);
  window.addEventListener('keydown', resume);
}

function ensureAudioContext(): AudioContext | null {
  if (typeof window === 'undefined') return null;
  if (!audioContext) {
    const Ctx = window.AudioContext ?? (window as typeof window & { webkitAudioContext?: typeof AudioContext }).webkitAudioContext;
    if (!Ctx) return null;
    audioContext = new Ctx();
    masterGain = audioContext.createGain();
    masterGain.connect(audioContext.destination);
    applyVolume(loadGameSettings());
    installUnlockListeners();
    window.addEventListener(GAME_SETTINGS_CHANGED_EVENT, (event) => {
      applyVolume((event as CustomEvent<GameSettings>).detail);
    });
  }
  return audioContext;
}

export function getSfxAudioGraph(): SfxAudioGraph | null {
  const context = ensureAudioContext();
  return context && masterGain ? { context, bus: masterGain } : null;
}

function applyVolume(settings: GameSettings): void {
  if (!masterGain) return;
  masterGain.gain.value = settings.masterVolume * settings.sfxVolume;
}

export function loadSfxBuffer(url: string): Promise<AudioBuffer> {
  let pending = bufferCache.get(url);
  if (!pending) {
    pending = (async () => {
      const ctx = ensureAudioContext();
      if (!ctx) throw new Error('AudioContext unavailable');
      const response = await fetch(url);
      if (!response.ok) throw new Error(`Failed to fetch SFX ${url} (${response.status})`);
      const data = await response.arrayBuffer();
      return ctx.decodeAudioData(data);
    })();
    pending.catch(() => bufferCache.delete(url));
    bufferCache.set(url, pending);
  }
  return pending;
}

/** Fire-and-forget one-shot SFX; respects master and SFX volume settings. */
export function playSfx(url: string): void {
  if (!url) return;
  void (async () => {
    const ctx = ensureAudioContext();
    if (!ctx || !masterGain) return;
    if (ctx.state === 'suspended') {
      try {
        await ctx.resume();
      } catch {
        return;
      }
    }
    try {
      const buffer = await loadSfxBuffer(url);
      const source = ctx.createBufferSource();
      source.buffer = buffer;
      source.connect(masterGain);
      source.start();
    } catch (error) {
      console.warn(`SFX playback failed for ${url}`, error);
    }
  })();
}

export interface AudioPreviewHandle {
  stop: () => void;
}

/** Plays an editor preview through the SFX bus and returns an immediate cancel handle. */
export function playAudioPreview(
  url: string,
  options: { loop?: boolean; volume?: number; onEnded?: () => void } = {},
): AudioPreviewHandle {
  let stopped = false;
  let source: AudioBufferSourceNode | null = null;
  let gain: GainNode | null = null;

  void (async () => {
    const graph = getSfxAudioGraph();
    if (!graph || !url) return;
    try {
      const buffer = await loadSfxBuffer(url);
      if (stopped) return;
      source = graph.context.createBufferSource();
      gain = graph.context.createGain();
      source.buffer = buffer;
      source.loop = options.loop ?? false;
      gain.gain.value = Math.max(0, Math.min(1, options.volume ?? 1));
      source.connect(gain).connect(graph.bus);
      source.addEventListener('ended', () => {
        source?.disconnect();
        gain?.disconnect();
        source = null;
        gain = null;
        options.onEnded?.();
      });
      source.start();
    } catch (error) {
      console.warn(`Audio preview failed for ${url}`, error);
      options.onEnded?.();
    }
  })();

  return {
    stop() {
      stopped = true;
      if (source) {
        try {
          source.stop();
        } catch {
          // The source may already have ended.
        }
        source.disconnect();
      }
      gain?.disconnect();
      source = null;
      gain = null;
    },
  };
}
