import { radialUp } from './coordinates';
import { carveLakeElevation } from './lakes';
import { carveRiverElevation } from './rivers';
import { clamp01, fbm3d, getNoise3D, ridgedNoise3d } from './terrain_noise';
import { sampleTerrainRegions } from './terrain_regions';
import type { Planet, Vec3 } from '../types';

export function sampleSurfaceHeight(planet: Planet, seed: number, position: Vec3): number {
  const noise3D = getNoise3D(seed);
  const unit = radialUp(position);
  const { x: nx, y: ny, z: nz } = unit;

  const continentNoise = fbm3d(noise3D, nx, ny, nz, 10, 0.5, 2.0, 1.2);
  const detailNoise = fbm3d(noise3D, nx, ny, nz, 8, 0.5, 2.0, 8000.0);

  let elevation = continentNoise * 0.4;

  // Land mask keeps mountains from rising straight out of the ocean; the
  // region mask confines them to distinct ranges instead of all elevated land.
  const landMask = clamp01((elevation + 0.05) * 4.0);
  const { hillRegion, mountainRegion } = sampleTerrainRegions(seed, nx, ny, nz);
  const mountainWeight = landMask * mountainRegion;

  if (mountainWeight > 0.001) {
    // Remap ridged noise from [-1, 1] to [0, 1] so it only adds height; a
    // base uplift raises the whole range above the surrounding land so
    // ridges read as real mountain ranges, not isolated bumps.
    const ridge = (ridgedNoise3d(noise3D, nx, ny, nz, 10, 0.5, 2.0, 3.5) + 1) * 0.5;
    const localRidge = (ridgedNoise3d(noise3D, nx, ny, nz, 10, 0.5, 2.0, 400.0) + 1) * 0.5;
    elevation += (0.1 + ridge * 0.45 + localRidge * 0.15) * mountainWeight;
  }

  // Rolling hills get real amplitude in hill regions; plains stay near flat
  // with only a whisper of undulation plus fine detail noise.
  const localHillNoise = fbm3d(noise3D, nx, ny, nz, 10, 0.5, 2.0, 1200.0);
  elevation += localHillNoise * (0.02 + 0.13 * hillRegion);
  elevation += detailNoise * 0.01;

  elevation = carveLakeElevation(seed, nx, ny, nz, elevation);
  elevation = carveRiverElevation(seed, nx, ny, nz, elevation);

  const normalizedHeight = Math.max(-1, Math.min(1, elevation));
  return normalizedHeight * planet.terrainAmplitudeMeters;
}
