import type { CharacterPartType } from './sidekick_manifest';

export interface SidekickSerializedPart {
  name: string;
  partType: CharacterPartType;
  partVersion: string;
}

export interface SidekickSerializedColorSet {
  species: number;
  name: string;
  sourceColorPath: string;
  sourceMetallicPath: string;
  sourceSmoothnessPath: string;
  sourceReflectionPath: string;
  sourceEmissionPath: string;
  sourceOpacityPath: string;
}

export interface SidekickSerializedColorRow {
  colorPropertyId: number;
  color: string;
  metallic: string;
  smoothness: string;
  reflection: string;
  emission: string;
  opacity: string;
}

export interface SidekickSerializedBlendShapes {
  bodyTypeValue: number;
  bodySizeValue: number;
  muscleValue: number;
}

/** Mirrors Unity `SerializedCharacter`. */
export interface SidekickCharacterDefinition {
  name: string;
  speciesId: number;
  parts: SidekickSerializedPart[];
  colorSet: SidekickSerializedColorSet | null;
  colorRows: SidekickSerializedColorRow[];
  blendShapes: SidekickSerializedBlendShapes;
}

export function createEmptySidekickDefinition(speciesId: number, name = 'Preview Character'): SidekickCharacterDefinition {
  return {
    name,
    speciesId,
    parts: [],
    colorSet: null,
    colorRows: [],
    blendShapes: {
      bodyTypeValue: 50,
      bodySizeValue: 0,
      muscleValue: 50,
    },
  };
}

export function setDefinitionPart(
  definition: SidekickCharacterDefinition,
  partType: CharacterPartType,
  partName: string,
  partVersion = '',
): SidekickCharacterDefinition {
  const parts = definition.parts.filter((part) => part.partType !== partType);
  parts.push({ name: partName, partType, partVersion });
  return {
    ...definition,
    parts,
  };
}

export function getDefinitionPartName(
  definition: SidekickCharacterDefinition,
  partType: CharacterPartType,
): string | null {
  return definition.parts.find((part) => part.partType === partType)?.name ?? null;
}
