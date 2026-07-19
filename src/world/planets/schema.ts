import type {
  Biome,
  LandingSiteHint,
  Planet,
  PlanetSpawnCatalog,
  PlanetSpawnEntry,
  PlanetSpawnLayer,
  SurfaceSpawnCollider,
  VegetationSettings,
  WaterBody,
} from '../../types';

const DEFAULT_GRASS_COLOR = '#7a9f42';

const DEFAULT_VEGETATION: VegetationSettings = Object.freeze({
  grass: Object.freeze({
    density: 1,
    gapMeters: 0,
    minScale: 0.35,
    maxScale: 1.0,
    assetUrls: Object.freeze([]) as unknown as string[],
    color: DEFAULT_GRASS_COLOR,
  }),
  tree: Object.freeze({
    density: 1,
    gapMeters: 0,
    minScale: 1.1,
    maxScale: 3.5,
    assetUrls: Object.freeze([]) as unknown as string[],
  }),
});

/** Default shared probes per tile (matches legacy per-layer base). */
export const DEFAULT_SPAWN_SAMPLES_PER_TILE = 96;

/**
 * Planet documents are the contract between the Planet Authoring editor and
 * runtime generation: identity, physics, height recipe, hydrology, surface
 * palette, vegetation defaults, and surface spawn catalog. Files live under
 * src/world/planets/data/<id>.planet.json.
 */

export type {
  PlanetSpawnCatalog,
  PlanetSpawnEntry,
  PlanetSpawnLayer,
  SurfaceSpawnCollider,
};

export interface PlanetHeightRecipe {
  continentScale: number;
  continentWeight: number;
  detailScale: number;
  detailWeight: number;
  ridgeScale: number;
  ridgeWeight: number;
  localRidgeScale: number;
  localRidgeWeight: number;
  mountainBaseUplift: number;
  hillScale: number;
  hillBaseWeight: number;
  hillRegionWeight: number;
  landMaskBias: number;
  landMaskScale: number;
}

export interface PlanetRegionRecipe {
  noiseSeedOffset: number;
  noiseScale: number;
  noiseOctaves: number;
  contrast: number;
  mountainRegionStart: number;
  mountainRegionFull: number;
  hillRegionStart: number;
  hillRegionFull: number;
}

export interface PlanetHydrologyRecipe {
  lakeNoiseSeedOffset: number;
  lakeMaskThreshold: number;
  lakeMaxCarveNormalized: number;
  lakeMinLandElevation: number;
  inlandLakeMoistureThreshold: number;
  inlandLakeWaterLevelNormalized: number;
  riverNoiseSeedOffset: number;
  riverFieldScale: number;
  riverFieldOctaves: number;
  riverHalfWidth: number;
  riverMaxCarveNormalized: number;
  riverMinLandElevation: number;
  riverMaxLandElevation: number;
  riverMinStrength: number;
}

/**
 * Authorable land-biome and ocean-shore classification. Hydrology remains a
 * separate generated feature: lakes and rivers are not biomes.
 */
export interface PlanetBiomeRecipe {
  enabled: Biome[];
  fallbackBiome: Biome;
  forestMoistureMin: number;
  plainsMoistureMin: number;
  arcticLatitudeStart: number;
  arcticTemperatureMax: number;
  mountainRegionThreshold: number;
  highlandNormalizedHeight: number;
  extremeHighlandNormalizedHeight: number;
  peakTemperatureMax: number;
  oceanWaterLevelMeters: number;
  coastMaxHeightMeters: number;
  coastalShelfHalfWidthNormalized: number;
}

export type SurfacePaletteKey = Biome | WaterBody | 'coast';

/** CSS hex colors for land biomes, water bodies, and the derived ocean coast. */
export type PlanetSurfacePalette = Record<SurfacePaletteKey, string>;

