import {
  CharacterPartType,
  resolveSidekickUrl,
  SIDEKICK_ASSET_BASE,
  SIDEKICK_PART_GROUPS,
  type SidekickCatalog,
  type SidekickManifestColorPreset,
  type SidekickManifestPart,
  type SidekickManifestPartPreset,
  type SidekickManifestSpecies,
} from './sidekick_manifest';
import {
  createEmptySidekickDefinition,
  setDefinitionPart,
  type SidekickCharacterDefinitionV2,
  type SidekickSerializedColorRow,
} from './sidekick_definition';

let catalogPromise: Promise<SidekickCatalog> | null = null;

const CORE_PART_TYPES = new Set<CharacterPartType>([
  CharacterPartType.Head,
  CharacterPartType.EyebrowLeft,
  CharacterPartType.EyebrowRight,
  CharacterPartType.EyeLeft,
  CharacterPartType.EyeRight,
  CharacterPartType.EarLeft,
  CharacterPartType.EarRight,
  CharacterPartType.Torso,
  CharacterPartType.ArmUpperLeft,
  CharacterPartType.ArmUpperRight,
  CharacterPartType.ArmLowerLeft,
  CharacterPartType.ArmLowerRight,
  CharacterPartType.HandLeft,
  CharacterPartType.HandRight,
  CharacterPartType.Hips,
  CharacterPartType.LegLeft,
  CharacterPartType.LegRight,
  CharacterPartType.FootLeft,
  CharacterPartType.FootRight,
  CharacterPartType.Nose,
  CharacterPartType.Teeth,
  CharacterPartType.Tongue,
]);

function normalizeCatalog(raw: unknown): SidekickCatalog {
  if (!raw || typeof raw !== 'object')
    throw new Error('Sidekick manifest is not a JSON object.');

  const manifest = raw as Partial<SidekickCatalog>;
  if (!Array.isArray(manifest.species) || !Array.isArray(manifest.parts))
    throw new Error('Sidekick manifest is empty or invalid. Re-run the Sidekick exporter in Unity.');

  const arrays: Array<keyof SidekickCatalog> = [
    'partPresets', 'partPresetRows', 'colorProperties', 'colorSets', 'colorRows',
    'colorPresets', 'colorPresetRows', 'bodyShapePresets', 'blendShapeRigMovement',
    'partFilters', 'partFilterRows', 'presetFilters', 'presetFilterRows',
    'partSpeciesLinks', 'partImages',
  ];
  const normalized = manifest as SidekickCatalog;
  for (const key of arrays) {
    if (!Array.isArray(normalized[key]))
      (normalized as unknown as Record<string, unknown>)[key] = [];
  }
  return normalized;
}

export async function loadSidekickCatalog(): Promise<SidekickCatalog> {
  if (!catalogPromise) {
    catalogPromise = fetch(resolveSidekickUrl('manifest.json'))
      .then((response) => {
        if (!response.ok)
          throw new Error(`Failed to load Sidekick manifest (${response.status})`);
        return response.json() as Promise<unknown>;
      })
      .then(normalizeCatalog)
      .catch((error: unknown) => {
        catalogPromise = null;
        throw error;
      });
  }
  return catalogPromise;
}

export function getSpeciesById(catalog: SidekickCatalog, speciesId: number): SidekickManifestSpecies | null {
  return catalog.species.find((species) => species.id === speciesId) ?? null;
}

export function getSpeciesByName(catalog: SidekickCatalog, name: string): SidekickManifestSpecies | null {
  return catalog.species.find(
    (species) => species.name.localeCompare(name, undefined, { sensitivity: 'accent' }) === 0,
  ) ?? null;
}

export function getPartByName(catalog: SidekickCatalog, partName: string): SidekickManifestPart | null {
  return catalog.parts.find((part) => part.name === partName) ?? null;
}

export function getInstalledParts(catalog: SidekickCatalog): SidekickManifestPart[] {
  return catalog.parts.filter((part) => part.fileExists && Boolean(part.meshUrl));
}

function speciesIdsForPart(catalog: SidekickCatalog, part: SidekickManifestPart): Set<number> {
  if (part.speciesIds?.length)
    return new Set(part.speciesIds);
  const linked = catalog.partSpeciesLinks
    .filter((row) => row.partId === part.id)
    .map((row) => row.speciesId);
  if (linked.length)
    return new Set(linked);
  return new Set([part.speciesId]);
}

