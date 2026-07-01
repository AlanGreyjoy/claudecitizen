import type { CubeFace } from '../../../types';

export const FACE_INDEX: Record<CubeFace, number> = {
  nx: 1,
  ny: 2,
  nz: 3,
  px: 4,
  py: 5,
  pz: 6,
};

let grassSampleCount = 220;
let treeSampleCount = 120;
let landingGrassCount = 220;
let landingTreeCount = 120;
let vegetationTileDistanceMeters = 48_000;

export function configureVegetationDensity(settings: {
  grassSampleCount: number;
  treeSampleCount: number;
  vegetationTileDistanceMeters: number;
}): void {
  grassSampleCount = settings.grassSampleCount;
  treeSampleCount = settings.treeSampleCount;
  landingGrassCount = Math.min(settings.grassSampleCount, 320);
  landingTreeCount = Math.min(settings.treeSampleCount, 252);
  vegetationTileDistanceMeters = settings.vegetationTileDistanceMeters;
}

export function getGrassSampleCount(): number {
  return grassSampleCount;
}

export function getTreeSampleCount(): number {
  return treeSampleCount;
}

export function getLandingGrassCount(): number {
  return landingGrassCount;
}

export function getLandingTreeCount(): number {
  return landingTreeCount;
}

export function getVegetationTileDistanceMeters(): number {
  return vegetationTileDistanceMeters;
}

export const MAX_CACHED_VEGETATION_TILES = 160;
export const VEGETATION_CACHE_STALE_FRAMES = 45;
export const VEGETATION_ALTITUDE_CUTOFF_METERS = 18_000;
export const VEGETATION_MIN_TILE_LEVEL = 4;
export const VEGETATION_TILE_DOT_THRESHOLD = 0.32;
export const TREE_LOD_DISTANCE_METERS = 120;
export const TREE_LOD_UPDATE_MIN_MOVE_METERS = 8;