export interface PlanetDocument {
  id: string;
  name: string;
  seed: number;
  radiusMeters: number;
  gravityMetersPerSecond2: number;
  atmosphereHeightMeters: number;
  terrainAmplitudeMeters: number;
  dragSeaLevel: number;
  height: PlanetHeightRecipe;
  regions: PlanetRegionRecipe;
  hydrology: PlanetHydrologyRecipe;
  biomes: PlanetBiomeRecipe;
  palette: PlanetSurfacePalette;
  vegetation: VegetationSettings;
  /** Authored surface spawn catalog (rocks, props, etc.). */
  spawning: PlanetSpawnCatalog;
  spawnHint?: LandingSiteHint;
}

export const DEFAULT_SPAWN_COLLIDER: SurfaceSpawnCollider = Object.freeze({
  shape: 'box' as const,
  halfExtents: [0.5, 0.5, 0.5] as [number, number, number],
});

function seedOffsetFromId(id: string): number {
  let hash = 0;
  for (let i = 0; i < id.length; i += 1) {
    hash = (Math.imul(hash, 31) + id.charCodeAt(i)) >>> 0;
  }
  return hash % 10_000;
}

export function createDefaultSpawnEntry(
  id: string,
  name = 'Spawn entry',
): PlanetSpawnEntry {
  return {
    id,
    name,
    assetUrl: '',
    enabled: true,
    weight: 1,
    density: 1,
    gapMeters: 4,
    minScale: 0.8,
    maxScale: 1.4,
    biomes: ['plains'],
    minNormalizedHeight: 0,
    maxNormalizedHeight: 1,
    alignToNormal: true,
    terrainInsetMeters: 0,
    collider: {
      shape: 'box',
      halfExtents: [0.5, 0.5, 0.5],
    },
    seedOffset: seedOffsetFromId(id),
  };
}

/** @deprecated Prefer createDefaultSpawnEntry. */
export function createDefaultSpawnLayer(
  id: string,
  name = 'Spawn layer',
): PlanetSpawnLayer {
  return createDefaultSpawnEntry(id, name);
}

export function createDefaultSpawnCatalog(
  entries: PlanetSpawnEntry[] = [],
): PlanetSpawnCatalog {
  return {
    samplesPerTile: DEFAULT_SPAWN_SAMPLES_PER_TILE,
    density: 1,
    entries,
  };
}

export const PLANET_ID_PATTERN = /^[a-z0-9][a-z0-9-]{0,63}$/;

export const DEFAULT_HEIGHT_RECIPE: PlanetHeightRecipe = Object.freeze({
  continentScale: 1.2,
  continentWeight: 0.4,
  detailScale: 8000,
  detailWeight: 0.01,
  ridgeScale: 3.5,
  ridgeWeight: 0.45,
  localRidgeScale: 400,
  localRidgeWeight: 0.15,
  mountainBaseUplift: 0.1,
  hillScale: 1200,
  hillBaseWeight: 0.02,
  hillRegionWeight: 0.13,
  landMaskBias: 0.05,
  landMaskScale: 4,
});

export const DEFAULT_REGION_RECIPE: PlanetRegionRecipe = Object.freeze({
  noiseSeedOffset: 4242,
  noiseScale: 0.9,
  noiseOctaves: 4,
  contrast: 1.6,
  mountainRegionStart: 0.55,
  mountainRegionFull: 0.75,
  hillRegionStart: 0.3,
  hillRegionFull: 0.5,
});

export const DEFAULT_HYDROLOGY_RECIPE: PlanetHydrologyRecipe = Object.freeze({
  lakeNoiseSeedOffset: 9012,
  lakeMaskThreshold: 0.64,
  lakeMaxCarveNormalized: 0.14,
  lakeMinLandElevation: 0.02,
  inlandLakeMoistureThreshold: 0.55,
  inlandLakeWaterLevelNormalized: 0.05,
  riverNoiseSeedOffset: 7777,
  riverFieldScale: 7,
  riverFieldOctaves: 3,
  riverHalfWidth: 0.018,
  riverMaxCarveNormalized: 0.045,
  riverMinLandElevation: 0.02,
  riverMaxLandElevation: 0.55,
  riverMinStrength: 0.05,
});

