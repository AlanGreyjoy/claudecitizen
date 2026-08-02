import { directionFromCubeFace } from '../../../world/cube-sphere';
import { RENDER_SURFACE_SEGMENTS } from '../../../world/renderable-surface-constants';
import type { CubeFace, Planet, TileInfo, Vec3 } from '../../../types';
import {
  TERRAIN_SKIRT_DEPTH_FACTOR,
  TERRAIN_SKIRT_MAX_DEPTH_METERS,
  TERRAIN_SKIRT_MIN_DEPTH_METERS,
  TILE_SEGMENTS,
} from './constants';

/**
 * Vertex placement for a terrain tile, as pure arithmetic.
 *
 * This is the reference implementation of what the terrain vertex shader does.
 * It exists separately from the shader so the math can be asserted against the
 * CPU mesh builder in `npm run terrain:validate` — a GPU displacement path is
 * otherwise only checkable by looking at it, and "looks about right" is exactly
 * how the mesh-vs-foot invariant gets broken.
 *
 * Keep this and `render/terrain-node-material.ts` in lockstep: the TSL graph is
 * a transliteration of these functions, not an independent derivation.
 */

/** Grid corners along a tile edge. */
export const TILE_VERTEX_WIDTH = TILE_SEGMENTS + 1;

/**
 * Cube-face parameter for a tile's grid corner.
 *
 * Derived from the *global* grid coordinate rather than by interpolating tile
 * bounds. The two are algebraically equal; they are not bit-equal, and the
 * height raster is built from the global form, so using it here is what keeps
 * displaced vertices on exactly the sampled surface.
 */
export function tileVertexFaceUv(
  level: number,
  tileX: number,
  tileY: number,
  column: number,
  row: number,
): { u: number; v: number } {
  const cellsPerFace = 2 ** level * RENDER_SURFACE_SEGMENTS;
  return {
    u: -1 + ((tileX * RENDER_SURFACE_SEGMENTS + column) * 2) / cellsPerFace,
    v: -1 + ((tileY * RENDER_SURFACE_SEGMENTS + row) * 2) / cellsPerFace,
  };
}

export function tileVertexDirection(
  face: CubeFace,
  level: number,
  tileX: number,
  tileY: number,
  column: number,
  row: number,
): Vec3 {
  const { u, v } = tileVertexFaceUv(level, tileX, tileY, column, row);
  return directionFromCubeFace(face, u, v);
}

/**
 * Surface position for a grid corner, relative to the tile centre.
 *
 * Tile-centre relative because absolute planet-radius magnitudes in float32
 * destroy the precision the geometry needs; the tile's own transform carries
 * the offset back.
 */
export function tileVertexPosition(
  info: TileInfo,
  planet: Planet,
  column: number,
  row: number,
  heightMeters: number,
): Vec3 {
  const direction = tileVertexDirection(
    info.face,
    info.level,
    info.x,
    info.y,
    column,
    row,
  );
  const surfaceRadius = planet.radiusMeters + heightMeters;
  return {
    x: direction.x * surfaceRadius - info.centerPosition.x,
    y: direction.y * surfaceRadius - info.centerPosition.y,
    z: direction.z * surfaceRadius - info.centerPosition.z,
  };
}

/**
 * Cube-face basis: `directionFromCubeFace(face, u, v) = normalize(axis + u*uAxis + v*vAxis)`.
 *
 * Spelled out as a basis rather than reused from `directionFromCubeFace` because
 * the float32-safe vertex path needs the *unnormalised* cube point and its two
 * parameter axes separately — the whole trick below is keeping `u` and `v`
 * offsets in a form where the large terms never appear.
 */
