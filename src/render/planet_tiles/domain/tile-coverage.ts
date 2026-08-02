import type { Planet, TileInfo, Vec3 } from '../../../types';
import { normalize } from '../../../math/vec3';
import { faceUvFromDirection } from '../../../world/cube-sphere';
import { parentTileInfo, tileKey } from './tile-info';

export function tileContainsDirection(tile: TileInfo, position: Vec3): boolean {
  const faceUv = faceUvFromDirection(normalize(position));
  if (faceUv.face !== tile.face) return false;
  const { u0, u1, v0, v1 } = tile.bounds;
  return faceUv.u >= u0 && faceUv.u <= u1 && faceUv.v >= v0 && faceUv.v <= v1;
}

/**
 * Level of the nearest already-selected ancestor of `candidate`, or -1.
 *
 * Returns the candidate's own level when the candidate itself is selected, so
 * callers can treat "already rendered" as a zero-level gap.
 */
export function selectedTileAncestorLevel(
  candidate: TileInfo,
  selectedKeys: ReadonlySet<string>,
): number {
  let x = candidate.x;
  let y = candidate.y;
  for (let level = candidate.level; level >= 0; level -= 1) {
    if (selectedKeys.has(tileKey(candidate.face, level, x, y))) return level;
    x = Math.floor(x / 2);
    y = Math.floor(y / 2);
  }
  return -1;
}

export function hasSelectedTileAncestor(
  candidate: TileInfo,
  selectedKeys: ReadonlySet<string>,
): boolean {
  return selectedTileAncestorLevel(candidate, selectedKeys) >= 0;
}

/**
 * Records every ancestor of `info` so tile eviction cannot strand it.
 *
 * Fallback resolution walks up from a requested tile to the first ancestor that
 * still has a mesh. Nothing previously kept those intermediate ancestors alive:
 * they were neither selected nor resolved, so LRU eviction reclaimed them, and
 * a tile that briefly went unready would resolve all the way to a level-0 root
 * — one sixth of the planet at 24 segments. At ground level that surface sits
 * kilometres from the camera, which is what read as terrain vanishing.
 *
 * Walks to the root but stops at the first already-retained ancestor. Because
 * every insertion here continues to the root, a key being present implies its
 * whole chain is too, so sibling tiles converge after a step or two.
 */
export function retainFallbackAncestors(
  info: TileInfo,
  planet: Planet,
  ancestorKeys: Set<string>,
): void {
  let current = parentTileInfo(info, planet);
  while (current) {
    const key = tileKey(current.face, current.level, current.x, current.y);
    if (ancestorKeys.has(key)) return;
    ancestorKeys.add(key);
    current = parentTileInfo(current, planet);
  }
}

export function finestSelectedTileLevel(tiles: TileInfo[], position: Vec3): number {
  let finest = 0;
  for (const tile of tiles) {
    if (!tileContainsDirection(tile, position)) continue;
    finest = Math.max(finest, tile.level);
  }
  return finest;
}
