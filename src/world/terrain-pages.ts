import { RENDER_SURFACE_SEGMENTS } from './renderable-surface-constants';
import {
  RASTER_CHANNEL_COUNT,
  TILE_RASTER_WIDTH,
  isValidTileHeightRaster,
  rasterGridOriginX,
  rasterGridOriginY,
  type TileHeightRaster,
} from './terrain-raster';
import type { CubeFace } from '../types';

/**
 * Resident set of band-limited height rasters, keyed by tile.
 *
 * This is the domain-side half of terrain paging: `render/planet_tiles` decides
 * which tiles exist and when they are evicted, and installs/releases pages here
 * as it does. Samplers in `world/` then resolve grid corners from whatever is
 * resident, with the analytic sampler as the fallback for anything that is not.
 *
 * Deliberately in `world/` and free of any renderer import — the height field
 * is domain state, and `world/` may not import `render/` (ESLint enforces it).
 */

const FACE_KEY_INDEX: Record<CubeFace, number> = {
  nx: 1,
  ny: 3,
  nz: 5,
  px: 0,
  py: 2,
  pz: 4,
};

// Matches the packing in renderable-surface.ts: tile coordinates reach 2^17 at
// the finest level, so 22 bits each is ample and face(3)+level(5)+x(22)+y(22)
// stays inside the exact-integer range of a double.
const TILE_COORDINATE_STRIDE = 4_194_304;
const FACE_LEVEL_STRIDE = TILE_COORDINATE_STRIDE * TILE_COORDINATE_STRIDE;

function pageKey(face: CubeFace, level: number, x: number, y: number): number {
  return (
    (FACE_KEY_INDEX[face] * 32 + level) * FACE_LEVEL_STRIDE +
    x * TILE_COORDINATE_STRIDE +
    y
  );
}

const pages = new Map<number, TileHeightRaster>();

/**
 * Levels with at least one resident page. Grid lookups arrive keyed by level,
 * and the overwhelmingly common case is "no page at this level at all" (space
 * flight, coarse LODs). Checking a small integer set first keeps that case off
 * the Map entirely.
 */
const residentLevels = new Map<number, number>();

function retainLevel(level: number): void {
  residentLevels.set(level, (residentLevels.get(level) ?? 0) + 1);
}

function releaseLevel(level: number): void {
  const count = residentLevels.get(level);
  if (count === undefined) return;
  if (count <= 1) residentLevels.delete(level);
  else residentLevels.set(level, count - 1);
}

export function installHeightPage(raster: TileHeightRaster): void {
  if (!isValidTileHeightRaster(raster)) return;
  const key = pageKey(raster.face, raster.level, raster.x, raster.y);
  if (!pages.has(key)) retainLevel(raster.level);
  pages.set(key, raster);
}

export function releaseHeightPage(
  face: CubeFace,
  level: number,
  x: number,
  y: number,
): void {
  const key = pageKey(face, level, x, y);
  if (!pages.delete(key)) return;
  releaseLevel(level);
}

export function clearHeightPages(): void {
  pages.clear();
  residentLevels.clear();
}

export function getHeightPage(
  face: CubeFace,
  level: number,
  x: number,
  y: number,
): TileHeightRaster | null {
  return pages.get(pageKey(face, level, x, y)) ?? null;
}

export function heightPageCount(): number {
  return pages.size;
}

/**
 * Byte offset of a global grid corner within a resident page, or -1.
 *
 * Grid coordinates are global across a cube face at a level, so a corner on a
 * tile boundary belongs to two tiles. Both pages store it and both store the
 * same value — the raster builder evaluates the field from the global grid
 * coordinate, not from tile-relative bounds — so either page may answer and the
 * shared edge cannot disagree.
 */
export function lookupGridSampleOffset(
  face: CubeFace,
  level: number,
  gridX: number,
  gridY: number,
): { raster: TileHeightRaster; offset: number } | null {
  if (!residentLevels.has(level)) return null;

  // The corner may be the far edge of the previous tile rather than the near
  // edge of the tile the floor divide lands on; both are valid, so prefer the
  // one that is resident.
  const tileX = Math.floor(gridX / RENDER_SURFACE_SEGMENTS);
  const tileY = Math.floor(gridY / RENDER_SURFACE_SEGMENTS);
  const page = pages.get(pageKey(face, level, tileX, tileY));
  if (page) {
    const column = gridX - rasterGridOriginX(tileX);
    const row = gridY - rasterGridOriginY(tileY);
    if (
      column >= 0 &&
      column < TILE_RASTER_WIDTH &&
      row >= 0 &&
      row < TILE_RASTER_WIDTH
    ) {
      return {
        raster: page,
        offset: (row * TILE_RASTER_WIDTH + column) * RASTER_CHANNEL_COUNT,
      };
    }
  }

  // Exact multiples of the segment count sit on the shared edge. When the tile
  // to the right/above is not resident, the tile to the left/below still holds
  // that column or row as its last entry.
  const onColumnEdge = gridX % RENDER_SURFACE_SEGMENTS === 0;
  const onRowEdge = gridY % RENDER_SURFACE_SEGMENTS === 0;
  if (!onColumnEdge && !onRowEdge) return null;

  const previousX = onColumnEdge ? tileX - 1 : tileX;
  const previousY = onRowEdge ? tileY - 1 : tileY;
  if (previousX < 0 || previousY < 0) return null;
  const neighbour = pages.get(pageKey(face, level, previousX, previousY));
  if (!neighbour) return null;
  const column = gridX - rasterGridOriginX(previousX);
  const row = gridY - rasterGridOriginY(previousY);
  if (
    column < 0 ||
    column >= TILE_RASTER_WIDTH ||
    row < 0 ||
    row >= TILE_RASTER_WIDTH
  ) {
    return null;
  }
  return {
    raster: neighbour,
    offset: (row * TILE_RASTER_WIDTH + column) * RASTER_CHANNEL_COUNT,
  };
}

export interface HeightPageStats {
  pages: number;
  levels: number;
  hits: number;
  misses: number;
}

const stats = { hits: 0, misses: 0 };

export function recordHeightPageHit(): void {
  stats.hits += 1;
}

export function recordHeightPageMiss(): void {
  stats.misses += 1;
}

export function getHeightPageStats(): HeightPageStats {
  return {
    pages: pages.size,
    levels: residentLevels.size,
    hits: stats.hits,
    misses: stats.misses,
  };
}