export function cubeFaceBasis(face: CubeFace): {
  axis: Vec3;
  uAxis: Vec3;
  vAxis: Vec3;
} {
  switch (face) {
    case 'px':
      return { axis: { x: 1, y: 0, z: 0 }, uAxis: { x: 0, y: 0, z: -1 }, vAxis: { x: 0, y: 1, z: 0 } };
    case 'nx':
      return { axis: { x: -1, y: 0, z: 0 }, uAxis: { x: 0, y: 0, z: 1 }, vAxis: { x: 0, y: 1, z: 0 } };
    case 'py':
      return { axis: { x: 0, y: 1, z: 0 }, uAxis: { x: 1, y: 0, z: 0 }, vAxis: { x: 0, y: 0, z: -1 } };
    case 'ny':
      return { axis: { x: 0, y: -1, z: 0 }, uAxis: { x: 1, y: 0, z: 0 }, vAxis: { x: 0, y: 0, z: 1 } };
    case 'pz':
      return { axis: { x: 0, y: 0, z: 1 }, uAxis: { x: 1, y: 0, z: 0 }, vAxis: { x: 0, y: 1, z: 0 } };
    default:
      return { axis: { x: 0, y: 0, z: -1 }, uAxis: { x: -1, y: 0, z: 0 }, vAxis: { x: 0, y: 1, z: 0 } };
  }
}

/**
 * Surface position relative to the tile centre, computed so float32 survives it.
 *
 * `tileVertexPosition` is algebraically identical and is what the CPU mesh
 * builder effectively does, but it forms `direction * (radius + height)` — about
 * 6.37e6 — and then subtracts a number just as large. In float64 that is fine.
 * In a shader it is not: float32 spacing at that magnitude is ~0.5 m, so every
 * vertex of a 3 m quad would snap to a half-metre lattice.
 *
 * So the large terms are cancelled symbolically instead of numerically. Writing
 * the vertex's cube point as the tile centre's cube point `c0` plus a small
 * exact offset `d`, the difference of the two normalised directions has a closed
 * form in which `d` is the only input that carries the tile's scale:
 *
 *   direction - centreDirection = (c0 * (q - 1) + d * q) / |c0|,  q = 1/sqrt(1+s)
 *
 * with `s` the relative change in squared length. `q - 1` is itself a
 * cancelling difference near zero, so it uses the algebraically equal
 * `-s / (r * (r + 1))`, which is not. The planet radius then multiplies only
 * that small difference, and the error it can carry is second order.
 *
 * Returns the direction as well: the skirt drop and the geomorph both need the
 * vertex's own radial, and recomputing it from `u`/`v` would reintroduce exactly
 * the precision loss this avoids.
 */
export function tileVertexRelativePosition(
  info: TileInfo,
  planet: Planet,
  column: number,
  row: number,
  heightMeters: number,
): { direction: Vec3; relative: Vec3 } {
  const { axis, uAxis, vAxis } = cubeFaceBasis(info.face);
  const cellsPerFace = 2 ** info.level * RENDER_SURFACE_SEGMENTS;
  const half = RENDER_SURFACE_SEGMENTS / 2;
  const centerU = -1 + ((info.x * RENDER_SURFACE_SEGMENTS + half) * 2) / cellsPerFace;
  const centerV = -1 + ((info.y * RENDER_SURFACE_SEGMENTS + half) * 2) / cellsPerFace;
  // Exact: `column` and `half` are integers, so the offset never forms a large
  // intermediate and never cancels against one.
  const deltaU = ((column - half) * 2) / cellsPerFace;
  const deltaV = ((row - half) * 2) / cellsPerFace;

  const c0x = axis.x + uAxis.x * centerU + vAxis.x * centerV;
  const c0y = axis.y + uAxis.y * centerU + vAxis.y * centerV;
  const c0z = axis.z + uAxis.z * centerU + vAxis.z * centerV;
  const dx = uAxis.x * deltaU + vAxis.x * deltaV;
  const dy = uAxis.y * deltaU + vAxis.y * deltaV;
  const dz = uAxis.z * deltaU + vAxis.z * deltaV;

  const lengthSquared = c0x * c0x + c0y * c0y + c0z * c0z;
  const inverseLength = 1 / Math.sqrt(lengthSquared);
  const s =
    (2 * (c0x * dx + c0y * dy + c0z * dz) + (dx * dx + dy * dy + dz * dz)) /
    lengthSquared;
  const r = Math.sqrt(1 + s);
  const q = 1 / r;
  const qMinusOne = -s / (r * (r + 1));

  const deltaDirectionX = (c0x * qMinusOne + dx * q) * inverseLength;
  const deltaDirectionY = (c0y * qMinusOne + dy * q) * inverseLength;
  const deltaDirectionZ = (c0z * qMinusOne + dz * q) * inverseLength;
  const direction = {
    x: c0x * inverseLength + deltaDirectionX,
    y: c0y * inverseLength + deltaDirectionY,
    z: c0z * inverseLength + deltaDirectionZ,
  };

  return {
    direction,
    relative: {
      x: deltaDirectionX * planet.radiusMeters + direction.x * heightMeters,
      y: deltaDirectionY * planet.radiusMeters + direction.y * heightMeters,
      z: deltaDirectionZ * planet.radiusMeters + direction.z * heightMeters,
    },
  };
}

