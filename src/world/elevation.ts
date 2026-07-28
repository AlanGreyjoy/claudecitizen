import {
  samplePreRiverHeightDetails,
  type SurfaceHeightSampleOptions,
} from './base-elevation';
import { getActivePlanetConfig } from './planets/runtime';
import { carveRiverElevationFromField, sampleRiverField } from './rivers';
import type { Planet, Vec3 } from '../types';

export type { SurfaceHeightSampleOptions } from './base-elevation';

export interface SurfaceHeightDetails {
  heightMeters: number;
  lakeMask: number;
  mountainRegion: number;
  preRiverElevationNormalized: number;
  riverStrength?: number;
  riverWaterLevelNormalized?: number | null;
}

/** Reused per sample; sampleRiverField copies what it needs before returning. */
const riverProbeScratch: Vec3 = { x: 0, y: 0, z: 0 };

export function sampleSurfaceHeightDetails(
  planet: Planet,
  seed: number,
  position: Vec3,
  options?: SurfaceHeightSampleOptions,
): SurfaceHeightDetails {
  const { hydrology } = getActivePlanetConfig();
  const { lakeMask, mountainRegion, preRiverElevationNormalized } =
    samplePreRiverHeightDetails(planet, seed, position, options);
  let elevation = preRiverElevationNormalized;

  let riverStrength: number | undefined;
  let riverWaterLevelNormalized: number | null | undefined;
  if (elevation >= hydrology.riverMinLandElevation) {
    const length = Math.max(Math.hypot(position.x, position.y, position.z), 1e-9);
    riverProbeScratch.x = position.x / length;
    riverProbeScratch.y = position.y / length;
    riverProbeScratch.z = position.z / length;
    const river = sampleRiverField(
      planet,
      seed,
      riverProbeScratch,
      options?.sampleSpacingMeters,
    );
    riverStrength = river.riverStrength;
    riverWaterLevelNormalized = river.riverWaterLevelNormalized;
    elevation = carveRiverElevationFromField(elevation, river);
  }

  const normalizedHeight = Math.max(-1, Math.min(1, elevation));
  return {
    heightMeters: normalizedHeight * planet.terrainAmplitudeMeters,
    lakeMask,
    mountainRegion,
    preRiverElevationNormalized,
    riverStrength,
    riverWaterLevelNormalized,
  };
}

export function sampleSurfaceHeight(
  planet: Planet,
  seed: number,
  position: Vec3,
  options?: SurfaceHeightSampleOptions,
): number {
  return sampleSurfaceHeightDetails(planet, seed, position, options).heightMeters;
}
