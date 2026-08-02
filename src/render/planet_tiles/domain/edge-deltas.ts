import type { TileInfo } from '../../../types';
import { tileKey } from './tile-info';

/**
 * How many levels coarser the neighbour across each tile edge is.
 *
 * Feeds the vertex shader's edge morph: a coarser neighbour resolves the shared
 * edge with fewer vertices, so this tile's extra edge vertices must fold onto
 * the straight run between the shared ones or they poke through as cracks. This
 * replaces CPU seam stitching, which achieved the same thing by rewriting the
 * tile's vertex positions and recomputing its normals every time the LOD
 * configuration changed — and which flipped the geometry's normal attribute
 * between two formats in the process, forcing a pipeline rebuild each way.
 *
 * Edge order matches `tileEdgeMask` and `grid-geometry`'s skirt edges:
 * 0 = top (row 0), 1 = right, 2 = bottom, 3 = left.
 *
 * Three cases, and the shader needs all three kept apart:
 * - `0`  — a same-level neighbour is being rendered. The seam is closed, so the
 *          morph is a no-op *and* the skirt on that edge is dead weight.
 * - `> 0` — a coarser neighbour. Morph folds onto it; the skirt stays as cover.
 * - `EDGE_NEIGHBOUR_ABSENT` — nothing resolved: a cross-face edge, a neighbour
 *          past the search bound, or a tile that is culled or still building.
 *          The morph has nothing to fold onto and the skirt is the only cover.
 */

/**
 * No neighbour resolved for an edge. Negative so the morph gate
 * (`delta > 0`) already excludes it, and so it is distinguishable from a
 * genuine same-level neighbour, which the skirt suppression depends on.
 */
export const EDGE_NEIGHBOUR_ABSENT = -1;

/**
 * Neighbours in a well-formed quadtree differ by a level or two; anything
 * deeper is a transient the skirts already cover. Bounding the search keeps
 * this from walking eighteen levels per edge per tile per frame.
 */
const MAX_NEIGHBOUR_SEARCH_LEVELS = 4;

const NEIGHBOUR_OFFSETS: readonly (readonly [number, number])[] = [
  [0, -1],
  [1, 0],
  [0, 1],
  [-1, 0],
];

function neighbourLevelDelta(
  info: TileInfo,
  offsetX: number,
  offsetY: number,
  renderedKeys: ReadonlySet<string>,
): number {
  const tilesPerAxis = 2 ** info.level;
  let x = info.x + offsetX;
  let y = info.y + offsetY;
  // Cross-face neighbours need a face rotation this does not model. They are
  // rare (twelve cube edges) and skirts still cover them, so leave them
  // unmorphed rather than guessing at a wrong fold.
  if (x < 0 || y < 0 || x >= tilesPerAxis || y >= tilesPerAxis) {
    return EDGE_NEIGHBOUR_ABSENT;
  }

  for (let delta = 0; delta <= MAX_NEIGHBOUR_SEARCH_LEVELS; delta += 1) {
    const level = info.level - delta;
    if (level < 0) break;
    if (renderedKeys.has(tileKey(info.face, level, x, y))) return delta;
    x >>= 1;
    y >>= 1;
  }
  return EDGE_NEIGHBOUR_ABSENT;
}

/** Writes the four deltas into `out` to keep this allocation-free per frame. */
export function resolveEdgeDeltas(
  info: TileInfo,
  renderedKeys: ReadonlySet<string>,
  out: [number, number, number, number],
): [number, number, number, number] {
  for (let edge = 0; edge < 4; edge += 1) {
    const [offsetX, offsetY] = NEIGHBOUR_OFFSETS[edge];
    out[edge] = neighbourLevelDelta(info, offsetX, offsetY, renderedKeys);
  }
  return out;
}
