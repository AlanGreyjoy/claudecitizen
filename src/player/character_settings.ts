import characterSettingsJson from './data/character-settings.json';
import { AUTHORING_ENABLED } from '../build_mode';

export const CHARACTER_SETTINGS_SCHEMA_VERSION = 1 as const;

/** Authorable on-foot locomotion tuning, shared by planet, station, and deck walkers. */
export interface CharacterSettingsV1 {
  schemaVersion: typeof CHARACTER_SETTINGS_SCHEMA_VERSION;
  walkSpeedMetersPerSecond: number;
  /** Default on-foot move when walk toggle is off and not sprinting. */
  runSpeedMetersPerSecond: number;
  sprintSpeedMetersPerSecond: number;
  jumpSpeedMetersPerSecond: number;
}

export const DEFAULT_CHARACTER_SETTINGS: CharacterSettingsV1 = {
  schemaVersion: CHARACTER_SETTINGS_SCHEMA_VERSION,
  walkSpeedMetersPerSecond: 2.0,
  runSpeedMetersPerSecond: 3.5,
  sprintSpeedMetersPerSecond: 5.3,
  /** ~1.4 m apex at Earth gravity — snappy, not moon-bounce. */
  jumpSpeedMetersPerSecond: 5.2,
};

const MIN_SPEED = 0.1;
const MAX_SPEED = 50;

function record(value: unknown, label: string): Record<string, unknown> {
  if (!value || typeof value !== 'object' || Array.isArray(value)) {
    throw new Error(`${label} must be an object.`);
  }
  return value as Record<string, unknown>;
}

function speedValue(value: unknown, label: string): number {
  if (typeof value !== 'number' || !Number.isFinite(value)) {
    throw new Error(`${label} must be finite.`);
  }
  if (value < MIN_SPEED || value > MAX_SPEED) {
    throw new Error(`${label} must be between ${MIN_SPEED} and ${MAX_SPEED}.`);
  }
  return value;
}

export function parseCharacterSettings(value: unknown): CharacterSettingsV1 {
  const source = record(value, 'Character settings');
  if (source.schemaVersion !== CHARACTER_SETTINGS_SCHEMA_VERSION) {
    throw new Error(
      `Expected character settings schema version ${CHARACTER_SETTINGS_SCHEMA_VERSION}.`,
    );
  }
  const walkSpeedMetersPerSecond = speedValue(
    source.walkSpeedMetersPerSecond,
    'walkSpeedMetersPerSecond',
  );
  const sprintSpeedMetersPerSecond = speedValue(
    source.sprintSpeedMetersPerSecond,
    'sprintSpeedMetersPerSecond',
  );
  // Older saves omit run — default between walk and sprint.
  const runRaw = source.runSpeedMetersPerSecond;
  const runSpeedMetersPerSecond =
    typeof runRaw === 'number' && Number.isFinite(runRaw)
      ? speedValue(runRaw, 'runSpeedMetersPerSecond')
      : Math.min(
          MAX_SPEED,
          Math.max(MIN_SPEED, (walkSpeedMetersPerSecond + sprintSpeedMetersPerSecond) / 2),
        );
  return {
    schemaVersion: CHARACTER_SETTINGS_SCHEMA_VERSION,
    walkSpeedMetersPerSecond,
    runSpeedMetersPerSecond,
    sprintSpeedMetersPerSecond,
    jumpSpeedMetersPerSecond: speedValue(
      source.jumpSpeedMetersPerSecond,
      'jumpSpeedMetersPerSecond',
    ),
  };
}

export function cloneCharacterSettings(value: CharacterSettingsV1): CharacterSettingsV1 {
  return structuredClone(value);
}

function loadBundledSettings(): CharacterSettingsV1 {
  try {
    return parseCharacterSettings(characterSettingsJson);
  } catch (error) {
    console.warn('Invalid bundled character settings; using defaults.', error);
    return cloneCharacterSettings(DEFAULT_CHARACTER_SETTINGS);
  }
}

let activeCharacterSettings = loadBundledSettings();

/** Current locomotion tuning. Read per frame; mutated only by the dev editor. */
export function getCharacterSettings(): CharacterSettingsV1 {
  return activeCharacterSettings;
}

/** Dev-editor live tuning hook. Production builds never call this. */
export function setCharacterSettings(next: CharacterSettingsV1): void {
  activeCharacterSettings = cloneCharacterSettings(next);
}

/**
 * Dev editor saves are excluded from Vite HMR, so gameplay must refresh the
 * settings through the editor API instead of relying on the imported JSON.
 */
export async function loadCurrentCharacterSettings(): Promise<CharacterSettingsV1> {
  if (!AUTHORING_ENABLED) return getCharacterSettings();
  try {
    const response = await fetch('/__editor/character-settings', { cache: 'no-store' });
    if (!response.ok) {
      throw new Error(`Editor character settings request failed (${response.status}).`);
    }
    const payload = await response.json() as { document?: unknown };
    activeCharacterSettings = parseCharacterSettings(payload.document);
  } catch (error) {
    console.warn('Could not load the current character settings; using the bundled copy.', error);
  }
  return getCharacterSettings();
}
