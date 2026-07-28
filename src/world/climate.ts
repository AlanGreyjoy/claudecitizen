import { altitudeForPosition, radialUp } from './coordinates';
import { oceanWaterLevelMeters } from './coastal-profile';
import { sampleLakeSurface } from './lakes';
import { sampleRiverSurface } from './rivers';
import { clamp01, fbm3d, getNoise3D } from './terrain-noise';
import { sampleTerrainRegions } from './terrain-regions';
import type { Biome, Planet, PlanetSurfaceSample, Vec3, WaterBody } from '../types';
import type { SurfaceHeightDetails } from './elevation';
import { getActivePlanetConfig } from './planets/runtime';
import type { PlanetBiomeRecipe } from './planets/schema';

const FOREST_NOISE_SEED_OFFSET = 4321;

// classifyBiome runs once per terrain vertex, per vegetation placement attempt,
// and per surface-spawn probe — tens of thousands of calls per tile. Building a
// Set from the recipe on every one of those was pure allocation churn, so key a
// single cached Set off the recipe's own array identity (stable per document).
let cachedEnabledSource: readonly Biome[] | null = null;
let cachedEnabledSet = new Set<Biome>();

function enabledBiomes(recipe: PlanetBiomeRecipe): Set<Biome> {
  if (recipe.enabled !== cachedEnabledSource) {
    cachedEnabledSource = recipe.enabled;
    cachedEnabledSet = new Set(recipe.enabled);
  }
  return cachedEnabledSet;
}

interface ClimateNoiseSet {
  forest: ReturnType<typeof getNoise3D>;
  moisture: ReturnType<typeof getNoise3D>;
  temperature: ReturnType<typeof getNoise3D>;
}

/** The three climate noise fields are seed-derived and never change mid-tile. */
let cachedClimateNoiseSeed: number | null = null;
let cachedClimateNoise: ClimateNoiseSet | null = null;

function climateNoiseForSeed(seed: number): ClimateNoiseSet {
  if (cachedClimateNoise && cachedClimateNoiseSeed === seed) return cachedClimateNoise;
  cachedClimateNoise = {
    forest: getNoise3D(seed + FOREST_NOISE_SEED_OFFSET),
    moisture: getNoise3D(seed + 5678),
    temperature: getNoise3D(seed + 1234),
  };
  cachedClimateNoiseSeed = seed;
  return cachedClimateNoise;
}

export interface BiomeClassificationInput {
  /**
   * Absolute latitude as 0 at the equator .. 1 at the poles.
   * Arctic tundra is reserved for the polar belt; alpine tundra uses elevation.
   */
  latFactor: number;
  moisture: number;
  /** How mountainous this region is (0..1); gates highlands/peak so plains at moderate elevation stay plains. */
  mountainRegion: number;
  normalizedHeight: number;
  temperature: number;
}

export interface WaterClassificationInput {
  heightMeters: number;
  lakeWaterLevelMeters: number | null;
  riverWaterLevelMeters: number | null;
}

export interface WaterClassification {
  waterBody: WaterBody | null;
  waterLevelMeters: number | null;
}

export function classifyBiome(
  input: BiomeClassificationInput,
  recipe: PlanetBiomeRecipe = getActivePlanetConfig().biomes,
): Biome {
  const {
    latFactor,
    moisture,
    mountainRegion,
    normalizedHeight,
    temperature,
  } = input;
  // Alpine tundra / peaks: high elevation anywhere (mountain regions preferred).
  // Rock/snow biomes stay out of rolling mid-elevation hills.
  const enabled = enabledBiomes(recipe);
  const highlandThreshold =
    mountainRegion > recipe.mountainRegionThreshold
      ? recipe.highlandNormalizedHeight
      : recipe.extremeHighlandNormalizedHeight;
  if (normalizedHeight > highlandThreshold) {
    if (temperature < recipe.peakTemperatureMax && enabled.has('peak')) return 'peak';
    if (enabled.has('highlands')) return 'highlands';
    if (enabled.has('rock')) return 'rock';
  }
  // Arctic tundra: polar belt between boreal forest and the poles — cold
  // lowland that is not mountain alpine.
  if (
    latFactor >= recipe.arcticLatitudeStart &&
    temperature < recipe.arcticTemperatureMax &&
    enabled.has('tundra')
  ) {
    return 'tundra';
  }
  if (moisture > recipe.forestMoistureMin && enabled.has('forest')) return 'forest';
  if (moisture > recipe.plainsMoistureMin && enabled.has('plains')) return 'plains';
  if (enabled.has('desert')) return 'desert';
  return enabled.has(recipe.fallbackBiome)
    ? recipe.fallbackBiome
    : (recipe.enabled[0] ?? 'plains');
}

/** Resolve the highest generated water surface covering this terrain sample. */
export function classifyWaterBody(input: WaterClassificationInput): WaterClassification {
  const { heightMeters, lakeWaterLevelMeters, riverWaterLevelMeters } = input;
  let waterBody: WaterBody | null = null;
  let waterLevelMeters: number | null = null;

  const consider = (candidateBody: WaterBody, candidateLevel: number | null): void => {
    if (candidateLevel == null || heightMeters >= candidateLevel - 0.5) return;
    if (waterLevelMeters != null && candidateLevel <= waterLevelMeters) return;
    waterBody = candidateBody;
    waterLevelMeters = candidateLevel;
  };

  consider('ocean', oceanWaterLevelMeters());
  consider('lake', lakeWaterLevelMeters);
  consider('river', riverWaterLevelMeters);
  return { waterBody, waterLevelMeters };
}

