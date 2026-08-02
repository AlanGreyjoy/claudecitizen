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
/**
 * How many veg tiles may be selected/visible at once. Kept separate from the
 * memory residency cap so a short walk can keep a warm corridor without
 * exploding draw calls.
 */
export const VEGETATION_SELECTION_BUDGET = 160;
/** Soft cap on ready GPU veg tiles kept resident (active set + recent corridor). */
export const MAX_CACHED_VEGETATION_TILES = 288;
/** Spare entries retained around the active vegetation coverage during LOD swaps. */
export const VEGETATION_CACHE_ACTIVE_HEADROOM = 96;
/** Keep recently left tiles ~3s so short walks do not rebuild meshes. */
export const VEGETATION_CACHE_STALE_FRAMES = 180;
export const VEGETATION_ALTITUDE_CUTOFF_METERS = 18_000;
export const VEGETATION_MIN_TILE_LEVEL = 4;
export const VEGETATION_TILE_DOT_THRESHOLD = 0.32;
/**
 * Radius within which trees draw as their full GLB instead of the impostor cone.
 *
 * This is the dominant vegetation cost, and it scales with the *area* of the
 * disc, not its radius. The distant tier is a six-segment cone — twelve
 * triangles — so tens of thousands of far trees are nearly free. Everything
 * expensive sits inside this radius.
 *
 * Measured with shadows off: trees off gave 62 draw calls at 100+ fps, trees on
 * gave ~330 at ~20 fps. So roughly 40 ms lands in ~270 draws in a *single* pass,
 * with no shadow pass involved — far beyond draw-call overhead, which means the
 * cost is inside those draws. At 120 m the disc covered ~45,000 m², around two
 * L16 tiles and on the order of a thousand full-detail trees. Foliage is
 * typically alpha-tested cards, so close trees are also fill-bound through
 * overdraw, and overdraw grows as they fill more of the screen.
 *
 * 180 m covers ~102,000 m² — sixteen times the area of the original 45 m
 * radius, and more than double the 120 m disc the note above measured at
 * ~20 fps. That measurement predates the current imposter/visibility work and
 * 90 m was verified fine on foot, so this is a deliberate step past the old
 * ceiling rather than a contradiction of it.
 *
 * Because the cost grows with the *square* of the radius, this is the single
 * biggest vegetation knob a player has, so it is exposed as the "Vegetation
 * Distance" slider in Video settings rather than fixed per quality preset. The
 * bounds below frame the trade: 40 m is roughly the old conservative value,
 * 400 m is ~5× the default's area and is expected to cost frames on most
 * machines.
 */
export const DEFAULT_TREE_LOD_DISTANCE_METERS = 180;
export const TREE_LOD_DISTANCE_MIN_METERS = 40;
export const TREE_LOD_DISTANCE_MAX_METERS = 400;

let treeLodDistanceMeters = DEFAULT_TREE_LOD_DISTANCE_METERS;

export function getTreeLodDistanceMeters(): number {
  return treeLodDistanceMeters;
}

export function configureTreeLodDistanceMeters(meters: number): void {
  if (!Number.isFinite(meters)) {
    treeLodDistanceMeters = DEFAULT_TREE_LOD_DISTANCE_METERS;
    return;
  }
  treeLodDistanceMeters = Math.max(
    TREE_LOD_DISTANCE_MIN_METERS,
    Math.min(TREE_LOD_DISTANCE_MAX_METERS, meters),
  );
}
export const TREE_LOD_UPDATE_MIN_MOVE_METERS = 8;

/**
 * Ground-level radius within which a tile draws its trees at all.
 *
 * Tile *selection* runs out to `vegetationTileDistanceMeters` — 48 km on the
 * balanced preset — because that is the range over which vegetation data is
 * worth generating and keeping warm. Drawing it is a different question: each
 * selected tile contributes its own imposter draw, so a 48 km selection radius
 * put ~160 imposter draws on screen, more than double the entire terrain, for
 * trees that are almost all below the horizon. On a 6,371 km planet an eye at
 * 1.8 m sees the ground out to sqrt(2·R·h) ≈ 4.8 km; at 8 km a 2.2 m imposter
 * cone is well under a pixel even before the horizon hides it.
 *
 * The allowance grows with altitude so the aerial view keeps its forests: the
 * visible ground disc widens as the camera climbs, and by the 18 km vegetation
 * cutoff this exceeds the selection radius, so flight looks exactly as it does
 * today. The cut lands on the on-foot case, which is the one that was paying
 * ~160 imposter draws to render sub-pixel trees behind a 4.8 km horizon.
 */
export const TREE_DRAW_DISTANCE_GROUND_METERS = 8_000;
const TREE_DRAW_DISTANCE_PER_ALTITUDE = 4;

export function treeDrawDistanceMeters(altitudeMeters: number): number {
  const altitude = Number.isFinite(altitudeMeters) ? Math.max(0, altitudeMeters) : 0;
  return (
    TREE_DRAW_DISTANCE_GROUND_METERS + altitude * TREE_DRAW_DISTANCE_PER_ALTITUDE
  );
}
/** Re-pack grass instances when the player moves this far. */
export const GRASS_RADIUS_UPDATE_MIN_MOVE_METERS = 1;
