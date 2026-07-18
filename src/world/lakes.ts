import { radialUp } from './coordinates';
import { getActivePlanetConfig } from './planets/runtime';
import { clamp01, fbm3d, getNoise3D } from './terrain_noise';
import type { Planet, Vec3 } from '../types';

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

export interface LakeSurfaceInput {
  heightMeters: number;
  lakeMask?: number;
  moisture: number;
  normalizedHeight: number;
  planet: Planet;
  position: Vec3;
  seed: number;
}

export function sampleLakeMask(seed: number, nx: number, ny: number, nz: number): number {
  const { hydrology } = getActivePlanetConfig();
  const lakeNoise = getNoise3D(seed + hydrology.lakeNoiseSeedOffset);
  return fbm3d(lakeNoise, nx, ny, nz, 4, 0.5, 2.0, 0.55);
}

function applyLakeCarving(elevation: number, lakeMask: number): LakeCarvingResult {
  const { hydrology } = getActivePlanetConfig();
  if (elevation < hydrology.lakeMinLandElevation || lakeMask < hydrology.lakeMaskThreshold) {
    return {
      elevation,
      lakeStrength: 0,
      waterLevelNormalized: elevation,
    };
  }

  const lakeStrength = clamp01(
    (lakeMask - hydrology.lakeMaskThreshold) / (1 - hydrology.lakeMaskThreshold),
  );
  const carveDepth = lakeStrength * hydrology.lakeMaxCarveNormalized;
  const waterLevelNormalized = elevation - carveDepth * 0.22;

  return {
    elevation: elevation - carveDepth,
    lakeStrength,
    waterLevelNormalized,
  };
}

export function sampleLakeSurface(input: LakeSurfaceInput): LakeSurfaceResult {
  const {
    heightMeters,
    lakeMask: cachedLakeMask,
    moisture,
    normalizedHeight,
    planet,
    position,
    seed,
  } = input;
  const { hydrology } = getActivePlanetConfig();
  const unit = radialUp(position);
  const lakeNoise = getNoise3D(seed + hydrology.lakeNoiseSeedOffset);
  const lakeMask = cachedLakeMask ?? sampleLakeMask(seed, unit.x, unit.y, unit.z);
  const lakeStrength = clamp01(
    (lakeMask - hydrology.lakeMaskThreshold) / (1 - hydrology.lakeMaskThreshold),
  );
  const carveDepthNorm = lakeStrength * hydrology.lakeMaxCarveNormalized;
  const preCarveNormalized = normalizedHeight + carveDepthNorm;
  const waterTableNormalized =
    0.025 +
    clamp01(fbm3d(lakeNoise, unit.x, unit.y, unit.z, 2, 0.5, 2.0, 0.35) * 0.5 + 0.5) * 0.04;
  const wetLowland =
    normalizedHeight > 0 &&
    normalizedHeight < hydrology.inlandLakeMaxNormalized &&
    moisture >= hydrology.inlandLakeMoistureThreshold;

  if (lakeStrength < 0.18 && !wetLowland) {
    return {
      lakeDepth: 0,
      lakeStrength: 0,
      lakeWaterLevelMeters: null,
    };
  }

  let lakeWaterLevelMeters: number;
  let strength: number;
  if (lakeStrength >= 0.18) {
    strength = lakeStrength;
    lakeWaterLevelMeters =
      (preCarveNormalized - carveDepthNorm * 0.22) * planet.terrainAmplitudeMeters;
  } else {
    strength = 0.35;
    // Moist lowlands do not have a separately carved basin. Keep their water
    // shallow instead of lifting it to the absolute 345-488 m water table.
    lakeWaterLevelMeters = Math.min(
      waterTableNormalized * planet.terrainAmplitudeMeters,
      heightMeters + hydrology.inlandLakeMaxDepthMeters,
    );
  }
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
  return carveLakeElevationFromMask(elevation, sampleLakeMask(seed, nx, ny, nz));
}

export function carveLakeElevationFromMask(elevation: number, lakeMask: number): number {
  return applyLakeCarving(elevation, lakeMask).elevation;
}
