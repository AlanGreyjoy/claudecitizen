export const PLAYER_CHARACTER_APPEARANCE_SCHEMA_VERSION = 1 as const;
export const DEFAULT_PLAYER_HAIR_COLOR = '26272D';
export const DEFAULT_PLAYER_EYE_COLOR = '503E2B';

export interface PlayerCharacterAppearanceV1 {
  schemaVersion: typeof PLAYER_CHARACTER_APPEARANCE_SCHEMA_VERSION;
  type: 1 | 2;
  headVariant: number;
  hairVariant: number;
  eyebrowVariant: number;
  earVariant: number;
  noseVariant: number;
  facialHairVariant: number | null;
  hairColor: string;
  eyebrowColor: string;
  facialHairColor: string;
  eyeColor: string;
  bodySizeValue: number;
  muscleValue: number;
}

const APPEARANCE_KEYS = new Set([
  'schemaVersion',
  'type',
  'headVariant',
  'hairVariant',
  'eyebrowVariant',
  'earVariant',
  'noseVariant',
  'facialHairVariant',
  'hairColor',
  'eyebrowColor',
  'facialHairColor',
  'eyeColor',
  'bodySizeValue',
  'muscleValue',
]);

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

function integerInRange(
  value: unknown,
  name: string,
  minimum: number,
  maximum: number,
): number {
  if (!Number.isInteger(value) || (value as number) < minimum || (value as number) > maximum) {
    throw new Error(`${name} must be an integer from ${minimum} to ${maximum}.`);
  }
  return value as number;
}

function appearanceColor(value: unknown, name: string): string {
  if (typeof value !== 'string') throw new Error(`${name} must be a six-digit hex color.`);
  const normalized = value.trim().replace(/^#/, '');
  if (!/^[0-9a-f]{6}$/i.test(normalized)) {
    throw new Error(`${name} must be a six-digit hex color.`);
  }
  return normalized.toUpperCase();
}

export function parsePlayerCharacterAppearance(value: unknown): PlayerCharacterAppearanceV1 {
  if (!isRecord(value)) throw new Error('Character appearance must be an object.');
  const unknownKey = Object.keys(value).find((key) => !APPEARANCE_KEYS.has(key));
  if (unknownKey) throw new Error(`Unknown character appearance field: ${unknownKey}.`);

  const schemaVersion = integerInRange(value.schemaVersion, 'schemaVersion', 1, 1);
  const type = integerInRange(value.type, 'type', 1, 2);
  const facialHairVariant = value.facialHairVariant === null
    ? null
    : integerInRange(value.facialHairVariant, 'facialHairVariant', 1, 10);

  return {
    schemaVersion: schemaVersion as 1,
    type: type as 1 | 2,
    headVariant: integerInRange(value.headVariant, 'headVariant', 1, 2),
    hairVariant: integerInRange(value.hairVariant, 'hairVariant', 1, 10),
    eyebrowVariant: integerInRange(value.eyebrowVariant, 'eyebrowVariant', 1, 10),
    earVariant: integerInRange(value.earVariant, 'earVariant', 1, 10),
    noseVariant: integerInRange(value.noseVariant, 'noseVariant', 1, 11),
    facialHairVariant,
    hairColor: appearanceColor(value.hairColor, 'hairColor'),
    eyebrowColor: appearanceColor(value.eyebrowColor, 'eyebrowColor'),
    facialHairColor: appearanceColor(value.facialHairColor, 'facialHairColor'),
    eyeColor: appearanceColor(value.eyeColor, 'eyeColor'),
    bodySizeValue: integerInRange(value.bodySizeValue, 'bodySizeValue', -100, 100),
    muscleValue: integerInRange(value.muscleValue, 'muscleValue', -100, 100),
  };
}

export function parseStoredPlayerCharacterAppearance(
  value: unknown,
): PlayerCharacterAppearanceV1 | null {
  if (value === null || value === undefined) return null;
  try {
    const upgraded = isRecord(value)
      ? {
          ...value,
          hairColor: value.hairColor ?? DEFAULT_PLAYER_HAIR_COLOR,
          eyebrowColor: value.eyebrowColor ?? DEFAULT_PLAYER_HAIR_COLOR,
          facialHairColor: value.facialHairColor ?? DEFAULT_PLAYER_HAIR_COLOR,
          eyeColor: value.eyeColor ?? DEFAULT_PLAYER_EYE_COLOR,
        }
      : value;
    return parsePlayerCharacterAppearance(upgraded);
  } catch {
    return null;
  }
}
