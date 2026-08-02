import type { TerrainTileBuffers } from '../../../types';
/**
 * Shape check for the CPU reference mesh.
 *
 * This used to gate the terrain disk cache, and silently killed it: commit
 * 4fa1300 repacked normals and colours to four components for WebGPU without
 * updating the expected lengths here, so every cached tile failed validation
 * and was rebuilt from scratch. Records no longer carry a mesh at all, so the
 * only caller left is `npm run terrain:validate` — keep it asserting what
 * `triangulateTerrainGrid` actually emits.
 */
import {
  TERRAIN_PACKED_COMPONENTS,
  TERRAIN_POSITION_COMPONENTS,
  TERRAIN_TILE_VERTEX_COUNT,
} from './constants';

export function isValidTerrainTileBuffers(buffers: TerrainTileBuffers): boolean {
  const expectedPositionLength =
    TERRAIN_TILE_VERTEX_COUNT * TERRAIN_POSITION_COMPONENTS;
  const expectedPackedLength = TERRAIN_TILE_VERTEX_COUNT * TERRAIN_PACKED_COMPONENTS;
  return (
    buffers.positions instanceof Float32Array &&
    buffers.normals instanceof Int16Array &&
    buffers.colors instanceof Uint8Array &&
    buffers.positions.length === expectedPositionLength &&
    buffers.normals.length === expectedPackedLength &&
    buffers.colors.length === expectedPackedLength
  );
}
