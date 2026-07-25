import * as THREE from 'three';
import type { Planet, TileInfo, Vec3 } from '../../../types';
import { directionFromCubeFace, faceUvFromDirection } from '../../../world/cube_sphere';
import { sampleVisibleSurfaceFrame } from '../../../world/renderable_surface';
import { terrainCellUsesNorthwestSoutheastDiagonal } from '../../../world/terrain_triangulation';
import {
  MAX_LEVEL,
  TERRAIN_SKIRT_VERTICES_PER_SEGMENT,
  TERRAIN_SURFACE_VERTEX_COUNT,
  TILE_SEGMENTS,
} from '../domain/constants';
import { tileKey } from '../domain/tile_info';

const NORTHWEST_SOUTHEAST_TRIANGLES = [0, 1, 3, 0, 3, 2] as const;
const NORTHEAST_SOUTHWEST_TRIANGLES = [0, 1, 2, 1, 3, 2] as const;

export interface TerrainSeamTile {
  info: TileInfo;
  mesh: THREE.Mesh;
}

interface TerrainSeamState {
  baseNormals: Int16Array;
  basePositions: Float32Array;
  signature: string;
}

interface StitchedEdge {
  edge: number;
  neighbor: TerrainSeamTile;
}

const seamStates = new WeakMap<THREE.BufferGeometry, TerrainSeamState>();

function clampTileCoordinate(value: number, tileCount: number): number {
  return Math.max(0, Math.min(tileCount - 1, value));
}

function findSelectedTileAtDirection(
  selectedByKey: ReadonlyMap<string, TerrainSeamTile>,
  direction: Vec3,
): TerrainSeamTile | null {
  const faceUv = faceUvFromDirection(direction);
  for (let level = MAX_LEVEL; level >= 0; level -= 1) {
    const tileCount = 2 ** level;
    const x = clampTileCoordinate(
      Math.floor(((faceUv.u + 1) * 0.5) * tileCount),
      tileCount,
    );
    const y = clampTileCoordinate(
      Math.floor(((faceUv.v + 1) * 0.5) * tileCount),
      tileCount,
    );
    const selected = selectedByKey.get(tileKey(faceUv.face, level, x, y));
    if (selected) return selected;
  }
  return null;
}

function directionAlongEdge(info: TileInfo, edge: number, t: number): Vec3 {
  const { u0, u1, v0, v1 } = info.bounds;
  if (edge === 0) return directionFromCubeFace(info.face, u0 + (u1 - u0) * t, v0);
  if (edge === 1) return directionFromCubeFace(info.face, u0 + (u1 - u0) * t, v1);
  if (edge === 2) return directionFromCubeFace(info.face, u0, v0 + (v1 - v0) * t);
  return directionFromCubeFace(info.face, u1, v0 + (v1 - v0) * t);
}

function directionAcrossEdge(info: TileInfo, edge: number): Vec3 {
  const { u0, u1, v0, v1 } = info.bounds;
  const epsilon = Math.max((u1 - u0) * 1e-3, 1e-10);
  const u = (u0 + u1) * 0.5;
  const v = (v0 + v1) * 0.5;
  if (edge === 0) return directionFromCubeFace(info.face, u, v0 - epsilon);
  if (edge === 1) return directionFromCubeFace(info.face, u, v1 + epsilon);
  if (edge === 2) return directionFromCubeFace(info.face, u0 - epsilon, v);
  return directionFromCubeFace(info.face, u1 + epsilon, v);
}

function stitchedEdgesForTile(
  tile: TerrainSeamTile,
  selectedByKey: ReadonlyMap<string, TerrainSeamTile>,
): StitchedEdge[] {
  const stitched: StitchedEdge[] = [];
  for (let edge = 0; edge < 4; edge += 1) {
    const neighbor = findSelectedTileAtDirection(
      selectedByKey,
      directionAcrossEdge(tile.info, edge),
    );
    if (!neighbor || neighbor.info.level >= tile.info.level) continue;
    stitched.push({ edge, neighbor });
  }
  return stitched.sort((left, right) => {
    if (left.neighbor.info.level !== right.neighbor.info.level) {
      return left.neighbor.info.level - right.neighbor.info.level;
    }
    return left.edge - right.edge;
  });
}

