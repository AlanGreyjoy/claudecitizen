import type { TileInfo, Vec3 } from '../../../types';
import { normalize } from '../../../math/vec3';
import { faceUvFromDirection } from '../../../world/cube_sphere';

export function tileContainsDirection(tile: TileInfo, position: Vec3): boolean {
  const faceUv = faceUvFromDirection(normalize(position));
  if (faceUv.face !== tile.face) return false;
  const { u0, u1, v0, v1 } = tile.bounds;
  return faceUv.u >= u0 && faceUv.u <= u1 && faceUv.v >= v0 && faceUv.v <= v1;
}

export function finestSelectedTileLevel(tiles: TileInfo[], position: Vec3): number {
  let finest = 0;
  for (const tile of tiles) {
    if (!tileContainsDirection(tile, position)) continue;
    finest = Math.max(finest, tile.level);
  }
  return finest;
}
