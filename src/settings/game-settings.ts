import type {
  RenderQualityPreset,
  ShadowQualitySetting,
} from '../render/main/domain/render_quality';
import { DEFAULT_GRASS_DISTANCE_METERS } from '../render/vegetation/domain/constants';
import {
  normalizeInputSettings,
  type InputSettings,
} from '../flight/input_settings';

/**
 * Cloud rendering path. 'off' disables clouds; 'shell' is the cheap
 * camera-centered 2D dome (planet-anchored coverage); 'volumetric' is the
 * Takram raymarched composite (experimental — lighting parity with the sphere
 * planet is still unverified).
 */
export type CloudModeSetting = 'off' | 'shell' | 'volumetric';

export interface GameSettings {
  input: InputSettings;
  renderQuality: RenderQualityPreset;
  ambientOcclusion: boolean;
  motionBlur: boolean;
  shadowQuality: ShadowQualitySetting;
  cloudMode: CloudModeSetting;
  /** Hard radial grass cull distance in meters (default 20). */
  grassRenderDistanceMeters: number;
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
  motionBlur: true,
  shadowQuality: 'auto',
  cloudMode: 'shell',
  grassRenderDistanceMeters: DEFAULT_GRASS_DISTANCE_METERS,
  masterVolume: 1,
  sfxVolume: 1,
  musicVolume: 1,
};

function clampVolume(value: number): number {
  if (!Number.isFinite(value)) return DEFAULT_SETTINGS.masterVolume;
  return Math.max(0, Math.min(1, value));
}

function clampGrassRenderDistanceMeters(value: unknown): number {
  if (typeof value !== 'number' || !Number.isFinite(value)) {
    return DEFAULT_SETTINGS.grassRenderDistanceMeters;
  }
  return Math.max(5, Math.min(80, Math.round(value)));
}

function pickEnum<T extends string>(
  value: unknown,
  allowed: readonly T[],
  fallback: T,
): T {
  return allowed.includes(value as T) ? (value as T) : fallback;
}

function normalizeSettings(raw: Partial<GameSettings>): GameSettings {
  return {
    input: normalizeInputSettings(raw.input),
    renderQuality: pickEnum(
      raw.renderQuality,
      ['performance', 'balanced', 'high'],
      DEFAULT_SETTINGS.renderQuality,
    ),
    ambientOcclusion:
      typeof raw.ambientOcclusion === 'boolean'
        ? raw.ambientOcclusion
        : DEFAULT_SETTINGS.ambientOcclusion,
    motionBlur:
      typeof raw.motionBlur === 'boolean'
        ? raw.motionBlur
        : DEFAULT_SETTINGS.motionBlur,
    shadowQuality: pickEnum(
      raw.shadowQuality,
      ['auto', 'off', 'low', 'medium', 'high'],
      DEFAULT_SETTINGS.shadowQuality,
    ),
    cloudMode: pickEnum(
      raw.cloudMode,
      ['off', 'shell', 'volumetric'],
      DEFAULT_SETTINGS.cloudMode,
    ),
    grassRenderDistanceMeters: clampGrassRenderDistanceMeters(
      raw.grassRenderDistanceMeters,
    ),
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
  let stored: Record<string, unknown> = {};
  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    if (raw) stored = JSON.parse(raw) as Record<string, unknown>;
  } catch {
    // Ignore malformed local settings.
  }
  localStorage.setItem(STORAGE_KEY, JSON.stringify({ ...stored, ...next }));
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

export function applyMotionBlurAndReload(enabled: boolean): void {
  saveGameSettings({ ...loadGameSettings(), motionBlur: enabled });
  window.location.reload();
}

export function applyShadowQualityAndReload(shadowQuality: ShadowQualitySetting): void {
  saveGameSettings({ ...loadGameSettings(), shadowQuality });
  window.location.reload();
}

export function getStoredRenderQuality(): RenderQualityPreset | null {
  return loadGameSettings().renderQuality;
}
