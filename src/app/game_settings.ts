import type { RenderQualityPreset } from '../render/main/domain/render_quality';

export interface GameSettings {
  renderQuality: RenderQualityPreset;
  masterVolume: number;
  sfxVolume: number;
  musicVolume: number;
}

const STORAGE_KEY = 'claudecitizen-game-settings';

const DEFAULT_SETTINGS: GameSettings = {
  renderQuality: 'balanced',
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
    renderQuality,
    masterVolume: clampVolume(raw.masterVolume ?? DEFAULT_SETTINGS.masterVolume),
    sfxVolume: clampVolume(raw.sfxVolume ?? DEFAULT_SETTINGS.sfxVolume),
    musicVolume: clampVolume(raw.musicVolume ?? DEFAULT_SETTINGS.musicVolume),
  };
}

export function loadGameSettings(): GameSettings {
  const raw = localStorage.getItem(STORAGE_KEY);
  if (!raw) return { ...DEFAULT_SETTINGS };
  try {
    return normalizeSettings(JSON.parse(raw) as Partial<GameSettings>);
  } catch {
    return { ...DEFAULT_SETTINGS };
  }
}

export function saveGameSettings(settings: GameSettings): GameSettings {
  const next = normalizeSettings(settings);
  localStorage.setItem(STORAGE_KEY, JSON.stringify(next));
  return next;
}

export function applyRenderQualityAndReload(preset: RenderQualityPreset): void {
  saveGameSettings({ ...loadGameSettings(), renderQuality: preset });
  const params = new URLSearchParams(window.location.search);
  params.set('quality', preset);
  const query = params.toString();
  window.location.href = query ? `${window.location.pathname}?${query}` : window.location.pathname;
}

export function getStoredRenderQuality(): RenderQualityPreset | null {
  return loadGameSettings().renderQuality;
}
