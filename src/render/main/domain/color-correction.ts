import type { ColorCorrectionSettings } from '../../../types';

export const DEFAULT_COLOR_CORRECTION_SETTINGS: ColorCorrectionSettings = {
  enabled: true,
  brightness: 0,
  contrast: 1,
  saturation: 1,
  hue: 0,
  gamma: 1,
};

const STORAGE_KEY = 'claudecitizen-game-settings';

function isValidNumber(value: unknown): value is number {
  return typeof value === 'number' && Number.isFinite(value);
}

function isValidBoolean(value: unknown): value is boolean {
  return typeof value === 'boolean';
}

export function loadColorCorrectionSettings(): Partial<ColorCorrectionSettings> {
  if (typeof window === 'undefined') return {};
  try {
    const stored = localStorage.getItem(STORAGE_KEY);
    if (!stored) return {};
    const parsed = JSON.parse(stored) as { colorCorrection?: Record<string, unknown> };
    const raw = parsed.colorCorrection ?? {};
    const settings: Partial<ColorCorrectionSettings> = {};
    if (isValidBoolean(raw.enabled)) settings.enabled = raw.enabled;
    if (isValidNumber(raw.brightness)) settings.brightness = raw.brightness;
    if (isValidNumber(raw.contrast)) settings.contrast = raw.contrast;
    if (isValidNumber(raw.saturation)) settings.saturation = raw.saturation;
    if (isValidNumber(raw.hue)) settings.hue = raw.hue;
    if (isValidNumber(raw.gamma)) settings.gamma = raw.gamma;
    return settings;
  } catch {
    return {};
  }
}

export function resolveColorCorrectionSettings(): ColorCorrectionSettings {
  return { ...DEFAULT_COLOR_CORRECTION_SETTINGS, ...loadColorCorrectionSettings() };
}

export function saveColorCorrectionSettings(settings: Partial<ColorCorrectionSettings>): void {
  if (typeof window === 'undefined') return;
  try {
    const stored = localStorage.getItem(STORAGE_KEY) ?? '{}';
    const parsed = JSON.parse(stored) as Record<string, unknown>;
    const existing = (parsed.colorCorrection ?? {}) as Partial<ColorCorrectionSettings>;
    parsed.colorCorrection = { ...existing, ...settings };
    localStorage.setItem(STORAGE_KEY, JSON.stringify(parsed));
  } catch {
    // Ignore malformed local settings.
  }
}
