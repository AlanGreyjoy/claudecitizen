import { altitudeForPosition, latLonForPosition, radialUp } from './coordinates';
import { sampleLakeSurface } from './lakes';
import { sampleRiverSurface } from './rivers';
import { clamp01, fbm3d, getNoise3D } from './terrain_noise';
import { sampleTerrainRegions } from './terrain_regions';
import type { Biome, Planet, PlanetSurfaceSample, Vec3 } from '../types';

const FOREST_NOISE_SEED_OFFSET = 4321;

export interface BiomeClassificationInput {
  heightMeters: number;
  lakeWaterLevelMeters: number | null;
  moisture: number;
  /** How mountainous this region is (0..1); gates highlands/peak so plains at moderate elevation stay plains. */
  mountainRegion: number;
  normalizedHeight: number;
  /** Set only when a river (not a lake) governs the local water level. */
  riverWaterLevelMeters: number | null;
  temperature: number;
}

export function classifyBiome(input: BiomeClassificationInput): Biome {
  const {
    heightMeters,
    lakeWaterLevelMeters,
    moisture,
    mountainRegion,
    normalizedHeight,
    riverWaterLevelMeters,
    temperature,
  } = input;
  if (normalizedHeight < 0.0) return 'ocean';
  if (riverWaterLevelMeters != null && heightMeters < riverWaterLevelMeters - 0.5) return 'river';
  if (lakeWaterLevelMeters != null && heightMeters < lakeWaterLevelMeters - 0.5) return 'lake';
  if (normalizedHeight < 0.012) return 'beach';
  // Rock/snow biomes are reserved for mountain regions (or truly extreme
  // elevation), so rolling hills at moderate height stay green.
  const highlandThreshold = mountainRegion > 0.35 ? 0.45 : 0.75;
  if (normalizedHeight > highlandThreshold) return temperature < 0.3 ? 'peak' : 'highlands';
  if (temperature < 0.2) return 'tundra';
  if (moisture > 0.6) return 'forest';
  if (moisture > 0.3) return 'plains';
  return 'desert';
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
  else if (biome === 'beach' || biome === 'tundra' || biome === 'desert') fertility = 0.1;

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
): PlanetSurfaceSample {
  const { latRadians } = latLonForPosition(position);
  const noise3D = getNoise3D(seed + 1234);
  const surfaceRadiusMeters = planet.radiusMeters + heightMeters;
  const altitudeMeters = altitudeForPosition(position, surfaceRadiusMeters);
  const normalizedHeight = heightMeters / planet.terrainAmplitudeMeters;
  const unit = radialUp(position);

  const tempNoise = fbm3d(noise3D, unit.x, unit.y, unit.z, 3, 0.5, 2.0, 2.0);
  const latFactor = Math.abs(latRadians) / (Math.PI / 2);
  const altitudeFactor = Math.max(0, normalizedHeight);
  let temperature = 1.0 - latFactor - altitudeFactor * 0.5 + tempNoise * 0.2;
  temperature = clamp01(temperature);

  const moistureNoise = getNoise3D(seed + 5678);
  const mNoise = fbm3d(moistureNoise, unit.x, unit.y, unit.z, 4, 0.5, 2.0, 1.5);
  let moisture = mNoise * 0.5 + 0.5;
  moisture += Math.cos(latRadians * 3) * 0.2;
  // Softened altitude penalty so mid-elevation land can still be forest.
  moisture -= Math.max(0, normalizedHeight) * 0.1;
  // Medium-scale patch noise makes forests form coherent regions instead of
  // moisture speckle at the biome threshold.
  const forestNoise = getNoise3D(seed + FOREST_NOISE_SEED_OFFSET);
  moisture += fbm3d(forestNoise, unit.x, unit.y, unit.z, 3, 0.5, 2.0, 3.0) * 0.25;
  moisture = clamp01(moisture);

  const { mountainRegion } = sampleTerrainRegions(seed, unit.x, unit.y, unit.z);

  const lake = sampleLakeSurface(planet, seed, position, heightMeters, normalizedHeight, moisture);
  const river = sampleRiverSurface(planet, seed, position, heightMeters, normalizedHeight);

  // Rivers reuse the lake water fields so the lake water mesh system renders
  // them without changes; the higher water surface wins where they overlap.
  let lakeWaterLevelMeters = lake.lakeWaterLevelMeters;
  let lakeDepth = lake.lakeDepth;
  let lakeStrength = lake.lakeStrength;
  let riverWaterLevelMeters: number | null = null;
  if (
    river.riverWaterLevelMeters != null &&
    (lakeWaterLevelMeters == null || river.riverWaterLevelMeters > lakeWaterLevelMeters)
  ) {
    lakeWaterLevelMeters = river.riverWaterLevelMeters;
    lakeDepth = Math.max(lakeDepth, river.riverDepth);
    lakeStrength = Math.max(lakeStrength, river.riverStrength);
    riverWaterLevelMeters = river.riverWaterLevelMeters;
  }

  const biome = classifyBiome({
    heightMeters,
    lakeWaterLevelMeters,
    moisture,
    mountainRegion,
    normalizedHeight,
    riverWaterLevelMeters,
    temperature,
  });
  const { fertility, grassDensity, treeDensity } = vegetationDensitiesForBiome(biome, moisture);

  return {
    altitudeMeters,
    biome,
    fertility,
    grassDensity,
    heightMeters,
    lakeDepth,
    lakeStrength,
    lakeWaterLevelMeters,
    moisture,
    mountainRegion,
    normalizedHeight,
    riverWaterLevelMeters,
    surfaceRadiusMeters,
    temperature,
    treeDensity,
  };
}
