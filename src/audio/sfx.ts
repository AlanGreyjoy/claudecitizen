import {
  GAME_SETTINGS_CHANGED_EVENT,
  loadGameSettings,
  type GameSettings,
} from '../settings/game_settings';

let audioContext: AudioContext | null = null;
let masterGain: GainNode | null = null;
const bufferCache = new Map<string, Promise<AudioBuffer>>();

function ensureAudioContext(): AudioContext | null {
  if (typeof window === 'undefined') return null;
  if (!audioContext) {
    const Ctx = window.AudioContext ?? (window as typeof window & { webkitAudioContext?: typeof AudioContext }).webkitAudioContext;
    if (!Ctx) return null;
    audioContext = new Ctx();
    masterGain = audioContext.createGain();
    masterGain.connect(audioContext.destination);
    applyVolume(loadGameSettings());
    window.addEventListener(GAME_SETTINGS_CHANGED_EVENT, (event) => {
      applyVolume((event as CustomEvent<GameSettings>).detail);
    });
  }
  return audioContext;
}

function applyVolume(settings: GameSettings): void {
  if (!masterGain) return;
  masterGain.gain.value = settings.masterVolume * settings.sfxVolume;
}

function loadBuffer(url: string): Promise<AudioBuffer> {
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
      const buffer = await loadBuffer(url);
      const source = ctx.createBufferSource();
      source.buffer = buffer;
      source.connect(masterGain);
      source.start();
    } catch (error) {
      console.warn(`SFX playback failed for ${url}`, error);
    }
  })();
}
