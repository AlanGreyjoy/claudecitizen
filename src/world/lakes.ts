import { radialUp } from './coordinates';
import { clamp01, fbm3d, getNoise3D } from './terrain_noise';
import type { Planet, Vec3 } from '../types';

const LAKE_NOISE_SEED_OFFSET = 9012;
const LAKE_MASK_THRESHOLD = 0.58;
const LAKE_MAX_CARVE_NORMALIZED = 0.14;
const LAKE_MIN_LAND_ELEVATION = 0.02;
const INLAND_LAKE_MOISTURE_THRESHOLD = 0.4;
const INLAND_LAKE_MAX_NORMALIZED = 0.058;
const INLAND_LAKE_MIN_WATER_NORMALIZED = 0.046;

interface LakeCarvingResult {
  elevation: number;
  lakeStrength: number;
  waterLevelNormalized: number;
}

export interface LakeSurfaceResult {
  lakeDepth: number;
  lakeStrength: number;
  lakeWaterLevelMeters: number | null;
}

function sampleLakeMask(seed: number, nx: number, ny: number, nz: number): number {
  const lakeNoise = getNoise3D(seed + LAKE_NOISE_SEED_OFFSET);
  return fbm3d(lakeNoise, nx, ny, nz, 4, 0.5, 2.0, 0.55);
}

function applyLakeCarving(elevation: number, lakeMask: number): LakeCarvingResult {
  if (elevation < LAKE_MIN_LAND_ELEVATION || lakeMask < LAKE_MASK_THRESHOLD) {
    return {
      elevation,
      lakeStrength: 0,
      waterLevelNormalized: elevation,
    };
  }

  const lakeStrength = clamp01((lakeMask - LAKE_MASK_THRESHOLD) / (1 - LAKE_MASK_THRESHOLD));
  const carveDepth = lakeStrength * LAKE_MAX_CARVE_NORMALIZED;
  const waterLevelNormalized = elevation - carveDepth * 0.22;

  return {
    elevation: elevation - carveDepth,
    lakeStrength,
    waterLevelNormalized,
  };
}

export function sampleLakeSurface(
  planet: Planet,
  seed: number,
  position: Vec3,
  heightMeters: number,
  normalizedHeight: number,
  moisture: number,
): LakeSurfaceResult {
  const unit = radialUp(position);
  const lakeNoise = getNoise3D(seed + LAKE_NOISE_SEED_OFFSET);
  const lakeMask = sampleLakeMask(seed, unit.x, unit.y, unit.z);
  const lakeStrength = clamp01((lakeMask - LAKE_MASK_THRESHOLD) / (1 - LAKE_MASK_THRESHOLD));
  const carveDepthNorm = lakeStrength * LAKE_MAX_CARVE_NORMALIZED;
  const preCarveNormalized = normalizedHeight + carveDepthNorm;
  const waterTableNormalized =
    0.025 +
    clamp01(fbm3d(lakeNoise, unit.x, unit.y, unit.z, 2, 0.5, 2.0, 0.35) * 0.5 + 0.5) * 0.04;
  const wetLowland =
    normalizedHeight > 0 &&
    normalizedHeight < INLAND_LAKE_MAX_NORMALIZED &&
    moisture >= INLAND_LAKE_MOISTURE_THRESHOLD;

  if (lakeStrength < 0.18 && !wetLowland) {
    return {
      lakeDepth: 0,
      lakeStrength: 0,
      lakeWaterLevelMeters: null,
    };
  }

  let waterLevelNormalized: number;
  let strength: number;
  if (lakeStrength >= 0.18) {
    strength = lakeStrength;
    waterLevelNormalized = preCarveNormalized - carveDepthNorm * 0.22;
  } else {
    strength = 0.35;
    waterLevelNormalized = Math.max(waterTableNormalized, INLAND_LAKE_MIN_WATER_NORMALIZED);
  }

  const lakeWaterLevelMeters = waterLevelNormalized * planet.terrainAmplitudeMeters;
  const lakeDepth = clamp01(
    (lakeWaterLevelMeters - heightMeters) /
      Math.max(carveDepthNorm * planet.terrainAmplitudeMeters, 45),
  );

  return {
    lakeDepth,
    lakeStrength: strength,
    lakeWaterLevelMeters,
  };
}

export function carveLakeElevation(
  seed: number,
  nx: number,
  ny: number,
  nz: number,
  elevation: number,
): number {
  return applyLakeCarving(elevation, sampleLakeMask(seed, nx, ny, nz)).elevation;
}
