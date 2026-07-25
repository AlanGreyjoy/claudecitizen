import type { CharacterPartType } from './sidekick_manifest';

export const SIDEKICK_DEFINITION_SCHEMA_VERSION = 2 as const;

export interface SidekickSerializedPart {
  name: string;
  partType: CharacterPartType;
  partVersion: string;
}

export interface SidekickSerializedColorSet {
  id?: number;
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

export interface SidekickSerializedMaterialEffects {
  darkAmount: number;
  dirtAmount: number;
  dirtColor: string;
  skinColorAmount: number;
  skinColor: string;
  eyelinerAmount: number;
}

export const DEFAULT_SIDEKICK_MATERIAL_EFFECTS: Readonly<SidekickSerializedMaterialEffects> = {
  darkAmount: 0.5,
  dirtAmount: 0.306,
  dirtColor: '785A3D',
  skinColorAmount: 0,
  skinColor: '000000',
  eyelinerAmount: 0,
};

/** Portable character data. Transient filters, locks, and UI state are intentionally excluded. */
export interface SidekickCharacterDefinitionV2 {
  schemaVersion: typeof SIDEKICK_DEFINITION_SCHEMA_VERSION;
  name: string;
  speciesId: number;
  parts: SidekickSerializedPart[];
  colorSet: SidekickSerializedColorSet | null;
  colorRows: SidekickSerializedColorRow[];
  blendShapes: SidekickSerializedBlendShapes;
  materialEffects: SidekickSerializedMaterialEffects;
}

export type SidekickCharacterDefinition = SidekickCharacterDefinitionV2;

interface LegacySidekickCharacterDefinition {
  schemaVersion?: number;
  name?: unknown;
  speciesId?: unknown;
  parts?: unknown;
  colorSet?: unknown;
  colorRows?: unknown;
  blendShapes?: unknown;
  materialEffects?: unknown;
}

function finiteNumber(value: unknown, fallback: number): number {
  return typeof value === 'number' && Number.isFinite(value) ? value : fallback;
}

export function clampBodyValue(value: number): number {
  return Math.max(-100, Math.min(100, value));
}

export function createEmptySidekickDefinition(
  speciesId: number,
  name = 'Preview Character',
): SidekickCharacterDefinitionV2 {
  return {
    schemaVersion: SIDEKICK_DEFINITION_SCHEMA_VERSION,
    name,
    speciesId,
    parts: [],
    colorSet: null,
    colorRows: [],
    blendShapes: {
      bodyTypeValue: 0,
      bodySizeValue: 0,
      muscleValue: 0,
    },
    materialEffects: { ...DEFAULT_SIDEKICK_MATERIAL_EFFECTS },
  };
}

export function cloneSidekickDefinition(
  definition: SidekickCharacterDefinitionV2,
): SidekickCharacterDefinitionV2 {
  return {
    ...definition,
    parts: definition.parts.map((part) => ({ ...part })),
    colorSet: definition.colorSet ? { ...definition.colorSet } : null,
    colorRows: definition.colorRows.map((row) => ({ ...row })),
    blendShapes: { ...definition.blendShapes },
    materialEffects: { ...definition.materialEffects },
  };
}

export function setDefinitionPart(
  definition: SidekickCharacterDefinitionV2,
  partType: CharacterPartType,
  partName: string | null,
  partVersion = '',
): SidekickCharacterDefinitionV2 {
  const parts = definition.parts.filter((part) => part.partType !== partType);
  if (partName)
    parts.push({ name: partName, partType, partVersion });
  parts.sort((left, right) => left.partType - right.partType);
  return { ...definition, parts };
}

export function setDefinitionBody(
  definition: SidekickCharacterDefinitionV2,
  values: Partial<SidekickSerializedBlendShapes>,
): SidekickCharacterDefinitionV2 {
  return {
    ...definition,
    blendShapes: {
      bodyTypeValue: clampBodyValue(values.bodyTypeValue ?? definition.blendShapes.bodyTypeValue),
      bodySizeValue: clampBodyValue(values.bodySizeValue ?? definition.blendShapes.bodySizeValue),
      muscleValue: clampBodyValue(values.muscleValue ?? definition.blendShapes.muscleValue),
    },
  };
}

function clampUnit(value: number): number {
  return Math.max(0, Math.min(1, value));
}

function normalizeColor(value: string, fallback: string): string {
  const cleaned = value.replace(/^#/, '').trim();
  return /^[0-9a-f]{6}$/i.test(cleaned) ? cleaned.toUpperCase() : fallback;
}

export function setDefinitionMaterialEffects(
  definition: SidekickCharacterDefinitionV2,
  values: Partial<SidekickSerializedMaterialEffects>,
): SidekickCharacterDefinitionV2 {
  const current = definition.materialEffects;
  return {
    ...definition,
    materialEffects: {
      darkAmount: clampUnit(values.darkAmount ?? current.darkAmount),
      dirtAmount: clampUnit(values.dirtAmount ?? current.dirtAmount),
      dirtColor: normalizeColor(values.dirtColor ?? current.dirtColor, current.dirtColor),
      skinColorAmount: clampUnit(values.skinColorAmount ?? current.skinColorAmount),
      skinColor: normalizeColor(values.skinColor ?? current.skinColor, current.skinColor),
      eyelinerAmount: clampUnit(values.eyelinerAmount ?? current.eyelinerAmount),
    },
  };
}

export function setDefinitionColorRow(
  definition: SidekickCharacterDefinitionV2,
  row: SidekickSerializedColorRow,
): SidekickCharacterDefinitionV2 {
  const colorRows = definition.colorRows.filter(
    (existing) => existing.colorPropertyId !== row.colorPropertyId,
  );
  colorRows.push({ ...row });
  colorRows.sort((left, right) => left.colorPropertyId - right.colorPropertyId);
  return { ...definition, colorRows };
}

export function getDefinitionPartName(
  definition: SidekickCharacterDefinitionV2,
  partType: CharacterPartType,
): string | null {
  return definition.parts.find((part) => part.partType === partType)?.name ?? null;
}

function parseLegacyParts(
  definition: SidekickCharacterDefinitionV2,
  parts: unknown,
): void {
  if (!Array.isArray(parts)) return;
  for (const value of parts) {
    if (!value || typeof value !== 'object') continue;
    const part = value as Record<string, unknown>;
    if (typeof part.name !== 'string' || typeof part.partType !== 'number') continue;
    definition.parts.push({
      name: part.name,
      partType: part.partType as CharacterPartType,
      partVersion: typeof part.partVersion === 'string' ? part.partVersion : '',
    });
  }
}

function parseLegacyColorSet(
  definition: SidekickCharacterDefinitionV2,
  colorSet: unknown,
  speciesId: number,
): void {
  if (!colorSet || typeof colorSet !== 'object') return;
  const value = colorSet as Record<string, unknown>;
  definition.colorSet = {
    id: typeof value.id === 'number' ? value.id : undefined,
    species: finiteNumber(value.species, speciesId),
    name: typeof value.name === 'string' ? value.name : 'Custom',
    sourceColorPath: typeof value.sourceColorPath === 'string' ? value.sourceColorPath : '',
    sourceMetallicPath: typeof value.sourceMetallicPath === 'string' ? value.sourceMetallicPath : '',
    sourceSmoothnessPath: typeof value.sourceSmoothnessPath === 'string' ? value.sourceSmoothnessPath : '',
    sourceReflectionPath: typeof value.sourceReflectionPath === 'string' ? value.sourceReflectionPath : '',
    sourceEmissionPath: typeof value.sourceEmissionPath === 'string' ? value.sourceEmissionPath : '',
    sourceOpacityPath: typeof value.sourceOpacityPath === 'string' ? value.sourceOpacityPath : '',
  };
}

function parseColorRowChannel(row: Record<string, unknown>, name: string, fallback: string): string {
  return typeof row[name] === 'string' ? row[name] as string : fallback;
}

function parseLegacyColorRows(definition: SidekickCharacterDefinitionV2, colorRows: unknown): void {
  if (!Array.isArray(colorRows)) return;
  for (const value of colorRows) {
    if (!value || typeof value !== 'object') continue;
    const row = value as Record<string, unknown>;
    if (typeof row.colorPropertyId !== 'number') continue;
    definition.colorRows.push({
      colorPropertyId: row.colorPropertyId,
      color: parseColorRowChannel(row, 'color', 'FFFFFF'),
      metallic: parseColorRowChannel(row, 'metallic', '000000'),
      smoothness: parseColorRowChannel(row, 'smoothness', '808080'),
      reflection: parseColorRowChannel(row, 'reflection', '000000'),
      emission: parseColorRowChannel(row, 'emission', '000000'),
      opacity: parseColorRowChannel(row, 'opacity', 'FFFFFF'),
    });
  }
}

function parseLegacyBlendShapes(
  definition: SidekickCharacterDefinitionV2,
  blendShapes: unknown,
): void {
  if (!blendShapes || typeof blendShapes !== 'object') return;
  const body = blendShapes as Record<string, unknown>;
  definition.blendShapes = {
    bodyTypeValue: clampBodyValue(finiteNumber(body.bodyTypeValue, 0)),
    bodySizeValue: clampBodyValue(finiteNumber(body.bodySizeValue, 0)),
    muscleValue: clampBodyValue(finiteNumber(body.muscleValue, 0)),
  };
}

function parseLegacyMaterialEffects(
  definition: SidekickCharacterDefinitionV2,
  materialEffects: unknown,
): void {
  if (!materialEffects || typeof materialEffects !== 'object') return;
  const effects = materialEffects as Record<string, unknown>;
  definition.materialEffects = setDefinitionMaterialEffects(definition, {
    darkAmount: finiteNumber(effects.darkAmount, DEFAULT_SIDEKICK_MATERIAL_EFFECTS.darkAmount),
    dirtAmount: finiteNumber(effects.dirtAmount, DEFAULT_SIDEKICK_MATERIAL_EFFECTS.dirtAmount),
    dirtColor: typeof effects.dirtColor === 'string'
      ? effects.dirtColor
      : DEFAULT_SIDEKICK_MATERIAL_EFFECTS.dirtColor,
    skinColorAmount: finiteNumber(
      effects.skinColorAmount,
      DEFAULT_SIDEKICK_MATERIAL_EFFECTS.skinColorAmount,
    ),
    skinColor: typeof effects.skinColor === 'string'
      ? effects.skinColor
      : DEFAULT_SIDEKICK_MATERIAL_EFFECTS.skinColor,
    eyelinerAmount: finiteNumber(
      effects.eyelinerAmount,
      DEFAULT_SIDEKICK_MATERIAL_EFFECTS.eyelinerAmount,
    ),
  }).materialEffects;
}

export function parseSidekickDefinition(raw: unknown): SidekickCharacterDefinitionV2 {
  if (!raw || typeof raw !== 'object')
    throw new Error('Sidekick character definition must be a JSON object.');

  const legacy = raw as LegacySidekickCharacterDefinition;
  const speciesId = finiteNumber(legacy.speciesId, 1);
  const definition = createEmptySidekickDefinition(
    speciesId,
    typeof legacy.name === 'string' ? legacy.name : 'Imported Character',
  );

  parseLegacyParts(definition, legacy.parts);
  parseLegacyColorSet(definition, legacy.colorSet, speciesId);
  parseLegacyColorRows(definition, legacy.colorRows);
  parseLegacyBlendShapes(definition, legacy.blendShapes);
  parseLegacyMaterialEffects(definition, legacy.materialEffects);

  definition.parts.sort((left, right) => left.partType - right.partType);
  definition.colorRows.sort((left, right) => left.colorPropertyId - right.colorPropertyId);
  return definition;
}

export function serializeSidekickDefinition(definition: SidekickCharacterDefinitionV2): string {
  return JSON.stringify(cloneSidekickDefinition(definition), null, 2);
}
