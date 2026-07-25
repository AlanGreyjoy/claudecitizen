import type { TerrainTileBuffers } from '../../../types';
import { TERRAIN_TILE_VERTEX_COUNT } from './constants';

export function isValidTerrainTileBuffers(buffers: TerrainTileBuffers): boolean {
  const expectedLength = TERRAIN_TILE_VERTEX_COUNT * 3;
  return (
    buffers.positions instanceof Float32Array &&
    buffers.normals instanceof Int16Array &&
    buffers.colors instanceof Uint8Array &&
    buffers.positions?.length === expectedLength &&
    buffers.normals?.length === expectedLength &&
    buffers.colors?.length === expectedLength
  );
}