function seamStateFor(mesh: THREE.Mesh): TerrainSeamState | null {
  const geometry = mesh.geometry;
  const existing = seamStates.get(geometry);
  if (existing) return existing;
  const positions = geometry.getAttribute('position');
  const normals = geometry.getAttribute('normal');
  if (
    !(positions?.array instanceof Float32Array) ||
    !(normals?.array instanceof Int16Array)
  ) {
    return null;
  }
  const state: TerrainSeamState = {
    baseNormals: normals.array.slice(),
    basePositions: positions.array.slice(),
    signature: '',
  };
  geometry.setAttribute(
    'position',
    new THREE.BufferAttribute(state.basePositions.slice(), 3),
  );
  seamStates.set(geometry, state);
  return state;
}

function writePosition(positions: Float32Array, vertex: number, point: Vec3): void {
  const offset = vertex * 3;
  positions[offset] = point.x;
  positions[offset + 1] = point.y;
  positions[offset + 2] = point.z;
}

function readPosition(positions: Float32Array, vertex: number): Vec3 {
  const offset = vertex * 3;
  return {
    x: positions[offset],
    y: positions[offset + 1],
    z: positions[offset + 2],
  };
}

function gridIndexForEdge(edge: number, index: number): number {
  const width = TILE_SEGMENTS + 1;
  if (edge === 0) return index;
  if (edge === 1) return TILE_SEGMENTS * width + index;
  if (edge === 2) return index * width;
  return index * width + TILE_SEGMENTS;
}

function edgeTargets(
  info: TileInfo,
  neighborLevel: number,
  edge: number,
  planet: Planet,
  seed: number,
): Vec3[] {
  const targets: Vec3[] = [];
  for (let index = 0; index <= TILE_SEGMENTS; index += 1) {
    const direction = directionAlongEdge(info, edge, index / TILE_SEGMENTS);
    const point = sampleVisibleSurfaceFrame(planet, seed, direction, neighborLevel).point;
    targets.push({
      x: point.x - info.centerPosition.x,
      y: point.y - info.centerPosition.y,
      z: point.z - info.centerPosition.z,
    });
  }
  return targets;
}

function applySurfaceTargets(
  positions: Float32Array,
  info: TileInfo,
  targetByGridIndex: ReadonlyMap<number, Vec3>,
): void {
  const width = TILE_SEGMENTS + 1;
  let outputVertex = 0;
  for (let y = 0; y < TILE_SEGMENTS; y += 1) {
    for (let x = 0; x < TILE_SEGMENTS; x += 1) {
      const northwest = y * width + x;
      const corners = [
        northwest,
        northwest + 1,
        northwest + width,
        northwest + width + 1,
      ] as const;
      const globalCellX = info.x * TILE_SEGMENTS + x;
      const globalCellY = info.y * TILE_SEGMENTS + y;
      const pattern = terrainCellUsesNorthwestSoutheastDiagonal(
        globalCellX,
        globalCellY,
      )
        ? NORTHWEST_SOUTHEAST_TRIANGLES
        : NORTHEAST_SOUTHWEST_TRIANGLES;
      for (const cornerIndex of pattern) {
        const target = targetByGridIndex.get(corners[cornerIndex]);
        if (target) writePosition(positions, outputVertex, target);
        outputVertex += 1;
      }
    }
  }
}

function worldDirectionForLocal(info: TileInfo, point: Vec3): Vec3 {
  const x = info.centerPosition.x + point.x;
  const y = info.centerPosition.y + point.y;
  const z = info.centerPosition.z + point.z;
  const inverseLength = 1 / Math.max(Math.hypot(x, y, z), 1e-9);
  return { x: x * inverseLength, y: y * inverseLength, z: z * inverseLength };
}

