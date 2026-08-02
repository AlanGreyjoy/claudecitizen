import { RENDER_SURFACE_LEVEL, RENDER_SURFACE_SEGMENTS } from '../../../world/renderable-surface';

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
// Positions are xyz, but packed colors/normals carry a fourth padding
// component: WebGPU defines no unorm8x3 / snorm16x3 and requires every vertex
// buffer's arrayStride to be a multiple of 4. Every producer, consumer, cache
// validator and offline check must stride by this — a stale literal silently
// rejects cached tiles or reads misaligned components.
export const TERRAIN_POSITION_COMPONENTS = 3;
export const TERRAIN_PACKED_COMPONENTS = 4;
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
/**
 * How many levels coarser a fallback ancestor may be and still suppress the
 * ready tiles beneath it.
 *
 * Suppression exists so a coarse cover and its refined children never draw
 * together and expose nested skirt walls. That is the right call across a
 * refinement step or two. It is the wrong call across ten: a level-0 root is
 * one sixth of the planet, and letting it hide every ready L17 tile because a
 * single sibling is still building is what made the surface appear to blink
 * out. Beyond this gap the fine tiles win and the coarse cover draws under
 * them.
 */
export const MAX_FALLBACK_SUPPRESSION_LEVELS = 3;
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
