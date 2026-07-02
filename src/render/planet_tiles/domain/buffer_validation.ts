import type { TerrainTileBuffers } from '../../../types';
import { TILE_SEGMENTS } from './constants';

export function isValidTerrainTileBuffers(buffers: TerrainTileBuffers): boolean {
  const expectedVertices = (TILE_SEGMENTS + 1) ** 2;
  const expectedLength = expectedVertices * 3;
  return (
    buffers.positions?.length === expectedLength &&
    buffers.normals?.length === expectedLength &&
    buffers.colors?.length === expectedLength &&
    buffers.uvs?.length === expectedVertices * 2 &&
    buffers.weights0?.length === expectedVertices * 4 &&
    buffers.weights1?.length === expectedVertices * 4
  );
}
