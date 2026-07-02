import type { Planet, TerrainTileBuffers } from '../types';
import { isValidTerrainTileBuffers } from '../render/planet_tiles/domain/buffer_validation';
import { terrainStorageKey } from './cache_keys';
import { getCachedTile, putCachedTile } from './tile_cache_store';

export interface StoredTerrainTile {
  colors: Float32Array;
  normals: Float32Array;
  positions: Float32Array;
  uvs: Float32Array;
  weights0: Float32Array;
  weights1: Float32Array;
}

export function toStoredTerrainTile(buffers: TerrainTileBuffers): StoredTerrainTile {
  return {
    colors: buffers.colors,
    normals: buffers.normals,
    positions: buffers.positions,
    uvs: buffers.uvs,
    weights0: buffers.weights0,
    weights1: buffers.weights1,
  };
}

export function fromStoredTerrainTile(stored: StoredTerrainTile): TerrainTileBuffers {
  return {
    colors: stored.colors,
    normals: stored.normals,
    positions: stored.positions,
    uvs: stored.uvs,
    weights0: stored.weights0,
    weights1: stored.weights1,
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
