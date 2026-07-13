import {
  CharacterPartType,
  resolveSidekickUrl,
  SIDEKICK_ASSET_BASE,
  type SidekickCatalog,
  type SidekickManifestPart,
  type SidekickManifestSpecies,
} from './sidekick_manifest';
import {
  createEmptySidekickDefinition,
  setDefinitionPart,
  type SidekickCharacterDefinition,
} from './sidekick_definition';

let catalogPromise: Promise<SidekickCatalog> | null = null;

function normalizeCatalog(raw: unknown): SidekickCatalog {
  if (!raw || typeof raw !== 'object')
    throw new Error('Sidekick manifest is not a JSON object.');

  const manifest = raw as Partial<SidekickCatalog>;
  if (!Array.isArray(manifest.species) || !Array.isArray(manifest.parts))
    throw new Error('Sidekick manifest is empty or invalid. Re-run ClaudeCitizen → Export Synty Sidekick in Unity (catalog export).');

  return manifest as SidekickCatalog;
}

export async function loadSidekickCatalog(): Promise<SidekickCatalog> {
  if (!catalogPromise) {
    catalogPromise = fetch(resolveSidekickUrl('manifest.json'))
      .then((response) => {
        if (!response.ok) {
          throw new Error(`Failed to load Sidekick manifest (${response.status})`);
        }
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

export function getSpeciesById(
  catalog: SidekickCatalog,
  speciesId: number,
): SidekickManifestSpecies | null {
  return catalog.species.find((species) => species.id === speciesId) ?? null;
}

export function getSpeciesByName(
  catalog: SidekickCatalog,
  name: string,
): SidekickManifestSpecies | null {
  return (
    catalog.species.find(
      (species) => species.name.localeCompare(name, undefined, { sensitivity: 'accent' }) === 0,
    ) ?? null
  );
}

export function getPartByName(
  catalog: SidekickCatalog,
  partName: string,
): SidekickManifestPart | null {
  return catalog.parts.find((part) => part.name === partName) ?? null;
}

export function getPartsForSpecies(
  catalog: SidekickCatalog,
  speciesId: number,
  partType?: CharacterPartType,
): SidekickManifestPart[] {
  const species = getSpeciesById(catalog, speciesId);
  const speciesCode = species?.code?.toLowerCase() ?? species?.name?.slice(0, 4).toLowerCase() ?? '';
  const unrestricted = getSpeciesByName(catalog, 'Unrestricted');

  return catalog.parts.filter((part) => {
    if (!part.fileExists || !part.meshUrl)
      return false;
    if (partType !== undefined && part.type !== partType)
      return false;
    if (part.speciesId === speciesId)
      return true;
    if (unrestricted && part.speciesId === unrestricted.id)
      return true;
    if (speciesCode && part.name.toLowerCase().includes(`_${speciesCode}_`))
      return true;
    return false;
  });
}

export function getDefaultBaseParts(
  catalog: SidekickCatalog,
  speciesId: number,
): SidekickManifestPart[] {
  const unrestricted = getSpeciesByName(catalog, 'Unrestricted');
  const effectiveSpeciesId = speciesId > 0 ? speciesId : unrestricted?.id ?? speciesId;

  const baseParts = catalog.parts.filter(
    (part) =>
      part.fileExists &&
      !!part.meshUrl &&
      part.name.includes('_BASE_') &&
      (part.speciesId === effectiveSpeciesId ||
        part.speciesId === unrestricted?.id ||
        effectiveSpeciesId <= 0),
  );

  const selected = new Map<CharacterPartType, SidekickManifestPart>();
  for (const part of baseParts) {
    const existing = selected.get(part.type);
    if (!existing || part.speciesId === effectiveSpeciesId)
      selected.set(part.type, part);
  }
  return [...selected.values()];
}

export function buildDefaultDefinition(
  catalog: SidekickCatalog,
  species: SidekickManifestSpecies,
): SidekickCharacterDefinition {
  let definition = createEmptySidekickDefinition(species.id, `${species.name} Preview`);
  for (const part of getDefaultBaseParts(catalog, species.id)) {
    definition = setDefinitionPart(definition, part.type, part.name);
  }
  return definition;
}

export function findPreviewSpecies(catalog: SidekickCatalog): SidekickManifestSpecies | null {
  const human =
    getSpeciesByName(catalog, 'Human') ??
    getSpeciesByName(catalog, 'Humans') ??
    catalog.species.find((species) => species.name.toLowerCase().includes('human'));
  if (human)
    return human;

  return (
    catalog.species.find((species) => getDefaultBaseParts(catalog, species.id).length > 0) ??
    catalog.species[0] ??
    null
  );
}

export function getPartMeshUrl(catalog: SidekickCatalog, partName: string): string | null {
  const part = getPartByName(catalog, partName);
  if (!part?.meshUrl)
    return null;
  return resolveSidekickUrl(part.meshUrl);
}

export function getBaseModelUrl(catalog: SidekickCatalog): string {
  return resolveSidekickUrl(catalog.assets?.baseModelUrl ?? 'base/SK_BaseModel.glb');
}

export function catalogAssetBase(): string {
  return SIDEKICK_ASSET_BASE;
}
