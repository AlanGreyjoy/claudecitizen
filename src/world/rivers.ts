import { radialUp } from './coordinates';
import { clamp01, fbm3d, getNoise3D } from './terrain_noise';
import type { Planet, Vec3 } from '../types';

// Rivers are the zero-contours of a medium-scale FBM field: thin winding
// lines carved into the terrain, mirroring how lakes work (no hydrology sim).
const RIVER_NOISE_SEED_OFFSET = 7777;
const RIVER_FIELD_SCALE = 7.0;
const RIVER_FIELD_OCTAVES = 3;
// Field-space distance from the zero contour that still counts as river valley.
const RIVER_HALF_WIDTH = 0.018;
const RIVER_MAX_CARVE_NORMALIZED = 0.045;
const RIVER_MIN_LAND_ELEVATION = 0.02;
// Fade rivers out over high mountain terrain.
const RIVER_MAX_LAND_ELEVATION = 0.55;
const RIVER_MIN_STRENGTH = 0.05;

export interface RiverSurfaceResult {
  riverDepth: number;
  riverStrength: number;
  riverWaterLevelMeters: number | null;
}

function sampleRiverStrength(seed: number, nx: number, ny: number, nz: number): number {
  const riverNoise = getNoise3D(seed + RIVER_NOISE_SEED_OFFSET);
  const field = fbm3d(riverNoise, nx, ny, nz, RIVER_FIELD_OCTAVES, 0.5, 2.0, RIVER_FIELD_SCALE);
  const proximity = clamp01(1 - Math.abs(field) / RIVER_HALF_WIDTH);
  // Smooth valley cross-section instead of a hard V.
  return proximity * proximity * (3 - 2 * proximity);
}

// Elevation-dependent attenuation: no carving near sea level (rivers should
// not dig below the coast) and none over high mountains.
function riverElevationFade(elevation: number): number {
  const coastFade = clamp01((elevation - RIVER_MIN_LAND_ELEVATION) / 0.03);
  const mountainFade = clamp01((RIVER_MAX_LAND_ELEVATION - elevation) / 0.1);
  return coastFade * mountainFade;
}

export function carveRiverElevation(
  seed: number,
  nx: number,
  ny: number,
  nz: number,
  elevation: number,
): number {
  if (elevation < RIVER_MIN_LAND_ELEVATION) return elevation;
  const strength = sampleRiverStrength(seed, nx, ny, nz);
  if (strength < RIVER_MIN_STRENGTH) return elevation;
  const carve = strength * RIVER_MAX_CARVE_NORMALIZED * riverElevationFade(elevation);
  return elevation - carve;
}

export function sampleRiverSurface(
  planet: Planet,
  seed: number,
  position: Vec3,
  heightMeters: number,
  normalizedHeight: number,
): RiverSurfaceResult {
  const unit = radialUp(position);
  const strength = sampleRiverStrength(seed, unit.x, unit.y, unit.z);
  if (strength < 0.15) {
    return { riverDepth: 0, riverStrength: 0, riverWaterLevelMeters: null };
  }

  // Reconstruct the pre-carve bank elevation from the carved height. The fade
  // depends on the pre-carve elevation, so run a short fixed-point iteration.
  let preCarve = normalizedHeight;
  for (let i = 0; i < 2; i += 1) {
    preCarve =
      normalizedHeight + strength * RIVER_MAX_CARVE_NORMALIZED * riverElevationFade(preCarve);
  }
  const fade = riverElevationFade(preCarve);
  if (preCarve < RIVER_MIN_LAND_ELEVATION || fade <= 0) {
    return { riverDepth: 0, riverStrength: 0, riverWaterLevelMeters: null };
  }

  // Water sits at half the full channel depth below the banks, so only the
  // inner part of the carved valley is submerged and the slopes stay dry.
  const waterLevelNormalized = preCarve - RIVER_MAX_CARVE_NORMALIZED * fade * 0.5;
  const riverWaterLevelMeters = waterLevelNormalized * planet.terrainAmplitudeMeters;
  const channelDepthMeters = strength * RIVER_MAX_CARVE_NORMALIZED * fade * planet.terrainAmplitudeMeters;
  const riverDepth = clamp01(
    (riverWaterLevelMeters - heightMeters) / Math.max(channelDepthMeters, 30),
  );

  return {
    riverDepth,
    riverStrength: strength,
    riverWaterLevelMeters,
  };
}
