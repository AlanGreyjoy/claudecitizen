export const SIDEKICK_ASSET_BASE = '/src/assets/protected/characters/synty_sidekick/';

export function resolveSidekickUrl(relativePath: string): string {
  const trimmed = relativePath.replace(/^\/+/, '');
  return `${SIDEKICK_ASSET_BASE}${trimmed}`;
}

/** Integer values match Unity `CharacterPartType` (starts at 1). */
export enum CharacterPartType {
  Head = 1,
  Hair,
  EyebrowLeft,
  EyebrowRight,
  EyeLeft,
  EyeRight,
  EarLeft,
  EarRight,
  FacialHair,
  Torso,
  ArmUpperLeft,
  ArmUpperRight,
  ArmLowerLeft,
  ArmLowerRight,
  HandLeft,
  HandRight,
  Hips,
  LegLeft,
  LegRight,
  FootLeft,
  FootRight,
  AttachmentHead,
  AttachmentFace,
  AttachmentBack,
  AttachmentHipsFront,
  AttachmentHipsBack,
  AttachmentHipsLeft,
  AttachmentHipsRight,
  AttachmentShoulderLeft,
  AttachmentShoulderRight,
  AttachmentElbowLeft,
  AttachmentElbowRight,
  AttachmentKneeLeft,
  AttachmentKneeRight,
  Nose,
  Teeth,
  Tongue,
  Wrap,
}

export interface SidekickManifestDbVersion {
  id: number;
  semanticVersion: string;
  lastUpdated: string;
}

export interface SidekickManifestSpecies {
  id: number;
  name: string;
  code: string;
}

export interface SidekickManifestPart {
  id: number;
  speciesId: number;
  type: CharacterPartType;
  partGroup: number;
  name: string;
  fileName: string;
  location: string;
  usesWrap: boolean;
  fileExists: boolean;
  meshUrl: string | null;
}

export interface SidekickManifestPartPreset {
  id: number;
  name: string;
  partGroup: number;
  speciesId: number;
  outfit: string;
}

export interface SidekickManifestPartPresetRow {
  id: number;
  partName: string;
  presetId: number;
  partId: number;
  partType: string;
}

export interface SidekickManifestColorProperty {
  id: number;
  colorGroup: number;
  name: string;
  u: number;
  v: number;
}

export interface SidekickManifestColorSet {
  id: number;
  speciesId: number;
  name: string;
  sourceColorPath: string;
  sourceMetallicPath: string;
  sourceSmoothnessPath: string;
  sourceReflectionPath: string;
  sourceEmissionPath: string;
  sourceOpacityPath: string;
}

export interface SidekickManifestColorRow {
  id: number;
  colorSetId: number;
  colorPropertyId: number;
  color: string;
  metallic: string;
  smoothness: string;
  reflection: string;
  emission: string;
  opacity: string;
}

export interface SidekickManifestColorPreset {
  id: number;
  name: string;
  colorGroup: number;
  speciesId: number;
}

export interface SidekickManifestColorPresetRow {
  id: number;
  colorPresetId: number;
  colorPropertyId: number;
  color: string;
  metallic: string;
  smoothness: string;
  reflection: string;
  emission: string;
  opacity: string;
}

export interface SidekickManifestBodyShapePreset {
  id: number;
  name: string;
  bodyType: number;
  bodySize: number;
  musculature: number;
}

export interface SidekickManifestBlendShapeRigMovement {
  id: number;
  partType: number;
  blendType: number;
  maxOffsetX: number;
  maxOffsetY: number;
  maxOffsetZ: number;
  maxRotationX: number;
  maxRotationY: number;
  maxRotationZ: number;
  maxScaleX: number;
  maxScaleY: number;
  maxScaleZ: number;
}

export interface SidekickManifestPartFilter {
  id: number;
  filterType: number;
  term: string;
}

export interface SidekickManifestPartFilterRow {
  id: number;
  filterId: number;
  partId: number;
}

export interface SidekickManifestPresetFilter {
  id: number;
  term: string;
}

export interface SidekickManifestPresetFilterRow {
  id: number;
  filterId: number;
  presetId: number;
}

export interface SidekickManifestPartSpeciesLink {
  id: number;
  speciesId: number;
  partId: number;
}

export interface SidekickManifestPartImage {
  id: number;
  partId: number;
  partName: string;
  thumbnailUrl: string | null;
  width: number;
  height: number;
}

export interface SidekickManifestAssets {
  baseModelUrl: string;
  materialConfigUrl: string;
  textureUrls: string[];
}

export interface SidekickManifest {
  exportedAt: string;
  unityProject: string;
  dbVersion: SidekickManifestDbVersion | null;
  species: SidekickManifestSpecies[];
  parts: SidekickManifestPart[];
  partPresets: SidekickManifestPartPreset[];
  partPresetRows: SidekickManifestPartPresetRow[];
  colorProperties: SidekickManifestColorProperty[];
  colorSets: SidekickManifestColorSet[];
  colorRows: SidekickManifestColorRow[];
  colorPresets: SidekickManifestColorPreset[];
  colorPresetRows: SidekickManifestColorPresetRow[];
  bodyShapePresets: SidekickManifestBodyShapePreset[];
  blendShapeRigMovement: SidekickManifestBlendShapeRigMovement[];
  partFilters: SidekickManifestPartFilter[];
  partFilterRows: SidekickManifestPartFilterRow[];
  presetFilters: SidekickManifestPresetFilter[];
  presetFilterRows: SidekickManifestPresetFilterRow[];
  partSpeciesLinks: SidekickManifestPartSpeciesLink[];
  partImages: SidekickManifestPartImage[];
  assets: SidekickManifestAssets;
}

export type SidekickCatalog = SidekickManifest;
