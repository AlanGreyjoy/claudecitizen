import type { CubeFace } from "../../../types";

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
  landingGrassCount = Math.min(settings.grassSampleCount, 800);
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
// Grass is only worth rendering within a few hundred meters: finest LODs only
// (terrain forces L16/L17 near the player) plus a short runtime distance cull.
// L17 tiles are ~¼ the area of L16, so their multiplier is scaled down to keep
// grass per m² roughly unchanged. Trees read at kilometers via
// vegetationTileDistanceMeters.
export function grassSampleMultiplier(level: number): number {
  // Underfoot is L17. Target ~10–14k attempts/tile at density 1× on balanced so
  // the default reads as a carpet; the density slider scales up from there.
  if (level >= 17) return 32;
  if (level === 16) return 20;
  return 0;
}

/** Default hard radial cull: grass only within this distance of the player. */
export const DEFAULT_GRASS_DISTANCE_METERS = 20;
const GRASS_DISTANCE_MIN_METERS = 5;
const GRASS_DISTANCE_MAX_METERS = 80;

let grassDistanceMeters = DEFAULT_GRASS_DISTANCE_METERS;

export function getGrassDistanceMeters(): number {
  return grassDistanceMeters;
}

export function configureGrassDistanceMeters(meters: number): void {
  if (!Number.isFinite(meters)) {
    grassDistanceMeters = DEFAULT_GRASS_DISTANCE_METERS;
    return;
  }
  grassDistanceMeters = Math.max(
    GRASS_DISTANCE_MIN_METERS,
    Math.min(GRASS_DISTANCE_MAX_METERS, meters),
  );
}

export function treeSampleMultiplier(level: number): number {
  if (level >= 17) return 1;
  if (level === 16) return 4;
  if (level === 15) return 2;
  if (level === 14) return 1;
  if (level === 13) return 0.5;
  if (level >= 10) return 0.25;
  return 0;
}

export const VEGETATION_BUILD_BUDGET_PER_FRAME = 5;
/** Soft wall-clock cap so one lush L17 tile cannot stall the frame. */
export const VEGETATION_BUILD_BUDGET_MS_PER_FRAME = 10;
export const MAX_CACHED_VEGETATION_TILES = 160;
export const VEGETATION_CACHE_STALE_FRAMES = 45;
export const VEGETATION_ALTITUDE_CUTOFF_METERS = 18_000;
export const VEGETATION_MIN_TILE_LEVEL = 4;
export const VEGETATION_TILE_DOT_THRESHOLD = 0.32;
export const TREE_LOD_DISTANCE_METERS = 120;
export const TREE_LOD_UPDATE_MIN_MOVE_METERS = 8;
/** Re-pack grass instances when the player moves this far. */
export const GRASS_RADIUS_UPDATE_MIN_MOVE_METERS = 1;
