import {
  buildDefaultDefinition,
  findPreviewSpecies,
  getPartsForSpecies,
} from './sidekick_catalog';
import {
  CharacterPartType,
  type SidekickCatalog,
  type SidekickManifestPart,
} from './sidekick_manifest';
import {
  setDefinitionBody,
  setDefinitionColorRow,
  setDefinitionPart,
  type SidekickCharacterDefinitionV2,
} from './sidekick_definition';

export const PLAYER_CHARACTER_APPEARANCE_SCHEMA_VERSION = 1 as const;
export const DEFAULT_PLAYER_HAIR_COLOR = '26272D';
export const DEFAULT_PLAYER_EYE_COLOR = '503E2B';
const HAIR_COLOR_PROPERTY_IDS = [32, 33] as const;
const EYEBROW_COLOR_PROPERTY_IDS = [30, 31] as const;
const FACIAL_HAIR_COLOR_PROPERTY_IDS = [35, 36, 37] as const;
const EYE_COLOR_PROPERTY_IDS = [26, 27] as const;

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

export const DEFAULT_PLAYER_CHARACTER_APPEARANCE: Readonly<PlayerCharacterAppearanceV1> = {
  schemaVersion: PLAYER_CHARACTER_APPEARANCE_SCHEMA_VERSION,
  type: 1,
  headVariant: 1,
  hairVariant: 1,
  eyebrowVariant: 1,
  earVariant: 1,
  noseVariant: 1,
  facialHairVariant: null,
  hairColor: DEFAULT_PLAYER_HAIR_COLOR,
  eyebrowColor: DEFAULT_PLAYER_HAIR_COLOR,
  facialHairColor: DEFAULT_PLAYER_HAIR_COLOR,
  eyeColor: DEFAULT_PLAYER_EYE_COLOR,
  bodySizeValue: 0,
  muscleValue: -100,
};

export function clonePlayerCharacterAppearance(
  appearance: PlayerCharacterAppearanceV1,
): PlayerCharacterAppearanceV1 {
  return { ...appearance };
}

function variantPart(
  catalog: SidekickCatalog,
  speciesId: number,
  type: CharacterPartType,
  variant: number,
): SidekickManifestPart {
  const part = getPartsForSpecies(catalog, speciesId, type).find((candidate) => {
    const match = candidate.name.match(/_BASE_(\d{2})_/);
    return match ? Number(match[1]) === variant : false;
  });
  if (!part) throw new Error(`Missing base variant ${variant} for character slot ${type}.`);
  return part;
}

function setVariant(
  definition: SidekickCharacterDefinitionV2,
  catalog: SidekickCatalog,
  type: CharacterPartType,
  variant: number,
): SidekickCharacterDefinitionV2 {
  const part = variantPart(catalog, definition.speciesId, type, variant);
  return setDefinitionPart(definition, type, part.name);
}

export function buildPlayerSidekickDefinition(
  catalog: SidekickCatalog,
  appearance: PlayerCharacterAppearanceV1,
): SidekickCharacterDefinitionV2 {
  const species = findPreviewSpecies(catalog);
  if (!species || species.name.toLowerCase() !== 'human') {
    throw new Error('The Human Sidekick species is unavailable.');
  }
  let definition = buildDefaultDefinition(catalog, species);
  definition = setVariant(definition, catalog, CharacterPartType.Head, appearance.headVariant);
  definition = setVariant(definition, catalog, CharacterPartType.Hair, appearance.hairVariant);
  definition = setVariant(
    definition,
    catalog,
    CharacterPartType.EyebrowLeft,
    appearance.eyebrowVariant,
  );
  definition = setVariant(
    definition,
    catalog,
    CharacterPartType.EyebrowRight,
    appearance.eyebrowVariant,
  );
  definition = setVariant(definition, catalog, CharacterPartType.EarLeft, appearance.earVariant);
  definition = setVariant(definition, catalog, CharacterPartType.EarRight, appearance.earVariant);
  definition = setVariant(definition, catalog, CharacterPartType.Nose, appearance.noseVariant);
  definition = appearance.facialHairVariant === null
    ? setDefinitionPart(definition, CharacterPartType.FacialHair, null)
    : setVariant(
        definition,
        catalog,
        CharacterPartType.FacialHair,
        appearance.facialHairVariant,
      );
  definition = setDefinitionBody(definition, {
    bodyTypeValue: appearance.type === 1 ? -100 : 100,
    bodySizeValue: appearance.bodySizeValue,
    muscleValue: appearance.muscleValue,
  });
  for (const [propertyIds, color] of [
    [HAIR_COLOR_PROPERTY_IDS, appearance.hairColor],
    [EYEBROW_COLOR_PROPERTY_IDS, appearance.eyebrowColor],
    [FACIAL_HAIR_COLOR_PROPERTY_IDS, appearance.facialHairColor],
    [EYE_COLOR_PROPERTY_IDS, appearance.eyeColor],
  ] as const) {
    for (const colorPropertyId of propertyIds) {
      const row = definition.colorRows.find(
        (candidate) => candidate.colorPropertyId === colorPropertyId,
      );
      if (row) {
        definition = setDefinitionColorRow(definition, {
          ...row,
          color,
        });
      }
    }
  }
  definition = setDefinitionPart(
    definition,
    CharacterPartType.Wrap,
    appearance.type === 2
      ? variantPart(catalog, species.id, CharacterPartType.Wrap, 1).name
      : null,
  );
  return { ...definition, name: 'Citizen' };
}

export function playerCharacterAppearanceKey(
  appearance: PlayerCharacterAppearanceV1,
): string {
  return [
    appearance.schemaVersion,
    appearance.type,
    appearance.headVariant,
    appearance.hairVariant,
    appearance.eyebrowVariant,
    appearance.earVariant,
    appearance.noseVariant,
    appearance.facialHairVariant ?? 0,
    appearance.hairColor,
    appearance.eyebrowColor,
    appearance.facialHairColor,
    appearance.eyeColor,
    appearance.bodySizeValue,
    appearance.muscleValue,
  ].join(':');
}