export function isPartCompatible(
  catalog: SidekickCatalog,
  part: SidekickManifestPart,
  speciesId: number,
): boolean {
  const unrestricted = getSpeciesByName(catalog, 'Unrestricted');
  const ids = speciesIdsForPart(catalog, part);
  return ids.has(speciesId) || (unrestricted ? ids.has(unrestricted.id) : false);
}

export function getPartsForSpecies(
  catalog: SidekickCatalog,
  speciesId: number,
  partType?: CharacterPartType,
  filterIds: ReadonlySet<number> = new Set(),
): SidekickManifestPart[] {
  const filteredPartIds = filterIds.size > 0
    ? new Set(catalog.partFilterRows.filter((row) => filterIds.has(row.filterId)).map((row) => row.partId))
    : null;
  return getInstalledParts(catalog)
    .filter((part) => (
      (partType === undefined || part.type === partType) &&
      isPartCompatible(catalog, part, speciesId) &&
      (!filteredPartIds || filteredPartIds.has(part.id))
    ))
    .sort((left, right) => left.name.localeCompare(right.name));
}

export function getDefaultBaseParts(catalog: SidekickCatalog, speciesId: number): SidekickManifestPart[] {
  const declared = catalog.species.find((species) => species.id === speciesId)?.defaultParts;
  if (declared?.length) {
    const byName = new Map(getInstalledParts(catalog).map((part) => [part.name, part]));
    return declared
      .map((entry) => byName.get(entry.name))
      .filter((part): part is SidekickManifestPart => Boolean(part))
      .sort((left, right) => left.type - right.type);
  }
  const selected = new Map<CharacterPartType, SidekickManifestPart>();
  for (const part of getPartsForSpecies(catalog, speciesId)) {
    if (!part.name.includes('_BASE_')) continue;
    const existing = selected.get(part.type);
    if (!existing || part.speciesId === speciesId)
      selected.set(part.type, part);
  }
  return [...selected.values()].sort((left, right) => left.type - right.type);
}

export function getPlayableSpecies(catalog: SidekickCatalog): SidekickManifestSpecies[] {
  const declared = catalog.species.filter((species) => species.playable === true);
  if (declared.length > 0) return declared;
  const playable = catalog.species.filter((species) => {
    const types = new Set(getInstalledParts(catalog)
      .filter((part) => (
        part.name.includes('_BASE_') &&
        (catalog.schemaVersion && catalog.schemaVersion >= 2
          ? isPartCompatible(catalog, part, species.id)
          : part.speciesId === species.id)
      ))
      .map((part) => part.type));
    return [...CORE_PART_TYPES].every((type) => types.has(type));
  });
  if (playable.length > 0)
    return playable;
  return catalog.species.filter((species) => getPartsForSpecies(catalog, species.id).length > 0);
}

export function buildDefaultDefinition(
  catalog: SidekickCatalog,
  species: SidekickManifestSpecies,
): SidekickCharacterDefinitionV2 {
  let definition = createEmptySidekickDefinition(species.id, `${species.name} Character`);
  for (const part of getDefaultBaseParts(catalog, species.id))
    definition = setDefinitionPart(definition, part.type, part.name);

  const colorSet = catalog.colorSets.find((set) => set.speciesId === species.id) ??
    catalog.colorSets.find((set) => set.speciesId <= 0) ??
    catalog.colorSets[0];
  if (colorSet) {
    definition.colorSet = {
      id: colorSet.id,
      species: colorSet.speciesId,
      name: colorSet.name,
      sourceColorPath: colorSet.sourceColorPath,
      sourceMetallicPath: colorSet.sourceMetallicPath,
      sourceSmoothnessPath: colorSet.sourceSmoothnessPath,
      sourceReflectionPath: colorSet.sourceReflectionPath,
      sourceEmissionPath: colorSet.sourceEmissionPath,
      sourceOpacityPath: colorSet.sourceOpacityPath,
    };
    // The database's default rows are FF0000 sentinels. Build a usable initial
    // palette from one real preset per color group instead.
    const rows = new Map<number, SidekickSerializedColorRow>();
    for (let group = 1; group <= 5; group++) {
      const candidates = catalog.colorPresets.filter((preset) => (
        preset.colorGroup === group &&
        (preset.speciesId === species.id || preset.speciesId <= 0)
      ));
      const preferred = group === 1
        ? candidates.find((preset) => preset.name.toLowerCase() === `${species.name.toLowerCase()} - tan`)
        : undefined;
      const preset = preferred ?? candidates[0];
      if (!preset) continue;
      for (const row of getColorPresetRows(catalog, preset.id))
        rows.set(row.colorPropertyId, row);
    }
    definition.colorRows = [...rows.values()].sort(
      (left, right) => left.colorPropertyId - right.colorPropertyId,
    );
  }
  return definition;
}