export const BIOME_KEYS: readonly Biome[] = Object.freeze([
  'desert',
  'plains',
  'forest',
  'tundra',
  'highlands',
  'peak',
  'rock',
]);

export const DEFAULT_BIOME_RECIPE: PlanetBiomeRecipe = Object.freeze({
  enabled: Object.freeze([
    'desert',
    'plains',
    'forest',
    'tundra',
    'highlands',
    'peak',
  ]) as unknown as Biome[],
  fallbackBiome: 'plains',
  forestMoistureMin: 0.6,
  plainsMoistureMin: 0.3,
  arcticLatitudeStart: 0.65,
  arcticTemperatureMax: 0.28,
  mountainRegionThreshold: 0.35,
  highlandNormalizedHeight: 0.45,
  extremeHighlandNormalizedHeight: 0.75,
  peakTemperatureMax: 0.3,
  oceanWaterLevelMeters: 20,
  coastMaxHeightMeters: 30,
  coastalShelfHalfWidthNormalized: 0.04,
});

export const SURFACE_PALETTE_KEYS: readonly SurfacePaletteKey[] = Object.freeze([
  'ocean',
  'lake',
  'river',
  'coast',
  ...BIOME_KEYS,
]);

export const DEFAULT_SURFACE_PALETTE: PlanetSurfacePalette = Object.freeze({
  ocean: '#173653',
  lake: '#53665a',
  river: '#776f50',
  coast: '#d8c58e',
  desert: '#c89b62',
  plains: '#719447',
  forest: '#3e6c42',
  tundra: '#ffffff',
  highlands: '#8b9088',
  peak: '#f8fbff',
  rock: '#737887',
});

/** Shallow ocean blend target used by the terrain facet shader. */
export const DEFAULT_OCEAN_SHALLOW = '#3f7898';

export const DEFAULT_PLANET_SEED = 20061;

export function planetPhysicsFromDocument(doc: Pick<
  PlanetDocument,
  | 'name'
  | 'radiusMeters'
  | 'gravityMetersPerSecond2'
  | 'atmosphereHeightMeters'
  | 'terrainAmplitudeMeters'
  | 'dragSeaLevel'
>): Planet {
  return {
    name: doc.name,
    radiusMeters: doc.radiusMeters,
    gravityMetersPerSecond2: doc.gravityMetersPerSecond2,
    atmosphereHeightMeters: doc.atmosphereHeightMeters,
    terrainAmplitudeMeters: doc.terrainAmplitudeMeters,
    dragSeaLevel: doc.dragSeaLevel,
  };
}

function isFiniteNumber(value: unknown): value is number {
  return typeof value === 'number' && Number.isFinite(value);
}

function readNumber(value: unknown, fallback: number): number {
  return isFiniteNumber(value) ? value : fallback;
}

