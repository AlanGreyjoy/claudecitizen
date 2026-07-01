import { radialUp } from './coordinates';
import { carveLakeElevation } from './lakes';
import { clamp01, fbm3d, getNoise3D, ridgedNoise3d } from './terrain_noise';
import type { Planet, Vec3 } from '../types';

export function sampleSurfaceHeight(planet: Planet, seed: number, position: Vec3): number {
  const noise3D = getNoise3D(seed);
  const unit = radialUp(position);
  const { x: nx, y: ny, z: nz } = unit;

  const continentNoise = fbm3d(noise3D, nx, ny, nz, 10, 0.5, 2.0, 1.2);
  const mountainNoise = ridgedNoise3d(noise3D, nx, ny, nz, 10, 0.5, 2.0, 3.5);
  const localMountainNoise = ridgedNoise3d(noise3D, nx, ny, nz, 10, 0.5, 2.0, 400.0);
  const localHillNoise = fbm3d(noise3D, nx, ny, nz, 10, 0.5, 2.0, 1200.0);
  const detailNoise = fbm3d(noise3D, nx, ny, nz, 8, 0.5, 2.0, 8000.0);

  let elevation = continentNoise * 0.4;

  const mountainMask = clamp01((elevation + 0.1) * 2.0);
  elevation += mountainNoise * 0.3 * mountainMask;
  elevation += localMountainNoise * 0.15 * mountainMask;
  elevation += localHillNoise * 0.05;
  elevation += detailNoise * 0.01;

  elevation = carveLakeElevation(seed, nx, ny, nz, elevation);

  const normalizedHeight = Math.max(-1, Math.min(1, elevation));
  return normalizedHeight * planet.terrainAmplitudeMeters;
}