export function terrainSkirtDepthMeters(info: TileInfo): number {
  const cellSpanMeters = info.spanMeters / TILE_SEGMENTS;
  return Math.max(
    TERRAIN_SKIRT_MIN_DEPTH_METERS,
    Math.min(TERRAIN_SKIRT_MAX_DEPTH_METERS, cellSpanMeters * TERRAIN_SKIRT_DEPTH_FACTOR),
  );
}

/** Drops a surface vertex radially by the skirt depth. */
export function tileSkirtPosition(
  info: TileInfo,
  surfaceRelative: Vec3,
  depthMeters: number,
): Vec3 {
  const worldX = info.centerPosition.x + surfaceRelative.x;
  const worldY = info.centerPosition.y + surfaceRelative.y;
  const worldZ = info.centerPosition.z + surfaceRelative.z;
  const inverseLength = 1 / Math.max(Math.hypot(worldX, worldY, worldZ), 1e-9);
  return {
    x: surfaceRelative.x - worldX * inverseLength * depthMeters,
    y: surfaceRelative.y - worldY * inverseLength * depthMeters,
    z: surfaceRelative.z - worldZ * inverseLength * depthMeters,
  };
}

/**
 * Geomorph blend.
 *
 * `morph` runs 0 (sitting on the parent's surface, so the tile appears exactly
 * where the coarser LOD drew) to 1 (its own detail). Animating it on tile
 * activation is what replaces the hard LOD snap: the refinement grows in over a
 * few frames instead of appearing between two of them.
 */
export function geomorphHeight(
  ownHeightMeters: number,
  parentHeightMeters: number,
  morph: number,
): number {
  const t = morph < 0 ? 0 : morph > 1 ? 1 : morph;
  return parentHeightMeters + (ownHeightMeters - parentHeightMeters) * t;
}

/**
 * Height a fine edge vertex must take to sit on a coarser neighbour's edge.
 *
 * A coarser neighbour has half the vertices along the shared edge, so its
 * surface there is the straight segment between the fine tile's even-indexed
 * corners. Odd-indexed fine vertices must therefore drop to the midpoint of
 * their neighbours or they poke through as cracks. Even-indexed vertices are
 * shared exactly and keep their own height.
 *
 * `levelDelta` is how many levels coarser the neighbour is; each level halves
 * the edge resolution again, so the span a vertex interpolates across doubles.
 */
export function edgeMorphedHeight(
  index: number,
  levelDelta: number,
  heightAt: (index: number) => number,
): number {
  if (levelDelta <= 0) return heightAt(index);
  const stride = 2 ** levelDelta;
  const lower = Math.floor(index / stride) * stride;
  const upper = Math.min(lower + stride, TILE_SEGMENTS);
  if (upper === lower) return heightAt(lower);
  const t = (index - lower) / (upper - lower);
  return heightAt(lower) + (heightAt(upper) - heightAt(lower)) * t;
}

/** Which tile edge, if any, a grid corner lies on. Corners belong to two. */
export function tileEdgeMask(column: number, row: number): number {
  let mask = 0;
  if (row === 0) mask |= 1;
  if (column === TILE_SEGMENTS) mask |= 2;
  if (row === TILE_SEGMENTS) mask |= 4;
  if (column === 0) mask |= 8;
  return mask;
}
