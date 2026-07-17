import type { TerrainTileBuffers } from '../../../types';
import { TILE_SEGMENTS } from './constants';

export function isValidTerrainTileBuffers(buffers: TerrainTileBuffers): boolean {
  const expectedVertices = TILE_SEGMENTS * TILE_SEGMENTS * 6;
  const expectedLength = expectedVertices * 3;
  return (
    buffers.positions instanceof Float32Array &&
    buffers.normals instanceof Int16Array &&
    buffers.colors instanceof Uint8Array &&
    buffers.positions?.length === expectedLength &&
    buffers.normals?.length === expectedLength &&
    buffers.colors?.length === expectedLength
  );
}
