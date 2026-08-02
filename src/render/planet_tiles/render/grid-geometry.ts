import * as THREE from 'three';
import { terrainCellUsesNorthwestSoutheastDiagonal } from '../../../world/terrain-triangulation';
import { TILE_SEGMENTS } from '../domain/constants';
import { TILE_VERTEX_WIDTH } from '../domain/tile-vertex';

/**
 * The one grid every terrain tile draws.
 *
 * Tiles used to own a `BufferGeometry` apiece: 4,608 non-indexed vertices,
 * three attributes, a bounding sphere, allocated on arrival and disposed on
 * eviction. Positions are a pure function of the tile and its height raster, so
 * none of that needs to be per-tile — the grid is topology, and topology is
 * identical for every tile. The vertex shader displaces this single geometry.
 *
 * That the index buffer can be shared at all depends on the diagonal rule:
 * `terrainCellUsesNorthwestSoutheastDiagonal` alternates on `(gridX + gridY)`
 * parity, and a tile's grid origin is `tileCoordinate * TILE_SEGMENTS`. With
 * TILE_SEGMENTS even, that origin never changes the parity, so the pattern
 * inside every tile is the same. If TILE_SEGMENTS ever becomes odd, this
 * geometry must become per-parity instead.
 */

/** Skirt edges, in the order `tileEdgeMask` bits are assigned. */
const SKIRT_EDGE_COUNT = 4;

export const TERRAIN_SURFACE_VERTICES = TILE_VERTEX_WIDTH * TILE_VERTEX_WIDTH;
export const TERRAIN_SKIRT_VERTICES = SKIRT_EDGE_COUNT * TILE_VERTEX_WIDTH;
export const TERRAIN_GRID_VERTICES =
  TERRAIN_SURFACE_VERTICES + TERRAIN_SKIRT_VERTICES;

function surfaceVertexIndex(column: number, row: number): number {
  return row * TILE_VERTEX_WIDTH + column;
}

/** Grid corner each skirt edge walks, from its edge index and step. */
function skirtEdgeCoordinate(edge: number, step: number): { column: number; row: number } {
  switch (edge) {
    case 0:
      return { column: step, row: 0 };
    case 1:
      return { column: TILE_SEGMENTS, row: step };
    case 2:
      return { column: step, row: TILE_SEGMENTS };
    default:
      return { column: 0, row: step };
  }
}

function skirtVertexIndex(edge: number, step: number): number {
  return TERRAIN_SURFACE_VERTICES + edge * TILE_VERTEX_WIDTH + step;
}

/**
 * Builds the shared grid.
 *
 * The `position` attribute carries vertex *identity*, not a position: x is the
 * grid column, y the grid row, z the skirt edge (0 for surface vertices, edge
 * index + 1 for skirt vertices). The vertex shader turns that into a real
 * position by sampling the tile's height page. Packing identity into `position`
 * rather than adding attributes keeps the vertex buffer count down — WebGPU
 * only guarantees eight, and terrain also needs per-instance data.
 */
export function createTerrainGridGeometry(): THREE.InstancedBufferGeometry {
  // Instanced so one draw covers every visible tile; `instanceCount` is set
  // per frame from the selection.
  const geometry = new THREE.InstancedBufferGeometry();
  const identity = new Float32Array(TERRAIN_GRID_VERTICES * 3);

  for (let row = 0; row < TILE_VERTEX_WIDTH; row += 1) {
    for (let column = 0; column < TILE_VERTEX_WIDTH; column += 1) {
      const offset = surfaceVertexIndex(column, row) * 3;
      identity[offset] = column;
      identity[offset + 1] = row;
      identity[offset + 2] = 0;
    }
  }
  for (let edge = 0; edge < SKIRT_EDGE_COUNT; edge += 1) {
    for (let step = 0; step < TILE_VERTEX_WIDTH; step += 1) {
      const { column, row } = skirtEdgeCoordinate(edge, step);
      const offset = skirtVertexIndex(edge, step) * 3;
      identity[offset] = column;
      identity[offset + 1] = row;
      identity[offset + 2] = edge + 1;
    }
  }
  geometry.setAttribute('position', new THREE.BufferAttribute(identity, 3));

  const indices: number[] = [];
  for (let row = 0; row < TILE_SEGMENTS; row += 1) {
    for (let column = 0; column < TILE_SEGMENTS; column += 1) {
      const topLeft = surfaceVertexIndex(column, row);
      const topRight = surfaceVertexIndex(column + 1, row);
      const bottomLeft = surfaceVertexIndex(column, row + 1);
      const bottomRight = surfaceVertexIndex(column + 1, row + 1);
      if (terrainCellUsesNorthwestSoutheastDiagonal(column, row)) {
        indices.push(topLeft, topRight, bottomRight);
        indices.push(topLeft, bottomRight, bottomLeft);
      } else {
        indices.push(topLeft, topRight, bottomLeft);
        indices.push(topRight, bottomRight, bottomLeft);
      }
    }
  }

  // Skirts are emitted with both windings. They exist to cover a seam that may
  // be viewed from either adjacent tile, and the terrain material renders
  // FrontSide so the surface itself keeps backface culling.
  for (let edge = 0; edge < SKIRT_EDGE_COUNT; edge += 1) {
    for (let step = 0; step < TILE_SEGMENTS; step += 1) {
      const a = skirtEdgeCoordinate(edge, step);
      const b = skirtEdgeCoordinate(edge, step + 1);
      const topA = surfaceVertexIndex(a.column, a.row);
      const topB = surfaceVertexIndex(b.column, b.row);
      const bottomA = skirtVertexIndex(edge, step);
      const bottomB = skirtVertexIndex(edge, step + 1);
      indices.push(topA, topB, bottomB);
      indices.push(topA, bottomB, bottomA);
      indices.push(topB, topA, bottomA);
      indices.push(topB, bottomA, bottomB);
    }
  }

  geometry.setIndex(indices);
  // Positions are shader-derived, so an attribute-derived bound is meaningless.
  // Terrain culls per tile through selection, not through three.
  geometry.boundingSphere = new THREE.Sphere(new THREE.Vector3(), Infinity);
  return geometry;
}

export const TERRAIN_GRID_INDEX_COUNT =
  TILE_SEGMENTS * TILE_SEGMENTS * 6 + SKIRT_EDGE_COUNT * TILE_SEGMENTS * 12;