/** HUD / authoring label for land biomes. */
export function biomeDisplayName(biome: Biome): string {
  if (biome === 'tundra') return 'arctic';
  if (biome === 'highlands') return 'alpine';
  return biome;
}

export interface VegetationDensities {
  fertility: number;
  grassDensity: number;
  treeDensity: number;
}

export function vegetationDensitiesForBiome(biome: Biome, moisture: number): VegetationDensities {
  let fertility = 0;
  if (biome === 'forest') fertility = 0.8 + moisture * 0.2;
  else if (biome === 'plains') fertility = 0.4 + moisture * 0.4;
  else if (biome === 'tundra' || biome === 'desert') fertility = 0.1;

  const grassDensity = clamp01(fertility);
  // Plains fertility lands around 0.5-0.65, so the old `(fertility - 0.5) * 0.5`
  // produced near-zero tree density and visibly barren grasslands.
  const treeDensity =
    biome === 'forest'
      ? clamp01(fertility)
      : biome === 'plains'
        ? clamp01(fertility - 0.4) * 0.9
        : 0;

  return { fertility, grassDensity, treeDensity };
}

export function sampleSurfaceClimate(
  planet: Planet,
  seed: number,
  position: Vec3,
  heightMeters: number,
  heightDetails?: SurfaceHeightDetails,
): PlanetSurfaceSample {
  const surfaceRadiusMeters = planet.radiusMeters + heightMeters;
  const altitudeMeters = altitudeForPosition(position, surfaceRadiusMeters);
  const normalizedHeight = heightMeters / planet.terrainAmplitudeMeters;
  // One radial normalize for the whole function. latLonForPosition would
  // normalize a second time and allocate a result object per sample.
  const unit = radialUp(position);
  const latRadians = Math.asin(Math.max(-1, Math.min(1, unit.y)));
  const noise = climateNoiseForSeed(seed);

  const tempNoise = fbm3d(noise.temperature, unit.x, unit.y, unit.z, 3, 0.5, 2.0, 2.0);
  const latFactor = Math.abs(latRadians) / (Math.PI / 2);
  const altitudeFactor = Math.max(0, normalizedHeight);
  let temperature = 1.0 - latFactor - altitudeFactor * 0.5 + tempNoise * 0.2;
  temperature = clamp01(temperature);

  const mNoise = fbm3d(noise.moisture, unit.x, unit.y, unit.z, 4, 0.5, 2.0, 1.5);
  let moisture = mNoise * 0.5 + 0.5;
  moisture += Math.cos(latRadians * 3) * 0.2;
  // Softened altitude penalty so mid-elevation land can still be forest.
  moisture -= Math.max(0, normalizedHeight) * 0.1;
  // Medium-scale patch noise makes forests form coherent regions instead of
  // moisture speckle at the biome threshold.
  moisture += fbm3d(noise.forest, unit.x, unit.y, unit.z, 3, 0.5, 2.0, 3.0) * 0.25;
  moisture = clamp01(moisture);

  const mountainRegion =
    heightDetails?.mountainRegion ??
    sampleTerrainRegions(seed, unit.x, unit.y, unit.z).mountainRegion;

  const lake = sampleLakeSurface({
    heightMeters,
    lakeMask: heightDetails?.lakeMask,
    moisture,
    normalizedHeight,
    planet,
    position,
    seed,
  });
  const river = sampleRiverSurface({
    heightMeters,
    normalizedHeight,
    planet,
    position,
    preRiverElevationNormalized: heightDetails?.preRiverElevationNormalized,
    riverStrength: heightDetails?.riverStrength,
    riverWaterLevelNormalized: heightDetails?.riverWaterLevelNormalized,
    seed,
  });

  const lakeWaterLevelMeters = lake.lakeWaterLevelMeters;
  const riverWaterLevelMeters = river.riverWaterLevelMeters;
  const { waterBody, waterLevelMeters } = classifyWaterBody({
    heightMeters,
    lakeWaterLevelMeters,
    riverWaterLevelMeters,
  });

  const biome = classifyBiome({
    latFactor,
    moisture,
    mountainRegion,
    normalizedHeight,
    temperature,
  });
  const densities =
    waterBody == null
      ? vegetationDensitiesForBiome(biome, moisture)
      : { fertility: 0, grassDensity: 0, treeDensity: 0 };

  return {
    altitudeMeters,
    biome,
    fertility: densities.fertility,
    grassDensity: densities.grassDensity,
    heightMeters,
    lakeDepth: lake.lakeDepth,
    lakeStrength: lake.lakeStrength,
    lakeWaterLevelMeters,
    moisture,
    mountainRegion,
    normalizedHeight,
    riverWaterLevelMeters,
    surfaceRadiusMeters,
    temperature,
    treeDensity: densities.treeDensity,
    waterBody,
    waterLevelMeters,
  };
}
