export const PLAYER_CHARACTER_APPEARANCE_SCHEMA_VERSION = 1 as const;

export interface PlayerCharacterAppearanceV1 {
  schemaVersion: typeof PLAYER_CHARACTER_APPEARANCE_SCHEMA_VERSION;
  type: 1 | 2;
  headVariant: number;
  hairVariant: number;
  eyebrowVariant: number;
  earVariant: number;
  noseVariant: number;
  facialHairVariant: number | null;
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
    bodySizeValue: integerInRange(value.bodySizeValue, 'bodySizeValue', -100, 100),
    muscleValue: integerInRange(value.muscleValue, 'muscleValue', -100, 100),
  };
}

export function parseStoredPlayerCharacterAppearance(
  value: unknown,
): PlayerCharacterAppearanceV1 | null {
  if (value === null || value === undefined) return null;
  try {
    return parsePlayerCharacterAppearance(value);
  } catch {
    return null;
  }
}
