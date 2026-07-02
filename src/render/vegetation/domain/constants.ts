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

// Fixed per-tile sample counts make near-player (fine, small) tiles sparse and
// distant (coarse, huge) tiles pointlessly detailed. Scale counts by tile level
// so density concentrates where the player can actually see it.
//
// Grass is only worth rendering within a few hundred meters, so it exists only
// on the finest tiles (which the terrain LOD forces near the player) and gets
// heavy multipliers there. Trees read at kilometers, so they spread further out
// with a gentler curve.
export function grassSampleMultiplier(level: number): number {
  if (level >= 16) return 24;
  if (level === 15) return 8;
  if (level === 14) return 2;
  return 0;
}

export function treeSampleMultiplier(level: number): number {
  if (level >= 16) return 4;
  if (level === 15) return 2;
  if (level === 14) return 1;
  if (level === 13) return 0.5;
  if (level >= 10) return 0.25;
  return 0;
}

export const VEGETATION_BUILD_BUDGET_PER_FRAME = 2;
export const MAX_CACHED_VEGETATION_TILES = 160;
export const VEGETATION_CACHE_STALE_FRAMES = 45;
export const VEGETATION_ALTITUDE_CUTOFF_METERS = 18_000;
export const VEGETATION_MIN_TILE_LEVEL = 4;
export const VEGETATION_TILE_DOT_THRESHOLD = 0.32;
export const TREE_LOD_DISTANCE_METERS = 120;
export const TREE_LOD_UPDATE_MIN_MOVE_METERS = 8;
