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
  playable?: boolean;
  defaultParts?: Array<{ partType: CharacterPartType; name: string }>;
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
  thumbnailUrl?: string | null;
  speciesIds?: number[];
  filterIds?: number[];
  usedColorPropertyIds?: number[];
  morphTargets?: string[];
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
  availabilityReportUrl?: string;
}

export interface SidekickManifestStats {
  databaseParts: number;
  installedParts: number;
  unavailableParts: number;
  playablePresets: number;
  installedSlotTypes?: number;
  exportedMorphTargets?: number;
}

export interface SidekickManifest {
  schemaVersion?: number;
  contentVersion?: string;
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
  stats?: SidekickManifestStats;
}

export type SidekickCatalog = SidekickManifest;

export enum SidekickPartGroup {
  Head = 1,
  UpperBody = 2,
  LowerBody = 3,
}

export enum SidekickColorGroup {
  Species = 1,
  Outfits = 2,
  Attachments = 3,
  Materials = 4,
  Elements = 5,
}

export const SIDEKICK_PART_GROUPS: ReadonlyArray<{
  id: SidekickPartGroup;
  label: string;
  types: readonly CharacterPartType[];
}> = [
  {
    id: SidekickPartGroup.Head,
    label: 'Head',
    types: [
      CharacterPartType.Head,
      CharacterPartType.Hair,
      CharacterPartType.EyebrowLeft,
      CharacterPartType.EyebrowRight,
      CharacterPartType.EyeLeft,
      CharacterPartType.EyeRight,
      CharacterPartType.EarLeft,
      CharacterPartType.EarRight,
      CharacterPartType.FacialHair,
      CharacterPartType.AttachmentHead,
      CharacterPartType.AttachmentFace,
      CharacterPartType.Nose,
      CharacterPartType.Teeth,
      CharacterPartType.Tongue,
    ],
  },
  {
    id: SidekickPartGroup.UpperBody,
    label: 'Upper Body',
    types: [
      CharacterPartType.Torso,
      CharacterPartType.ArmUpperLeft,
      CharacterPartType.ArmUpperRight,
      CharacterPartType.ArmLowerLeft,
      CharacterPartType.ArmLowerRight,
      CharacterPartType.HandLeft,
      CharacterPartType.HandRight,
      CharacterPartType.AttachmentBack,
      CharacterPartType.AttachmentShoulderLeft,
      CharacterPartType.AttachmentShoulderRight,
      CharacterPartType.AttachmentElbowLeft,
      CharacterPartType.AttachmentElbowRight,
      CharacterPartType.Wrap,
    ],
  },
  {
    id: SidekickPartGroup.LowerBody,
    label: 'Lower Body',
    types: [
      CharacterPartType.Hips,
      CharacterPartType.LegLeft,
      CharacterPartType.LegRight,
      CharacterPartType.FootLeft,
      CharacterPartType.FootRight,
      CharacterPartType.AttachmentHipsFront,
      CharacterPartType.AttachmentHipsBack,
      CharacterPartType.AttachmentHipsLeft,
      CharacterPartType.AttachmentHipsRight,
      CharacterPartType.AttachmentKneeLeft,
      CharacterPartType.AttachmentKneeRight,
    ],
  },
];

const PART_TYPE_LABELS: Record<number, string> = {
  [CharacterPartType.Head]: 'Head',
  [CharacterPartType.Hair]: 'Hair',
  [CharacterPartType.EyebrowLeft]: 'Left Eyebrow',
  [CharacterPartType.EyebrowRight]: 'Right Eyebrow',
  [CharacterPartType.EyeLeft]: 'Left Eye',
  [CharacterPartType.EyeRight]: 'Right Eye',
  [CharacterPartType.EarLeft]: 'Left Ear',
  [CharacterPartType.EarRight]: 'Right Ear',
  [CharacterPartType.FacialHair]: 'Facial Hair',
  [CharacterPartType.Torso]: 'Torso',
  [CharacterPartType.ArmUpperLeft]: 'Left Upper Arm',
  [CharacterPartType.ArmUpperRight]: 'Right Upper Arm',
  [CharacterPartType.ArmLowerLeft]: 'Left Lower Arm',
  [CharacterPartType.ArmLowerRight]: 'Right Lower Arm',
  [CharacterPartType.HandLeft]: 'Left Hand',
  [CharacterPartType.HandRight]: 'Right Hand',
  [CharacterPartType.Hips]: 'Hips',
  [CharacterPartType.LegLeft]: 'Left Leg',
  [CharacterPartType.LegRight]: 'Right Leg',
  [CharacterPartType.FootLeft]: 'Left Foot',
  [CharacterPartType.FootRight]: 'Right Foot',
  [CharacterPartType.AttachmentHead]: 'Head Attachment',
  [CharacterPartType.AttachmentFace]: 'Face Attachment',
  [CharacterPartType.AttachmentBack]: 'Back Attachment',
  [CharacterPartType.AttachmentHipsFront]: 'Front Hip Attachment',
  [CharacterPartType.AttachmentHipsBack]: 'Back Hip Attachment',
  [CharacterPartType.AttachmentHipsLeft]: 'Left Hip Attachment',
  [CharacterPartType.AttachmentHipsRight]: 'Right Hip Attachment',
  [CharacterPartType.AttachmentShoulderLeft]: 'Left Shoulder Attachment',
  [CharacterPartType.AttachmentShoulderRight]: 'Right Shoulder Attachment',
  [CharacterPartType.AttachmentElbowLeft]: 'Left Elbow Attachment',
  [CharacterPartType.AttachmentElbowRight]: 'Right Elbow Attachment',
  [CharacterPartType.AttachmentKneeLeft]: 'Left Knee Attachment',
  [CharacterPartType.AttachmentKneeRight]: 'Right Knee Attachment',
  [CharacterPartType.Nose]: 'Nose',
  [CharacterPartType.Teeth]: 'Teeth',
  [CharacterPartType.Tongue]: 'Tongue',
  [CharacterPartType.Wrap]: 'Wrap',
};

export function getPartTypeLabel(type: CharacterPartType): string {
  return PART_TYPE_LABELS[type] ?? `Part ${type}`;
}
