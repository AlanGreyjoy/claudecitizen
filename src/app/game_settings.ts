import type { RenderQualityPreset } from '../render/main/domain/render_quality';
import {
  normalizeInputSettings,
  type InputSettings,
} from '../flight/input_settings';

export interface GameSettings {
  input: InputSettings;
  renderQuality: RenderQualityPreset;
  ambientOcclusion: boolean;
  masterVolume: number;
  sfxVolume: number;
  musicVolume: number;
}

const STORAGE_KEY = 'claudecitizen-game-settings';
export const GAME_SETTINGS_CHANGED_EVENT = 'claudecitizen-game-settings-changed';

const DEFAULT_SETTINGS: GameSettings = {
  input: normalizeInputSettings(undefined),
  renderQuality: 'balanced',
  ambientOcclusion: true,
  masterVolume: 1,
  sfxVolume: 1,
  musicVolume: 1,
};

function clampVolume(value: number): number {
  if (!Number.isFinite(value)) return DEFAULT_SETTINGS.masterVolume;
  return Math.max(0, Math.min(1, value));
}

function normalizeSettings(raw: Partial<GameSettings>): GameSettings {
  const renderQuality =
    raw.renderQuality === 'performance' ||
    raw.renderQuality === 'balanced' ||
    raw.renderQuality === 'high'
      ? raw.renderQuality
      : DEFAULT_SETTINGS.renderQuality;

  return {
    input: normalizeInputSettings(raw.input),
    renderQuality,
    ambientOcclusion:
      typeof raw.ambientOcclusion === 'boolean'
        ? raw.ambientOcclusion
        : DEFAULT_SETTINGS.ambientOcclusion,
    masterVolume: clampVolume(raw.masterVolume ?? DEFAULT_SETTINGS.masterVolume),
    sfxVolume: clampVolume(raw.sfxVolume ?? DEFAULT_SETTINGS.sfxVolume),
    musicVolume: clampVolume(raw.musicVolume ?? DEFAULT_SETTINGS.musicVolume),
  };
}

export function loadGameSettings(): GameSettings {
  const raw = localStorage.getItem(STORAGE_KEY);
  if (!raw) return normalizeSettings(DEFAULT_SETTINGS);
  try {
    return normalizeSettings(JSON.parse(raw) as Partial<GameSettings>);
  } catch {
    return normalizeSettings(DEFAULT_SETTINGS);
  }
}

export function saveGameSettings(settings: GameSettings): GameSettings {
  const next = normalizeSettings(settings);
  localStorage.setItem(STORAGE_KEY, JSON.stringify(next));
  window.dispatchEvent(new CustomEvent<GameSettings>(GAME_SETTINGS_CHANGED_EVENT, { detail: next }));
  return next;
}

export function applyRenderQualityAndReload(preset: RenderQualityPreset): void {
  saveGameSettings({ ...loadGameSettings(), renderQuality: preset });
  const params = new URLSearchParams(window.location.search);
  params.set('quality', preset);
  const query = params.toString();
  window.location.href = query ? `${window.location.pathname}?${query}` : window.location.pathname;
}

export function applyAmbientOcclusionAndReload(enabled: boolean): void {
  saveGameSettings({ ...loadGameSettings(), ambientOcclusion: enabled });
  window.location.reload();
}

export function getStoredRenderQuality(): RenderQualityPreset | null {
  return loadGameSettings().renderQuality;
}
