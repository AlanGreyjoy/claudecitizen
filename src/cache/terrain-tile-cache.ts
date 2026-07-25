import type { Planet, TerrainTileBuffers } from '../types';
import { isValidTerrainTileBuffers } from '../render/planet_tiles/domain/buffer_validation';
import { terrainStorageKey } from './cache_keys';
import { getCachedTile, putCachedTile } from './tile_cache_store';

export interface StoredTerrainTile {
  colors: Uint8Array;
  normals: Int16Array;
  positions: Float32Array;
}

export function toStoredTerrainTile(buffers: TerrainTileBuffers): StoredTerrainTile {
  return {
    colors: buffers.colors,
    normals: buffers.normals,
    positions: buffers.positions,
  };
}

export function fromStoredTerrainTile(stored: StoredTerrainTile): TerrainTileBuffers {
  return {
    colors: stored.colors,
    normals: stored.normals,
    positions: stored.positions,
  };
}

export async function loadTerrainTile(
  planet: Planet,
  seed: number,
  face: Parameters<typeof terrainStorageKey>[2],
  level: number,
  x: number,
  y: number,
): Promise<TerrainTileBuffers | null> {
  const key = terrainStorageKey(planet, seed, face, level, x, y);
  const stored = await getCachedTile<StoredTerrainTile>(key);
  if (!stored?.positions?.length) return null;
  const buffers = fromStoredTerrainTile(stored);
  if (!isValidTerrainTileBuffers(buffers)) return null;
  return buffers;
}

export function saveTerrainTile(
  planet: Planet,
  seed: number,
  face: Parameters<typeof terrainStorageKey>[2],
  level: number,
  x: number,
  y: number,
  buffers: TerrainTileBuffers,
): void {
  const key = terrainStorageKey(planet, seed, face, level, x, y);
  void putCachedTile(key, toStoredTerrainTile(buffers)).catch(() => {});
}
