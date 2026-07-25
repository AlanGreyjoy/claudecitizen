import type { SsaoSettings } from '../../../types';

const STORAGE_KEY = 'claudecitizen-game-settings';

const DEFAULT_SSAO_TUNING: Omit<SsaoSettings, 'intensity'> = {
  aoRadius: 0.55,
  distanceFalloff: 1.0,
};

const LIMITS: Record<keyof SsaoSettings, { min: number; max: number }> = {
  intensity: { min: 0, max: 8 },
  aoRadius: { min: 0.05, max: 3 },
  distanceFalloff: { min: 0.1, max: 5 },
};

function isFiniteNumber(value: unknown): value is number {
  return typeof value === 'number' && Number.isFinite(value);
}

function clampSetting(key: keyof SsaoSettings, value: number): number {
  const limit = LIMITS[key];
  return Math.max(limit.min, Math.min(limit.max, value));
}

function readStoredSsao(): Partial<SsaoSettings> {
  if (typeof window === 'undefined') return {};
  try {
    const stored = localStorage.getItem(STORAGE_KEY);
    if (!stored) return {};
    const parsed = JSON.parse(stored) as { ssao?: Record<string, unknown> };
    const raw = parsed.ssao ?? {};
    const settings: Partial<SsaoSettings> = {};
    for (const key of Object.keys(LIMITS) as Array<keyof SsaoSettings>) {
      if (isFiniteNumber(raw[key])) {
        settings[key] = clampSetting(key, raw[key]) as never;
      }
    }
    return settings;
  } catch {
    return {};
  }
}

export function createDefaultSsaoSettings(intensity: number): SsaoSettings {
  return {
    intensity: clampSetting('intensity', intensity),
    ...DEFAULT_SSAO_TUNING,
  };
}

export function resolveSsaoSettings(defaultIntensity: number): SsaoSettings {
  return {
    ...createDefaultSsaoSettings(defaultIntensity),
    ...readStoredSsao(),
  };
}

export function saveSsaoSettings(settings: Partial<SsaoSettings>): void {
  if (typeof window === 'undefined') return;
  try {
    const stored = localStorage.getItem(STORAGE_KEY) ?? '{}';
    const parsed = JSON.parse(stored) as Record<string, unknown>;
    const existing = (parsed.ssao ?? {}) as Partial<SsaoSettings>;
    const next = { ...existing };
    for (const key of Object.keys(settings) as Array<keyof SsaoSettings>) {
      const value = settings[key];
      if (isFiniteNumber(value)) {
        next[key] = clampSetting(key, value) as never;
      }
    }
    parsed.ssao = next;
    localStorage.setItem(STORAGE_KEY, JSON.stringify(parsed));
  } catch {
    // Ignore malformed local settings.
  }
}

export function resetSsaoSettings(): void {
  if (typeof window === 'undefined') return;
  try {
    const stored = localStorage.getItem(STORAGE_KEY) ?? '{}';
    const parsed = JSON.parse(stored) as Record<string, unknown>;
    delete parsed.ssao;
    localStorage.setItem(STORAGE_KEY, JSON.stringify(parsed));
  } catch {
    // Ignore malformed local settings.
  }
}
