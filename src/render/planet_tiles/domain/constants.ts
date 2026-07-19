import { RENDER_SURFACE_LEVEL, RENDER_SURFACE_SEGMENTS } from '../../../world/renderable_surface';

// Mesh segment count must stay fixed: the low-poly triangle layout, foot sampler,
// lake mesh, and disk cache all assume this shared grid resolution.
export const TILE_SEGMENTS = RENDER_SURFACE_SEGMENTS;
export const TERRAIN_SURFACE_VERTEX_COUNT = TILE_SEGMENTS * TILE_SEGMENTS * 6;
// Each skirt quad has two triangles facing outward and the same two facing
// inward. Terrain keeps FrontSide rendering while a seam remains covered from
// either adjacent tile, including when the higher edge is nearest the camera.
export const TERRAIN_SKIRT_VERTICES_PER_SEGMENT = 12;
export const TERRAIN_SKIRT_VERTEX_COUNT =
  TILE_SEGMENTS * 4 * TERRAIN_SKIRT_VERTICES_PER_SEGMENT;
export const TERRAIN_TILE_VERTEX_COUNT =
  TERRAIN_SURFACE_VERTEX_COUNT + TERRAIN_SKIRT_VERTEX_COUNT;
// Skirts are a last-resort cover for temporarily uncovered edges. Active
// mixed-LOD contacts are snapped together by seam_stitching.ts, so skirt depth
// should follow the local cell scale instead of the planet's full relief.
export const TERRAIN_SKIRT_DEPTH_FACTOR = 2;
export const TERRAIN_SKIRT_MIN_DEPTH_METERS = 48;
export const TERRAIN_SKIRT_MAX_DEPTH_METERS = 2_048;
/** How many selected/missed tiles may enter the build/disk pipeline per frame. */
export const TILE_BUILD_BUDGET_PER_FRAME = 20;
export const MAX_CACHED_TILES = 384;
/** Spare entries retained around an oversized active selection to avoid edge churn. */
export const TILE_CACHE_ACTIVE_HEADROOM = 96;
export const TILE_CACHE_STALE_FRAMES = 90;
export const MIN_LEVEL = 2;
export const MAX_LEVEL = RENDER_SURFACE_LEVEL;
export const PLANET_RENDER_SCALE = 1 / 500;
// Tight horizon pad: extra margin kept tiles far past the limb alive and
// forced a lot of useless fine-LOD work. Skirts cover mixed-LOD seams.
export const HORIZON_MARGIN_RADIANS = 0.004;
/** Cull tiles whose center faces away from the camera more than this (level > 0). */
export const BACKFACE_CULL_DOT = 0.06;

let minProjectedErrorValue = 1.35;

export function configureTileLod(minProjectedError: number): void {
  minProjectedErrorValue = minProjectedError;
}

export function minProjectedError(): number {
  return minProjectedErrorValue;
}
