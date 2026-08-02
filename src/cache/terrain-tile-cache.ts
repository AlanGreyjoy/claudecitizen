import type { CubeFace, Planet } from '../types';
import {
  isValidTileHeightRaster,
  type TileHeightRaster,
} from '../world/terrain-raster';
import { terrainStorageKey } from './cache-keys';
import { getCachedTile, putCachedTile } from './tile-cache-store';

/**
 * What a terrain tile costs on disk.
 *
 * Records used to hold the triangulated mesh — positions, packed normals and
 * packed vertex colours, ~110 KB per tile — because the renderer drew per-tile
 * geometry. The shared grid displaces one shared geometry from the height
 * atlas, so the mesh is derivable and no longer worth storing: a record is now
 * the raster the worker evaluated plus its grid colours — ~37 KB against ~150
 * KB — with the same cut in structured-clone cost on the main thread.
 */
export interface StoredTerrainTile {
  raster: TileHeightRaster;
  /** Per-grid-corner RGB, three floats each, in grid order. */
  gridColors: Float32Array;
}

export interface LoadedTerrainTile {
  raster: TileHeightRaster;
  gridColors: Float32Array;
}

export async function loadTerrainTile(
  planet: Planet,
  seed: number,
  face: CubeFace,
  level: number,
  x: number,
  y: number,
): Promise<LoadedTerrainTile | null> {
  const key = terrainStorageKey(planet, seed, face, level, x, y);
  const stored = await getCachedTile<StoredTerrainTile>(key);
  if (!stored) return null;
  if (!isValidTileHeightRaster(stored.raster)) return null;
  if (!(stored.gridColors instanceof Float32Array)) return null;
  return { raster: stored.raster, gridColors: stored.gridColors };
}

/** Everything a built tile contributes to the cache record. */
export interface TerrainTilePayload {
  raster: TileHeightRaster;
  gridColors: Float32Array;
}

export function saveTerrainTile(
  planet: Planet,
  seed: number,
  face: CubeFace,
  level: number,
  x: number,
  y: number,
  payload: TerrainTilePayload,
): void {
  const key = terrainStorageKey(planet, seed, face, level, x, y);
  void putCachedTile(key, {
    raster: payload.raster,
    gridColors: payload.gridColors,
  } satisfies StoredTerrainTile).catch(() => {});
}