export function findPreviewSpecies(catalog: SidekickCatalog): SidekickManifestSpecies | null {
  const playable = getPlayableSpecies(catalog);
  return playable.find((species) => species.name.toLowerCase().includes('human')) ?? playable[0] ?? null;
}

export function getPartMeshUrl(catalog: SidekickCatalog, partName: string): string | null {
  const part = getPartByName(catalog, partName);
  return part?.meshUrl ? resolveSidekickUrl(part.meshUrl) : null;
}

export function getBaseModelUrl(catalog: SidekickCatalog): string {
  return resolveSidekickUrl(catalog.assets?.baseModelUrl ?? 'base/SK_BaseModel.glb');
}

export function catalogAssetBase(): string {
  return SIDEKICK_ASSET_BASE;
}

export function getPartGroupTypes(groupId: number): readonly CharacterPartType[] {
  return SIDEKICK_PART_GROUPS.find((group) => group.id === groupId)?.types ?? [];
}

export function getCompletePartPresets(
  catalog: SidekickCatalog,
  speciesId: number,
  selectedFilterIds: ReadonlySet<number> = new Set(),
): SidekickManifestPartPreset[] {
  const installedNames = new Set(getInstalledParts(catalog).map((part) => part.name));
  const allowedPresetIds = selectedFilterIds.size > 0
    ? new Set(catalog.presetFilterRows
      .filter((row) => selectedFilterIds.has(row.filterId))
      .map((row) => row.presetId))
    : null;
  return catalog.partPresets.filter((preset) => {
    if (preset.speciesId !== speciesId || (allowedPresetIds && !allowedPresetIds.has(preset.id)))
      return false;
    const rows = catalog.partPresetRows.filter((row) => row.presetId === preset.id);
    return rows.length > 0 && rows.every((row) => installedNames.has(row.partName));
  }).sort((left, right) => left.name.localeCompare(right.name));
}

export function getPresetParts(
  catalog: SidekickCatalog,
  presetId: number,
): SidekickManifestPart[] {
  const names = new Set(catalog.partPresetRows
    .filter((row) => row.presetId === presetId)
    .map((row) => row.partName));
  return getInstalledParts(catalog).filter((part) => names.has(part.name));
}

export function getColorPresets(
  catalog: SidekickCatalog,
  speciesId: number,
  colorGroup?: number,
): SidekickManifestColorPreset[] {
  return catalog.colorPresets.filter((preset) => (
    (preset.speciesId === speciesId || preset.speciesId <= 0) &&
    (colorGroup === undefined || preset.colorGroup === colorGroup)
  )).sort((left, right) => left.name.localeCompare(right.name));
}

export function getColorPresetRows(
  catalog: SidekickCatalog,
  presetId: number,
): SidekickSerializedColorRow[] {
  return catalog.colorPresetRows
    .filter((row) => row.colorPresetId === presetId)
    .map((row) => ({
      colorPropertyId: row.colorPropertyId,
      color: row.color,
      metallic: row.metallic,
      smoothness: row.smoothness,
      reflection: row.reflection,
      emission: row.emission,
      opacity: row.opacity,
    }));
}

export function getRelevantColorPropertyIds(
  catalog: SidekickCatalog,
  definition: SidekickCharacterDefinitionV2,
): Set<number> {
  const selected = definition.parts
    .map((selection) => getPartByName(catalog, selection.name))
    .filter((part): part is SidekickManifestPart => Boolean(part));
  const declared = selected.flatMap((part) => part.usedColorPropertyIds ?? []);
  if (declared.length > 0)
    return new Set(declared);
  // Legacy manifests have no per-part UV metadata. Showing all rows preserves access.
  return new Set(catalog.colorProperties.map((property) => property.id));
}