function readHexColor(value: unknown, fallback: string): string {
  if (typeof value !== 'string') return fallback;
  const trimmed = value.trim();
  if (!/^#[0-9a-fA-F]{6}$/.test(trimmed)) return fallback;
  return trimmed.toLowerCase();
}

function readHeight(raw: unknown): PlanetHeightRecipe {
  const src = raw && typeof raw === 'object' ? (raw as Record<string, unknown>) : {};
  return {
    continentScale: readNumber(src.continentScale, DEFAULT_HEIGHT_RECIPE.continentScale),
    continentWeight: readNumber(src.continentWeight, DEFAULT_HEIGHT_RECIPE.continentWeight),
    detailScale: readNumber(src.detailScale, DEFAULT_HEIGHT_RECIPE.detailScale),
    detailWeight: readNumber(src.detailWeight, DEFAULT_HEIGHT_RECIPE.detailWeight),
    ridgeScale: readNumber(src.ridgeScale, DEFAULT_HEIGHT_RECIPE.ridgeScale),
    ridgeWeight: readNumber(src.ridgeWeight, DEFAULT_HEIGHT_RECIPE.ridgeWeight),
    localRidgeScale: readNumber(src.localRidgeScale, DEFAULT_HEIGHT_RECIPE.localRidgeScale),
    localRidgeWeight: readNumber(src.localRidgeWeight, DEFAULT_HEIGHT_RECIPE.localRidgeWeight),
    mountainBaseUplift: readNumber(src.mountainBaseUplift, DEFAULT_HEIGHT_RECIPE.mountainBaseUplift),
    hillScale: readNumber(src.hillScale, DEFAULT_HEIGHT_RECIPE.hillScale),
    hillBaseWeight: readNumber(src.hillBaseWeight, DEFAULT_HEIGHT_RECIPE.hillBaseWeight),
    hillRegionWeight: readNumber(src.hillRegionWeight, DEFAULT_HEIGHT_RECIPE.hillRegionWeight),
    landMaskBias: readNumber(src.landMaskBias, DEFAULT_HEIGHT_RECIPE.landMaskBias),
    landMaskScale: readNumber(src.landMaskScale, DEFAULT_HEIGHT_RECIPE.landMaskScale),
  };
}

function readRegions(raw: unknown): PlanetRegionRecipe {
  const src = raw && typeof raw === 'object' ? (raw as Record<string, unknown>) : {};
  return {
    noiseSeedOffset: readNumber(src.noiseSeedOffset, DEFAULT_REGION_RECIPE.noiseSeedOffset),
    noiseScale: readNumber(src.noiseScale, DEFAULT_REGION_RECIPE.noiseScale),
    noiseOctaves: Math.max(1, Math.round(readNumber(src.noiseOctaves, DEFAULT_REGION_RECIPE.noiseOctaves))),
    contrast: readNumber(src.contrast, DEFAULT_REGION_RECIPE.contrast),
    mountainRegionStart: readNumber(src.mountainRegionStart, DEFAULT_REGION_RECIPE.mountainRegionStart),
    mountainRegionFull: readNumber(src.mountainRegionFull, DEFAULT_REGION_RECIPE.mountainRegionFull),
    hillRegionStart: readNumber(src.hillRegionStart, DEFAULT_REGION_RECIPE.hillRegionStart),
    hillRegionFull: readNumber(src.hillRegionFull, DEFAULT_REGION_RECIPE.hillRegionFull),
  };
}

function readHydrology(raw: unknown): PlanetHydrologyRecipe {
  const src = raw && typeof raw === 'object' ? (raw as Record<string, unknown>) : {};
  return {
    lakeNoiseSeedOffset: readNumber(src.lakeNoiseSeedOffset, DEFAULT_HYDROLOGY_RECIPE.lakeNoiseSeedOffset),
    lakeMaskThreshold: readNumber(src.lakeMaskThreshold, DEFAULT_HYDROLOGY_RECIPE.lakeMaskThreshold),
    lakeMaxCarveNormalized: readNumber(
      src.lakeMaxCarveNormalized,
      DEFAULT_HYDROLOGY_RECIPE.lakeMaxCarveNormalized,
    ),
    lakeMinLandElevation: readNumber(src.lakeMinLandElevation, DEFAULT_HYDROLOGY_RECIPE.lakeMinLandElevation),
    inlandLakeMoistureThreshold: readNumber(
      src.inlandLakeMoistureThreshold,
      DEFAULT_HYDROLOGY_RECIPE.inlandLakeMoistureThreshold,
    ),
    // Legacy planet files called this a maximum and paired it with a
    // terrain-relative depth. Preserve their authored level while normalizing
    // the runtime model to one explicit lake plane.
    inlandLakeWaterLevelNormalized: readNumber(
      src.inlandLakeWaterLevelNormalized,
      readNumber(
        src.inlandLakeMaxNormalized,
        DEFAULT_HYDROLOGY_RECIPE.inlandLakeWaterLevelNormalized,
      ),
    ),
    riverNoiseSeedOffset: readNumber(src.riverNoiseSeedOffset, DEFAULT_HYDROLOGY_RECIPE.riverNoiseSeedOffset),
    riverFieldScale: readNumber(src.riverFieldScale, DEFAULT_HYDROLOGY_RECIPE.riverFieldScale),
    riverFieldOctaves: Math.max(
      1,
      Math.round(readNumber(src.riverFieldOctaves, DEFAULT_HYDROLOGY_RECIPE.riverFieldOctaves)),
    ),
    riverHalfWidth: readNumber(src.riverHalfWidth, DEFAULT_HYDROLOGY_RECIPE.riverHalfWidth),
    riverMaxCarveNormalized: readNumber(
      src.riverMaxCarveNormalized,
      DEFAULT_HYDROLOGY_RECIPE.riverMaxCarveNormalized,
    ),
    riverMinLandElevation: readNumber(
      src.riverMinLandElevation,
      DEFAULT_HYDROLOGY_RECIPE.riverMinLandElevation,
    ),
    riverMaxLandElevation: readNumber(
      src.riverMaxLandElevation,
      DEFAULT_HYDROLOGY_RECIPE.riverMaxLandElevation,
    ),
    riverMinStrength: readNumber(src.riverMinStrength, DEFAULT_HYDROLOGY_RECIPE.riverMinStrength),
  };
}

function readBiomes(raw: unknown): PlanetBiomeRecipe {
  const src = raw && typeof raw === 'object' ? (raw as Record<string, unknown>) : {};
  const authoredEnabled = Array.isArray(src.enabled)
    ? src.enabled.filter(
        (value): value is Biome =>
          typeof value === 'string' && (BIOME_KEYS as readonly string[]).includes(value),
      )
    : [];
  const enabled = [...new Set(
    authoredEnabled.length > 0 ? authoredEnabled : DEFAULT_BIOME_RECIPE.enabled,
  )];
  const authoredFallback =
    typeof src.fallbackBiome === 'string' &&
    (BIOME_KEYS as readonly string[]).includes(src.fallbackBiome)
      ? (src.fallbackBiome as Biome)
      : DEFAULT_BIOME_RECIPE.fallbackBiome;
  const fallbackBiome = enabled.includes(authoredFallback)
    ? authoredFallback
    : (enabled[0] ?? DEFAULT_BIOME_RECIPE.fallbackBiome);
  return {
    enabled,
    fallbackBiome,
    forestMoistureMin: readNumber(
      src.forestMoistureMin,
      DEFAULT_BIOME_RECIPE.forestMoistureMin,
    ),
    plainsMoistureMin: readNumber(
      src.plainsMoistureMin,
      DEFAULT_BIOME_RECIPE.plainsMoistureMin,
    ),
    arcticLatitudeStart: readNumber(
      src.arcticLatitudeStart,
      DEFAULT_BIOME_RECIPE.arcticLatitudeStart,
    ),
    arcticTemperatureMax: readNumber(
      src.arcticTemperatureMax,
      DEFAULT_BIOME_RECIPE.arcticTemperatureMax,
    ),
    mountainRegionThreshold: readNumber(
      src.mountainRegionThreshold,
      DEFAULT_BIOME_RECIPE.mountainRegionThreshold,
    ),
    highlandNormalizedHeight: readNumber(
      src.highlandNormalizedHeight,
      DEFAULT_BIOME_RECIPE.highlandNormalizedHeight,
    ),
    extremeHighlandNormalizedHeight: readNumber(
      src.extremeHighlandNormalizedHeight,
      DEFAULT_BIOME_RECIPE.extremeHighlandNormalizedHeight,
    ),
    peakTemperatureMax: readNumber(
      src.peakTemperatureMax,
      DEFAULT_BIOME_RECIPE.peakTemperatureMax,
    ),
    oceanWaterLevelMeters: readNumber(
      src.oceanWaterLevelMeters,
      DEFAULT_BIOME_RECIPE.oceanWaterLevelMeters,
    ),
    coastMaxHeightMeters: readNumber(
      src.coastMaxHeightMeters,
      DEFAULT_BIOME_RECIPE.coastMaxHeightMeters,
    ),
    coastalShelfHalfWidthNormalized: readNumber(
      src.coastalShelfHalfWidthNormalized,
      DEFAULT_BIOME_RECIPE.coastalShelfHalfWidthNormalized,
    ),
  };
}

function readPalette(raw: unknown): PlanetSurfacePalette {
  const src = raw && typeof raw === 'object' ? (raw as Record<string, unknown>) : {};
  const palette = { ...DEFAULT_SURFACE_PALETTE };
  for (const key of SURFACE_PALETTE_KEYS) {
    const authoredValue = key === 'coast' ? (src.coast ?? src.beach) : src[key];
    palette[key] = readHexColor(authoredValue, DEFAULT_SURFACE_PALETTE[key]);
  }
  // Pre-arctic defaults were sage/olive; migrate so arctic reads as snow and
  // alpine as rock/lichen without forcing authors to hand-edit every planet.
  const tundraHex = palette.tundra.toLowerCase();
  if (tundraHex === '#9eaa91' || tundraHex === '#e8eef4' || tundraHex === '#f4f7fb') {
    palette.tundra = DEFAULT_SURFACE_PALETTE.tundra;
  }
  if (palette.highlands.toLowerCase() === '#7f895f') {
    palette.highlands = DEFAULT_SURFACE_PALETTE.highlands;
  }
  const peakHex = palette.peak.toLowerCase();
  if (peakHex === '#e7e6dc' || peakHex === '#f2f4f6' || peakHex === '#f7f8fa') {
    palette.peak = DEFAULT_SURFACE_PALETTE.peak;
  }
  return palette;
}

function isTreeVegetationAssetUrl(value: unknown): value is string {
  return (
    typeof value === 'string' &&
    value.startsWith('/') &&
    /\.(glb|gltf)(\?|$)/i.test(value)
  );
}

function isGrassVegetationAssetUrl(value: unknown): value is string {
  return (
    typeof value === 'string' &&
    value.startsWith('/') &&
    /\.(png|jpe?g|webp)(\?|$)/i.test(value)
  );
}

function readVegetationAssetUrls(
  raw: unknown,
  kind: 'grass' | 'tree',
): string[] {
  if (!Array.isArray(raw)) return [];
  const accept =
    kind === 'grass' ? isGrassVegetationAssetUrl : isTreeVegetationAssetUrl;
  const urls: string[] = [];
  for (const entry of raw) {
    if (!accept(entry)) continue;
    const trimmed = entry.trim();
    if (trimmed.length === 0) continue;
    urls.push(trimmed);
  }
  return urls;
}

function readVegetation(raw: unknown): VegetationSettings {
  const src = raw && typeof raw === 'object' ? (raw as Record<string, unknown>) : {};
  const grass = src.grass && typeof src.grass === 'object' ? (src.grass as Record<string, unknown>) : {};
  const tree = src.tree && typeof src.tree === 'object' ? (src.tree as Record<string, unknown>) : {};
  return {
    grass: {
      density: readNumber(grass.density, DEFAULT_VEGETATION.grass.density),
      gapMeters: readNumber(grass.gapMeters, DEFAULT_VEGETATION.grass.gapMeters),
      minScale: readNumber(grass.minScale, DEFAULT_VEGETATION.grass.minScale),
      maxScale: readNumber(grass.maxScale, DEFAULT_VEGETATION.grass.maxScale),
      assetUrls: readVegetationAssetUrls(grass.assetUrls, 'grass'),
      color: readHexColor(
        grass.color,
        DEFAULT_VEGETATION.grass.color ?? DEFAULT_GRASS_COLOR,
      ),
    },
    tree: {
      density: readNumber(tree.density, DEFAULT_VEGETATION.tree.density),
      gapMeters: readNumber(tree.gapMeters, DEFAULT_VEGETATION.tree.gapMeters),
      minScale: readNumber(tree.minScale, DEFAULT_VEGETATION.tree.minScale),
      maxScale: readNumber(tree.maxScale, DEFAULT_VEGETATION.tree.maxScale),
      assetUrls: readVegetationAssetUrls(tree.assetUrls, 'tree'),
    },
  };
}

function readSpawnHint(raw: unknown): LandingSiteHint | undefined {
  if (!raw || typeof raw !== 'object') return undefined;
  const src = raw as Record<string, unknown>;
  if (!isFiniteNumber(src.latRadians) || !isFiniteNumber(src.lonRadians)) return undefined;
  return { latRadians: src.latRadians, lonRadians: src.lonRadians };
}

const ALL_BIOMES = BIOME_KEYS;

function readCollider(raw: unknown): SurfaceSpawnCollider {
  const src = raw && typeof raw === 'object' ? (raw as Record<string, unknown>) : {};
  const shape = src.shape === 'capsule' ? 'capsule' : 'box';
  if (shape === 'capsule') {
    return {
      shape: 'capsule',
      radius: Math.max(0.05, readNumber(src.radius, 0.4)),
      halfHeight: Math.max(0.05, readNumber(src.halfHeight, 0.5)),
    };
  }
  const extents = Array.isArray(src.halfExtents) ? src.halfExtents : [];
  return {
    shape: 'box',
    halfExtents: [
      Math.max(0.05, readNumber(extents[0], 0.5)),
      Math.max(0.05, readNumber(extents[1], 0.5)),
      Math.max(0.05, readNumber(extents[2], 0.5)),
    ],
  };
}

function readSpawnEntry(raw: unknown, index: number): PlanetSpawnEntry | null {
  if (!raw || typeof raw !== 'object') return null;
  const src = raw as Record<string, unknown>;
  const id =
    typeof src.id === 'string' && src.id.trim()
      ? src.id.trim()
      : `spawn-${index + 1}`;
  const name =
    typeof src.name === 'string' && src.name.trim() ? src.name.trim() : id;
  const assetUrl = typeof src.assetUrl === 'string' ? src.assetUrl.trim() : '';
  const biomesRaw = Array.isArray(src.biomes) ? src.biomes : [];
  const biomes = biomesRaw.filter(
    (value): value is Biome =>
      typeof value === 'string' && (ALL_BIOMES as string[]).includes(value),
  );
  const minH = readNumber(src.minNormalizedHeight, 0);
  const maxH = readNumber(src.maxNormalizedHeight, 1);
  return {
    id,
    name,
    assetUrl,
    enabled: src.enabled !== false,
    weight: Math.max(0, readNumber(src.weight, 1)),
    density: Math.max(0, readNumber(src.density, 1)),
    gapMeters: Math.max(0, readNumber(src.gapMeters, 4)),
    minScale: Math.max(0.01, readNumber(src.minScale, 0.8)),
    maxScale: Math.max(0.01, readNumber(src.maxScale, 1.4)),
    biomes,
    minNormalizedHeight: Math.min(minH, maxH),
    maxNormalizedHeight: Math.max(minH, maxH),
    alignToNormal: src.alignToNormal !== false,
    terrainInsetMeters: readNumber(src.terrainInsetMeters, 0),
    collider: readCollider(src.collider),
    seedOffset: Math.round(readNumber(src.seedOffset, seedOffsetFromId(id))),
  };
}

function readSpawnEntries(raw: unknown): PlanetSpawnEntry[] {
  if (!Array.isArray(raw)) return [];
  const entries: PlanetSpawnEntry[] = [];
  for (let i = 0; i < raw.length; i += 1) {
    const entry = readSpawnEntry(raw[i], i);
    if (entry) entries.push(entry);
  }
  return entries;
}

/**
 * Parse spawning: legacy `PlanetSpawnLayer[]` migrates 1:1 into a catalog;
 * object shape is the Surface Spawn Catalog.
 */
function readSpawning(raw: unknown): PlanetSpawnCatalog {
  if (Array.isArray(raw)) {
    return createDefaultSpawnCatalog(readSpawnEntries(raw));
  }
  if (!raw || typeof raw !== 'object') {
    return createDefaultSpawnCatalog();
  }
  const src = raw as Record<string, unknown>;
  const samplesPerTile = Math.max(
    0,
    Math.round(readNumber(src.samplesPerTile, DEFAULT_SPAWN_SAMPLES_PER_TILE)),
  );
  const density = Math.max(0, readNumber(src.density, 1));
  return {
    samplesPerTile,
    density,
    entries: readSpawnEntries(src.entries),
  };
}

/** Flatten catalog entries for APIs that still take a layer/entry list. */
export function spawnCatalogEntries(
  catalog: PlanetSpawnCatalog | readonly PlanetSpawnEntry[] | null | undefined,
): PlanetSpawnEntry[] {
  if (!catalog) return [];
  if (Array.isArray(catalog)) {
    return [...(catalog as readonly PlanetSpawnEntry[])];
  }
  const asCatalog = catalog as PlanetSpawnCatalog;
  return [...asCatalog.entries];
}

/** Validates and normalizes unknown JSON into a PlanetDocument. */
export function parsePlanetDocument(raw: unknown): PlanetDocument | null {
  if (!raw || typeof raw !== 'object') return null;
  const src = raw as Record<string, unknown>;
  const id = typeof src.id === 'string' ? src.id.trim() : '';
  if (!PLANET_ID_PATTERN.test(id)) return null;
  const name = typeof src.name === 'string' && src.name.trim() ? src.name.trim() : id;
  return {
    id,
    name,
    seed: Math.round(readNumber(src.seed, DEFAULT_PLANET_SEED)),
    radiusMeters: readNumber(src.radiusMeters, 6_371_000),
    gravityMetersPerSecond2: readNumber(src.gravityMetersPerSecond2, 9.8),
    atmosphereHeightMeters: readNumber(src.atmosphereHeightMeters, 110_000),
    terrainAmplitudeMeters: readNumber(src.terrainAmplitudeMeters, 7_500),
    dragSeaLevel: readNumber(src.dragSeaLevel, 0.015),
    height: readHeight(src.height),
    regions: readRegions(src.regions),
    hydrology: readHydrology(src.hydrology),
    biomes: readBiomes(src.biomes),
    palette: readPalette(src.palette),
    vegetation: readVegetation(src.vegetation),
    spawning: readSpawning(src.spawning),
    spawnHint: readSpawnHint(src.spawnHint),
  };
}

export function createDefaultPlanetDocument(
  id = 'asteron',
  name = 'Asteron',
): PlanetDocument {
  return {
    id,
    name,
    seed: DEFAULT_PLANET_SEED,
    radiusMeters: 6_371_000,
    gravityMetersPerSecond2: 9.8,
    atmosphereHeightMeters: 110_000,
    terrainAmplitudeMeters: 7_500,
    dragSeaLevel: 0.015,
    height: { ...DEFAULT_HEIGHT_RECIPE },
    regions: { ...DEFAULT_REGION_RECIPE },
    hydrology: { ...DEFAULT_HYDROLOGY_RECIPE },
    biomes: {
      ...DEFAULT_BIOME_RECIPE,
      enabled: [...DEFAULT_BIOME_RECIPE.enabled],
    },
    palette: { ...DEFAULT_SURFACE_PALETTE },
    vegetation: {
      grass: {
        ...DEFAULT_VEGETATION.grass,
        assetUrls: [...DEFAULT_VEGETATION.grass.assetUrls],
      },
      tree: {
        ...DEFAULT_VEGETATION.tree,
        assetUrls: [...DEFAULT_VEGETATION.tree.assetUrls],
      },
    },
    spawning: createDefaultSpawnCatalog(),
  };
}
