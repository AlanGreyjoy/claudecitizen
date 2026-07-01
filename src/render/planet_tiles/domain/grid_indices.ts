import { TILE_SEGMENTS } from './constants';

export function buildGridIndices(segments: number): Uint32Array {
  const indices = new Uint32Array(segments * segments * 6);
  let ptr = 0;
  for (let y = 0; y < segments; y += 1) {
    for (let x = 0; x < segments; x += 1) {
      const topLeft = y * (segments + 1) + x;
      const topRight = topLeft + 1;
      const bottomLeft = topLeft + segments + 1;
      const bottomRight = bottomLeft + 1;
      indices[ptr] = topLeft;
      indices[ptr + 1] = bottomLeft;
      indices[ptr + 2] = topRight;
      indices[ptr + 3] = topRight;
      indices[ptr + 4] = bottomLeft;
      indices[ptr + 5] = bottomRight;
      ptr += 6;
    }
  }
  return indices;
}

export const TILE_GRID_INDICES = buildGridIndices(TILE_SEGMENTS);