function collapseStitchedSkirt(
  positions: Float32Array,
  basePositions: Float32Array,
  info: TileInfo,
  edge: number,
  targets: readonly Vec3[],
): void {
  const edgeFirstVertex =
    TERRAIN_SURFACE_VERTEX_COUNT +
    edge * TILE_SEGMENTS * TERRAIN_SKIRT_VERTICES_PER_SEGMENT;
  for (let segment = 0; segment < TILE_SEGMENTS; segment += 1) {
    const segmentFirstVertex =
      edgeFirstVertex + segment * TERRAIN_SKIRT_VERTICES_PER_SEGMENT;
    const topA = readPosition(basePositions, segmentFirstVertex);
    const topBCandidateA = readPosition(basePositions, segmentFirstVertex + 1);
    const topBCandidateB = readPosition(basePositions, segmentFirstVertex + 2);
    const radiusA = Math.hypot(
      info.centerPosition.x + topBCandidateA.x,
      info.centerPosition.y + topBCandidateA.y,
      info.centerPosition.z + topBCandidateA.z,
    );
    const radiusB = Math.hypot(
      info.centerPosition.x + topBCandidateB.x,
      info.centerPosition.y + topBCandidateB.y,
      info.centerPosition.z + topBCandidateB.z,
    );
    const topB = radiusA >= radiusB ? topBCandidateA : topBCandidateB;
    const directionA = worldDirectionForLocal(info, topA);
    const directionB = worldDirectionForLocal(info, topB);
    for (
      let localVertex = 0;
      localVertex < TERRAIN_SKIRT_VERTICES_PER_SEGMENT;
      localVertex += 1
    ) {
      const vertex = segmentFirstVertex + localVertex;
      const direction = worldDirectionForLocal(
        info,
        readPosition(basePositions, vertex),
      );
      const dotA =
        direction.x * directionA.x +
        direction.y * directionA.y +
        direction.z * directionA.z;
      const dotB =
        direction.x * directionB.x +
        direction.y * directionB.y +
        direction.z * directionB.z;
      writePosition(positions, vertex, dotA >= dotB ? targets[segment] : targets[segment + 1]);
    }
  }
}

function restoreBaseGeometry(mesh: THREE.Mesh, state: TerrainSeamState): void {
  const geometry = mesh.geometry;
  const positions = geometry.getAttribute('position');
  if (positions.array instanceof Float32Array) {
    positions.array.set(state.basePositions);
    positions.needsUpdate = true;
  }
  geometry.setAttribute(
    'normal',
    new THREE.BufferAttribute(state.baseNormals.slice(), 3, true),
  );
  geometry.computeBoundingSphere();
}

function applyStitchedEdges(
  tile: TerrainSeamTile,
  stitchedEdges: readonly StitchedEdge[],
  planet: Planet,
  seed: number,
): void {
  if (stitchedEdges.length === 0 && !seamStates.has(tile.mesh.geometry)) return;
  const state = seamStateFor(tile.mesh);
  if (!state) return;
  const signature = stitchedEdges
    .map(
      ({ edge, neighbor }) =>
        `${edge}:${tileKey(
          neighbor.info.face,
          neighbor.info.level,
          neighbor.info.x,
          neighbor.info.y,
        )}`,
    )
    .join('|');
  if (state.signature === signature) return;
  if (stitchedEdges.length === 0) {
    restoreBaseGeometry(tile.mesh, state);
    state.signature = '';
    return;
  }

  const positionAttribute = tile.mesh.geometry.getAttribute('position');
  if (!(positionAttribute.array instanceof Float32Array)) return;
  const positions = positionAttribute.array;
  positions.set(state.basePositions);
  const targetByGridIndex = new Map<number, Vec3>();
  const targetsByEdge = new Map<number, Vec3[]>();
  for (const { edge, neighbor } of stitchedEdges) {
    const targets = edgeTargets(
      tile.info,
      neighbor.info.level,
      edge,
      planet,
      seed,
    );
    targetsByEdge.set(edge, targets);
    for (let index = 0; index <= TILE_SEGMENTS; index += 1) {
      const gridIndex = gridIndexForEdge(edge, index);
      if (!targetByGridIndex.has(gridIndex)) {
        targetByGridIndex.set(gridIndex, targets[index]);
      }
    }
  }
  applySurfaceTargets(positions, tile.info, targetByGridIndex);
  for (const [edge, targets] of targetsByEdge) {
    collapseStitchedSkirt(
      positions,
      state.basePositions,
      tile.info,
      edge,
      targets,
    );
  }
  positionAttribute.needsUpdate = true;
  tile.mesh.geometry.deleteAttribute('normal');
  tile.mesh.geometry.computeVertexNormals();
  tile.mesh.geometry.computeBoundingSphere();
  state.signature = signature;
}

/**
 * Snap only the finer side of active mixed-LOD contacts onto the rendered
 * coarse surface. The fine tile keeps full interior detail, while its outermost
 * triangle row becomes a short transition instead of exposing a vertical skirt.
 */
export function updateTerrainSeamStitching(
  tiles: readonly TerrainSeamTile[],
  planet: Planet,
  seed: number,
): void {
  const selectedByKey = new Map<string, TerrainSeamTile>();
  for (const tile of tiles) {
    selectedByKey.set(
      tileKey(tile.info.face, tile.info.level, tile.info.x, tile.info.y),
      tile,
    );
  }
  for (const tile of tiles) {
    applyStitchedEdges(
      tile,
      stitchedEdgesForTile(tile, selectedByKey),
      planet,
      seed,
    );
  }
}
