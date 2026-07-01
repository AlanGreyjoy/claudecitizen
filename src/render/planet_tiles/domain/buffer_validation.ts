import type { TerrainTileBuffers } from '../../../types';
import { TILE_SEGMENTS } from './constants';

export function isValidTerrainTileBuffers(buffers: TerrainTileBuffers): boolean {
  const expectedVertices = (TILE_SEGMENTS + 1) ** 2;
  const expectedLength = expectedVertices * 3;
  return (
    buffers.positions.length === expectedLength &&
    buffers.normals.length === expectedLength &&
    buffers.colors.length === expectedLength
  );
}
