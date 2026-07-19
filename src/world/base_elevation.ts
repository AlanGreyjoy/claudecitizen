import type { Planet, Vec3 } from '../types';
import { radialUp } from './coordinates';
import { applyCoastalShelf } from './coastal_profile';
import { carveLakeElevationFromMask, sampleLakeMask } from './lakes';
import { getActivePlanetConfig } from './planets/runtime';
import {
  clamp01,
  fbm3d,
  fbm3dBandLimited,
  getNoise3D,
  maximumNoiseFrequencyForSpacing,
  ridgedNoise3d,
  ridgedNoise3dBandLimited,
} from './terrain_noise';
import { sampleTerrainRegions } from './terrain_regions';

export interface SurfaceHeightSampleOptions {
  sampleSpacingMeters?: number;
}

export interface PreRiverHeightDetails {
  lakeMask: number;
  mountainRegion: number;
  preRiverElevationNormalized: number;
}

/**
 * Samples the complete terrain recipe through lake carving, but deliberately
 * stops before rivers. Keeping this independent from the drainage network lets
 * the network route over the same terrain without recursively sampling itself.
 */
export function samplePreRiverHeightDetails(
  planet: Planet,
  seed: number,
  position: Vec3,
  options?: SurfaceHeightSampleOptions,
): PreRiverHeightDetails {
  const { height } = getActivePlanetConfig();
  const noise3D = getNoise3D(seed);
  const unit = radialUp(position);
  const { x: nx, y: ny, z: nz } = unit;
  const maxFrequency =
    options?.sampleSpacingMeters == null
      ? null
      : maximumNoiseFrequencyForSpacing(planet.radiusMeters, options.sampleSpacingMeters);
  const sampleFbm = (
    octaves: number,
    persistence: number,
    lacunarity: number,
    noiseScale: number,
  ): number =>
    maxFrequency == null
      ? fbm3d(noise3D, nx, ny, nz, octaves, persistence, lacunarity, noiseScale)
      : fbm3dBandLimited({
          lacunarity,
          maxFrequency,
          noise3D,
          octaves,
          persistence,
          scale: noiseScale,
          x: nx,
          y: ny,
          z: nz,
        });
  const sampleRidged = (
    octaves: number,
    persistence: number,
    lacunarity: number,
    noiseScale: number,
  ): number =>
    maxFrequency == null
      ? ridgedNoise3d(noise3D, nx, ny, nz, octaves, persistence, lacunarity, noiseScale)
      : ridgedNoise3dBandLimited({
          lacunarity,
          maxFrequency,
          noise3D,
          octaves,
          persistence,
          scale: noiseScale,
          x: nx,
          y: ny,
          z: nz,
        });

  const continentNoise = sampleFbm(10, 0.5, 2.0, height.continentScale);
  const detailNoise = sampleFbm(8, 0.5, 2.0, height.detailScale);

  let elevation = continentNoise * height.continentWeight;

  // Land mask keeps mountains from rising straight out of the ocean; the
  // region mask confines them to distinct ranges instead of all elevated land.
  const landMask = clamp01((elevation + height.landMaskBias) * height.landMaskScale);
  const { hillRegion, mountainRegion } = sampleTerrainRegions(seed, nx, ny, nz);
  const mountainWeight = landMask * mountainRegion;

  if (mountainWeight > 0.001) {
    const ridge = (sampleRidged(10, 0.5, 2.0, height.ridgeScale) + 1) * 0.5;
    const localRidge =
      (sampleRidged(10, 0.5, 2.0, height.localRidgeScale) + 1) * 0.5;
    elevation +=
      (height.mountainBaseUplift +
        ridge * height.ridgeWeight +
        localRidge * height.localRidgeWeight) *
      mountainWeight;
  }

  const localHillNoise = sampleFbm(10, 0.5, 2.0, height.hillScale);
  elevation += localHillNoise * (height.hillBaseWeight + height.hillRegionWeight * hillRegion);
  elevation += detailNoise * height.detailWeight;
  elevation = applyCoastalShelf(elevation);

  const lakeMask = sampleLakeMask(seed, nx, ny, nz);
  elevation = carveLakeElevationFromMask(elevation, lakeMask);

  return {
    lakeMask,
    mountainRegion,
    preRiverElevationNormalized: elevation,
  };
}
