import { RENDER_SURFACE_LEVEL, RENDER_SURFACE_SEGMENTS } from '../../../world/renderable_surface';

// Mesh segment count must stay fixed: shared index buffer + disk cache assume this layout.
export const TILE_SEGMENTS = RENDER_SURFACE_SEGMENTS;
export const TILE_BUILD_BUDGET_PER_FRAME = 12;
export const MAX_CACHED_TILES = 384;
export const TILE_CACHE_STALE_FRAMES = 90;
export const MIN_LEVEL = 2;
export const MAX_LEVEL = RENDER_SURFACE_LEVEL;
export const PLANET_RENDER_SCALE = 1 / 500;
export const HORIZON_MARGIN_RADIANS = 0.03;

let minProjectedErrorValue = 1.35;

export function configureTileLod(minProjectedError: number): void {
  minProjectedErrorValue = minProjectedError;
}

export function minProjectedError(): number {
  return minProjectedErrorValue;
}
