import assert from 'node:assert/strict';
import { performance } from 'node:perf_hooks';
import * as THREE from 'three';
import { normalize } from '../src/math/vec3';
import { buildTerrainTileBuffers } from '../src/render/planet_tiles/build/terrain_buffers';
import { createTileMeshCache } from '../src/render/planet_tiles/cache/mesh_cache';
import { isValidTerrainTileBuffers } from '../src/render/planet_tiles/domain/buffer_validation';
import {
  TERRAIN_SKIRT_VERTICES_PER_SEGMENT,
  TERRAIN_SURFACE_VERTEX_COUNT,
  TILE_SEGMENTS,
} from '../src/render/planet_tiles/domain/constants';
import { visitSelectedTiles } from '../src/render/planet_tiles/domain/selection';
import {
  makeTileInfo,
  parentTileInfo,
  tileKey,
} from '../src/render/planet_tiles/domain/tile_info';
import { createTerrainMaterial } from '../src/render/planet_tiles/render/terrain_material';
import type { CubeFace, TerrainTileBuffers, TileInfo, Vec3 } from '../src/types';
import { sampleSurfaceClimate } from '../src/world/climate';
import { CUBE_FACES, directionFromCubeFace } from '../src/world/cube_sphere';
import { sampleSurfaceHeightDetails } from '../src/world/elevation';
import {
  CLAUDECITIZEN_PLANET,
  DEFAULT_PLANET_SEED,
} from '../src/world/planets/runtime';
import {
  RENDER_SURFACE_LEVEL,
  RENDER_SURFACE_SEGMENTS,
  renderableGridSampleSpacingMeters,
  sampleVisibleSurfaceFrame,
} from '../src/world/renderable_surface';
import { getRiverNetworkDiagnostics } from '../src/world/rivers';
import { terrainCellUsesNorthwestSoutheastDiagonal } from '../src/world/terrain_triangulation';

interface EdgeContact {
  axis: 'u' | 'v';
  edgeA: number;
  edgeB: number;
}

interface EdgeSampleLocation {
  coordinate: number;
  edgeIndex: number;
  parameterEnd: number;
  parameterStart: number;
  sideOffset?: 0 | 6;
}

interface CubeBoundaryEdge {
  edge: number;
  id: string;
  parameterEnd: number;
  parameterStart: number;
}

interface MeasuredEdgeContact {
  coarse: TileInfo;
  coarseEdgeIndex: number;
  coarseParameterEnd: number;
  coarseParameterStart: number;
  fine: TileInfo;
  fineEdgeIndex: number;
  fineParameterEnd: number;
  fineParameterStart: number;
}

interface SameLodSeamComparison {
  left: TileInfo;
  leftEdgeIndex: number;
  leftParameterEnd: number;
  leftParameterStart: number;
  right: TileInfo;
  rightEdgeIndex: number;
  rightParameterEnd: number;
  rightParameterStart: number;
}

interface SameLodBoundaryCandidate {
  descriptor: CubeBoundaryEdge;
  edgeIndex: number;
  info: TileInfo;
}

interface MeshTriangleSample {
  triangle: 0 | 1;
  weights: readonly [number, number, number];
}

interface TerrainValidationSummary {
  coldCacheFallbackLevel: number;
  fallbackChainMinimumLevel: number;
  finestSelectedTiles: number;
  finestTriangleSpanMeters: number;
  horizonTileCounts: number[];
  highlandProbeHeightMeters: number;
  highlandSelectedLevel: number;
  highlandSelectedTiles: number;
  hydrology: ReturnType<typeof getRiverNetworkDiagnostics>;
  maxMixedLodGapToSkirtRatio: number;
  maxGroundMeshFootHeightErrorMeters: number;
  maxMeshFootHeightErrorMeters: number;
  maxSameLodSeamErrorMeters: number;
  maxVisibleFrameHeightErrorMeters: number;
  minimumSkirtFrontFacingDot: number;
  minimumGroundMeshFootNormalDot: number;
  mixedLodContacts: number;
  pinnedFallbackRoots: number;
  sameLodSeamContacts: number;
  selectedTiles: number;
  selectionMilliseconds: number;
  sharedVertexHeightErrorMeters: number;
}

const planet = CLAUDECITIZEN_PLANET;
const seed = DEFAULT_PLANET_SEED;
const edgeEpsilon = 1e-12;
const validationTerrainBuffers = new Map<string, TerrainTileBuffers>();

function validationBuffersFor(info: TileInfo): TerrainTileBuffers {
  const key = tileKey(info.face, info.level, info.x, info.y);
  let buffers = validationTerrainBuffers.get(key);
  if (!buffers) {
    buffers = buildTerrainTileBuffers(info, planet, seed);
    assert.ok(isValidTerrainTileBuffers(buffers));
    validationTerrainBuffers.set(key, buffers);
  }
  return buffers;
}

function scaleDirection(direction: Vec3, radiusMeters: number): Vec3 {
  return {
    x: direction.x * radiusMeters,
    y: direction.y * radiusMeters,
    z: direction.z * radiusMeters,
  };
}

function bodyPositionAt(directionInput: Vec3, altitudeMeters: number): Vec3 {
  const direction = normalize(directionInput);
  const surfaceHeight = sampleVisibleSurfaceFrame(
    planet,
    seed,
    direction,
    RENDER_SURFACE_LEVEL,
  ).heightMeters;
  return scaleDirection(
    direction,
    planet.radiusMeters + surfaceHeight + altitudeMeters,
  );
}

function selectedTilesForBody(bodyPosition: Vec3, altitudeMeters: number): TileInfo[] {
  const selected: TileInfo[] = [];
  visitSelectedTiles(planet, bodyPosition, altitudeMeters, (info) => selected.push(info));
  return selected;
}

function selectedTilesAt(directionInput: Vec3, altitudeMeters: number): TileInfo[] {
  return selectedTilesForBody(
    bodyPositionAt(directionInput, altitudeMeters),
    altitudeMeters,
  );
}

function validateHorizonCoverage(): number[] {
  const axes = [
    { x: 1, y: 0, z: 0 },
    { x: -1, y: 0, z: 0 },
    { x: 0, y: 1, z: 0 },
    { x: 0, y: -1, z: 0 },
    { x: 0, y: 0, z: 1 },
    { x: 0, y: 0, z: -1 },
  ];
  const counts: number[] = [];
  for (const altitudeMeters of [2, 1_000]) {
    for (const axis of axes) {
      const count = selectedTilesAt(axis, altitudeMeters).length;
      assert.ok(count > 0, `horizon culling removed every tile at ${JSON.stringify(axis)}`);
      counts.push(count);
    }
  }
  return counts;
}

function validateFallbackCoverage(selected: TileInfo[]): {
  coldCacheFallbackLevel: number;
  fallbackChainMinimumLevel: number;
  pinnedFallbackRoots: number;
} {
  let minimumLevel = Number.POSITIVE_INFINITY;
  for (const target of selected) {
    let current: TileInfo | null = target;
    let chainLength = 0;
    while (current) {
      minimumLevel = Math.min(minimumLevel, current.level);
      chainLength += 1;
      current = parentTileInfo(current, planet);
    }
    assert.equal(
      chainLength,
      target.level + 1,
      `${tileKey(target.face, target.level, target.x, target.y)} fallback chain did not reach L0`,
    );
  }
  assert.equal(minimumLevel, 0, 'fallback coverage did not reach a root tile');

  const material = createTerrainMaterial();
  const tileGroup = new THREE.Group();
  const cache = createTileMeshCache({ material, planet, seed, tileGroup });
  try {
    const target = selected.find((info) => info.level === RENDER_SURFACE_LEVEL);
    assert.ok(target, 'fallback validation had no finest-level target');
    const coldFallback = cache.requestBestAvailableTile(target, { remaining: 0 });
    assert.ok(coldFallback.mesh, 'cold cache returned a terrain hole');
    assert.equal(coldFallback.info.level, 0, 'cold cache did not resolve to a root tile');

    cache.setFrameNumber(10_000);
    cache.evictTileMeshes(new Set());
    const pinnedFallbackRoots = cache.countEntries('ready');
    assert.equal(pinnedFallbackRoots, CUBE_FACES.length, 'root fallback meshes were evicted');

    const oppositeTarget = makeTileInfo(
      target.face,
      target.level,
      2 ** target.level - 1 - target.x,
      2 ** target.level - 1 - target.y,
      planet,
    );
    const postEvictionFallback = cache.requestBestAvailableTile(oppositeTarget, {
      remaining: 0,
    });
    assert.ok(postEvictionFallback.mesh, 'post-eviction cache returned a terrain hole');
    assert.equal(postEvictionFallback.info.level, 0);
    return {
      coldCacheFallbackLevel: coldFallback.info.level,
      fallbackChainMinimumLevel: minimumLevel,
      pinnedFallbackRoots,
    };
  } finally {
    cache.dispose();
    material.dispose();
  }
}

function validateHighlandGroundDetail(): {
  heightMeters: number;
  selectedLevel: number;
  selectedTiles: number;
} {
  let highestDirection: Vec3 = { x: 1, y: 0, z: 0 };
  let heightMeters = Number.NEGATIVE_INFINITY;
  const candidates = 256;
  for (let index = 0; index < candidates; index += 1) {
    const y = 1 - (2 * (index + 0.5)) / candidates;
    const ringRadius = Math.sqrt(Math.max(0, 1 - y * y));
    const longitude = index * 2.399963229728653;
    const direction = {
      x: Math.cos(longitude) * ringRadius,
      y,
      z: Math.sin(longitude) * ringRadius,
    };
    const height = sampleVisibleSurfaceFrame(
      planet,
      seed,
      direction,
      RENDER_SURFACE_LEVEL,
    ).heightMeters;
    if (height <= heightMeters) continue;
    heightMeters = height;
    highestDirection = direction;
  }
  const selected = selectedTilesAt(highestDirection, 2);
  const selectedLevel = Math.max(...selected.map((info) => info.level));
  assert.ok(
    heightMeters > 450,
    `highland probe only reached ${heightMeters.toFixed(1)} m`,
  );
  assert.equal(
    selectedLevel,
    RENDER_SURFACE_LEVEL,
    `highland ground selection stopped at L${selectedLevel}`,
  );
  assert.ok(
    selected.length <= 340,
    `highland ground selection expanded to ${selected.length} tiles`,
  );
  return { heightMeters, selectedLevel, selectedTiles: selected.length };
}

function validateCanonicalSharedVertices(): number {
  let maximumError = 0;
  for (let index = 0; index < 600; index += 1) {
    const face = CUBE_FACES[index % CUBE_FACES.length];
    const level = 4 + (index % (RENDER_SURFACE_LEVEL - 5));
    const cells = 2 ** level * RENDER_SURFACE_SEGMENTS;
    const gridX = 1 + ((index * 7_919) % (cells - 2));
    const gridY = 1 + ((index * 1_543) % (cells - 2));
    const direction = directionFromCubeFace(
      face,
      -1 + (gridX * 2) / cells,
      -1 + (gridY * 2) / cells,
    );
    const coarse = sampleSurfaceHeightDetails(planet, seed, direction, {
      sampleSpacingMeters: renderableGridSampleSpacingMeters(
        planet,
        level,
        gridX,
        gridY,
      ),
    });
    const fineLevel = level + 2;
    const fineGridX = gridX * 4;
    const fineGridY = gridY * 4;
    const fineCells = 2 ** fineLevel * RENDER_SURFACE_SEGMENTS;
    const fineDirection = directionFromCubeFace(
      face,
      -1 + (fineGridX * 2) / fineCells,
      -1 + (fineGridY * 2) / fineCells,
    );
    const fine = sampleSurfaceHeightDetails(planet, seed, fineDirection, {
      sampleSpacingMeters: renderableGridSampleSpacingMeters(
        planet,
        fineLevel,
        fineGridX,
        fineGridY,
      ),
    });
    maximumError = Math.max(
      maximumError,
      Math.abs(coarse.heightMeters - fine.heightMeters),
    );
    assert.equal(coarse.riverStrength, fine.riverStrength);
    assert.equal(
      coarse.riverWaterLevelNormalized,
      fine.riverWaterLevelNormalized,
    );
  }
  assert.equal(maximumError, 0, 'canonical shared LOD vertices changed height');
  return maximumError;
}

function validateVisibleFrames(): number {
  const cells = 2 ** RENDER_SURFACE_LEVEL * RENDER_SURFACE_SEGMENTS;
  let maximumError = 0;
  for (let index = 0; index < 300; index += 1) {
    const face = CUBE_FACES[index % CUBE_FACES.length];
    const gridX = 1 + ((index * 8_191) % (cells - 2));
    const gridY = 1 + ((index * 4_093) % (cells - 2));
    const direction = directionFromCubeFace(
      face,
      -1 + (gridX * 2) / cells,
      -1 + (gridY * 2) / cells,
    );
    const analytic = sampleSurfaceHeightDetails(planet, seed, direction, {
      sampleSpacingMeters: renderableGridSampleSpacingMeters(
        planet,
        RENDER_SURFACE_LEVEL,
        gridX,
        gridY,
      ),
    });
    const frame = sampleVisibleSurfaceFrame(
      planet,
      seed,
      direction,
      RENDER_SURFACE_LEVEL,
    );
    maximumError = Math.max(
      maximumError,
      Math.abs(analytic.heightMeters - frame.heightMeters),
    );
    const analyticClimate = sampleSurfaceClimate(
      planet,
      seed,
      direction,
      analytic.heightMeters,
      analytic,
    );
    const visibleClimate = sampleSurfaceClimate(
      planet,
      seed,
      direction,
      frame.heightMeters,
      frame.heightDetails,
    );
    assert.equal(analyticClimate.biome, visibleClimate.biome);
  }
  assert.ok(maximumError < 1e-6, `visible frame height error was ${maximumError} m`);
  return maximumError;
}

function edgeContact(a: TileInfo, b: TileInfo): EdgeContact | null {
  if (a.face !== b.face) return null;
  const uOverlap = Math.min(a.bounds.u1, b.bounds.u1) - Math.max(a.bounds.u0, b.bounds.u0);
  const vOverlap = Math.min(a.bounds.v1, b.bounds.v1) - Math.max(a.bounds.v0, b.bounds.v0);
  if (Math.abs(a.bounds.u1 - b.bounds.u0) <= edgeEpsilon && vOverlap > edgeEpsilon) {
    return { axis: 'v', edgeA: 3, edgeB: 2 };
  }
  if (Math.abs(a.bounds.u0 - b.bounds.u1) <= edgeEpsilon && vOverlap > edgeEpsilon) {
    return { axis: 'v', edgeA: 2, edgeB: 3 };
  }
  if (Math.abs(a.bounds.v1 - b.bounds.v0) <= edgeEpsilon && uOverlap > edgeEpsilon) {
    return { axis: 'u', edgeA: 1, edgeB: 0 };
  }
  if (Math.abs(a.bounds.v0 - b.bounds.v1) <= edgeEpsilon && uOverlap > edgeEpsilon) {
    return { axis: 'u', edgeA: 0, edgeB: 1 };
  }
  return null;
}

function rawCubePoint(face: CubeFace, u: number, v: number): Vec3 {
  if (face === 'px') return { x: 1, y: v, z: -u };
  if (face === 'nx') return { x: -1, y: v, z: u };
  if (face === 'py') return { x: u, y: 1, z: -v };
  if (face === 'ny') return { x: u, y: -1, z: v };
  if (face === 'pz') return { x: u, y: v, z: 1 };
  return { x: -u, y: v, z: -1 };
}

function cubeBoundaryEdge(
  info: TileInfo,
  edge: number,
): CubeBoundaryEdge | null {
  const { u0, u1, v0, v1 } = info.bounds;
  const liesOnBoundary =
    (edge === 0 && Math.abs(v0 + 1) <= edgeEpsilon) ||
    (edge === 1 && Math.abs(v1 - 1) <= edgeEpsilon) ||
    (edge === 2 && Math.abs(u0 + 1) <= edgeEpsilon) ||
    (edge === 3 && Math.abs(u1 - 1) <= edgeEpsilon);
  if (!liesOnBoundary) return null;
  const start =
    edge === 0
      ? rawCubePoint(info.face, u0, v0)
      : edge === 1
        ? rawCubePoint(info.face, u0, v1)
        : edge === 2
          ? rawCubePoint(info.face, u0, v0)
          : rawCubePoint(info.face, u1, v0);
  const end =
    edge === 0
      ? rawCubePoint(info.face, u1, v0)
      : edge === 1
        ? rawCubePoint(info.face, u1, v1)
        : edge === 2
          ? rawCubePoint(info.face, u0, v1)
          : rawCubePoint(info.face, u1, v1);
  const axes = ['x', 'y', 'z'] as const;
  const fixed = axes.filter(
    (axis) =>
      Math.abs(start[axis] - end[axis]) <= edgeEpsilon &&
      Math.abs(Math.abs(start[axis]) - 1) <= edgeEpsilon,
  );
  assert.equal(fixed.length, 2);
  const variable = axes.find((axis) => !fixed.includes(axis));
  assert.ok(variable);
  const id = fixed
    .map((axis) => `${axis}${start[axis] > 0 ? '+' : '-'}`)
    .sort()
    .join(':');
  return {
    edge,
    id,
    parameterEnd: end[variable],
    parameterStart: start[variable],
  };
}

function cubeBoundaryEdges(info: TileInfo): CubeBoundaryEdge[] {
  const edges: CubeBoundaryEdge[] = [];
  for (let edge = 0; edge < 4; edge += 1) {
    const descriptor = cubeBoundaryEdge(info, edge);
    if (descriptor) edges.push(descriptor);
  }
  return edges;
}

function localPosition(buffers: TerrainTileBuffers, vertex: number): Vec3 {
  const offset = vertex * 3;
  return {
    x: buffers.positions[offset],
    y: buffers.positions[offset + 1],
    z: buffers.positions[offset + 2],
  };
}

function worldPosition(info: TileInfo, local: Vec3): Vec3 {
  return {
    x: info.centerPosition.x + local.x,
    y: info.centerPosition.y + local.y,
    z: info.centerPosition.z + local.z,
  };
}

function edgeTopPositions(
  info: TileInfo,
  buffers: TerrainTileBuffers,
  edge: number,
): Vec3[] {
  const firstVertex =
    TERRAIN_SURFACE_VERTEX_COUNT +
    edge * TILE_SEGMENTS * TERRAIN_SKIRT_VERTICES_PER_SEGMENT;
  const positions: Vec3[] = [];
  for (let segment = 0; segment < TILE_SEGMENTS; segment += 1) {
    positions.push(
      worldPosition(
        info,
        localPosition(
          buffers,
          firstVertex + segment * TERRAIN_SKIRT_VERTICES_PER_SEGMENT,
        ),
      ),
    );
  }
  const lastTriangleVertex =
    firstVertex +
    (TILE_SEGMENTS - 1) * TERRAIN_SKIRT_VERTICES_PER_SEGMENT;
  const lastCandidates = [1, 2].map((offset) =>
    worldPosition(info, localPosition(buffers, lastTriangleVertex + offset)),
  );
  lastCandidates.sort(
    (left, right) =>
      Math.hypot(right.x, right.y, right.z) - Math.hypot(left.x, left.y, left.z),
  );
  positions.push(lastCandidates[0]);
  return positions;
}

function edgeSkirtDepthMeters(
  info: TileInfo,
  buffers: TerrainTileBuffers,
  edge: number,
): number {
  const firstVertex =
    TERRAIN_SURFACE_VERTEX_COUNT +
    edge * TILE_SEGMENTS * TERRAIN_SKIRT_VERTICES_PER_SEGMENT;
  const top = worldPosition(info, localPosition(buffers, firstVertex));
  const topRadius = Math.hypot(top.x, top.y, top.z);
  const bottomCandidates = [4, 5].map((offset) =>
    worldPosition(info, localPosition(buffers, firstVertex + offset)),
  );
  bottomCandidates.sort((left, right) => {
    const leftRadius = Math.hypot(left.x, left.y, left.z);
    const rightRadius = Math.hypot(right.x, right.y, right.z);
    const leftFacing =
      (top.x * left.x + top.y * left.y + top.z * left.z) /
      Math.max(topRadius * leftRadius, 1e-9);
    const rightFacing =
      (top.x * right.x + top.y * right.y + top.z * right.z) /
      Math.max(topRadius * rightRadius, 1e-9);
    return rightFacing - leftFacing;
  });
  const bottom = bottomCandidates[0];
  return topRadius - Math.hypot(bottom.x, bottom.y, bottom.z);
}

function edgeSkirtNormalAtCoordinate(
  buffers: TerrainTileBuffers,
  location: EdgeSampleLocation,
): Vec3 {
  const {
    coordinate,
    edgeIndex,
    parameterEnd,
    parameterStart,
    sideOffset = 0,
  } = location;
  const scaled = Math.max(
    0,
    Math.min(
      TILE_SEGMENTS - 1e-9,
      ((coordinate - parameterStart) / (parameterEnd - parameterStart)) * TILE_SEGMENTS,
    ),
  );
  const segment = Math.floor(scaled);
  const vertex =
    TERRAIN_SURFACE_VERTEX_COUNT +
    (edgeIndex * TILE_SEGMENTS + segment) * TERRAIN_SKIRT_VERTICES_PER_SEGMENT +
    sideOffset;
  const offset = vertex * 3;
  return normalize({
    x: buffers.normals[offset],
    y: buffers.normals[offset + 1],
    z: buffers.normals[offset + 2],
  });
}

function edgePositionAtCoordinate(
  edge: Vec3[],
  parameterStart: number,
  parameterEnd: number,
  coordinate: number,
): Vec3 {
  const scaled = Math.max(
    0,
    Math.min(
      TILE_SEGMENTS,
      ((coordinate - parameterStart) / (parameterEnd - parameterStart)) * TILE_SEGMENTS,
    ),
  );
  const segment = Math.min(TILE_SEGMENTS - 1, Math.floor(scaled));
  const t = scaled - segment;
  const start = edge[segment];
  const end = edge[segment + 1];
  return {
    x: start.x + (end.x - start.x) * t,
    y: start.y + (end.y - start.y) * t,
    z: start.z + (end.z - start.z) * t,
  };
}

function dotVectors(left: Vec3, right: Vec3): number {
  return left.x * right.x + left.y * right.y + left.z * right.z;
}

function directionFromTo(from: Vec3, to: Vec3): Vec3 {
  return normalize({
    x: to.x - from.x,
    y: to.y - from.y,
    z: to.z - from.z,
  });
}

function pointDistance(left: Vec3, right: Vec3): number {
  return Math.hypot(left.x - right.x, left.y - right.y, left.z - right.z);
}

function meshTriangleSample(
  globalCellX: number,
  globalCellY: number,
  fractionU: number,
  fractionV: number,
): MeshTriangleSample {
  if (terrainCellUsesNorthwestSoutheastDiagonal(globalCellX, globalCellY)) {
    return fractionV <= fractionU
      ? {
          triangle: 0,
          weights: [1 - fractionU, fractionU - fractionV, fractionV],
        }
      : {
          triangle: 1,
          weights: [1 - fractionV, fractionU, fractionV - fractionU],
        };
  }
  return fractionU + fractionV <= 1
    ? {
        triangle: 0,
        weights: [1 - fractionU - fractionV, fractionU, fractionV],
      }
    : {
        triangle: 1,
        weights: [1 - fractionV, fractionU + fractionV - 1, 1 - fractionU],
      };
}

function meshTriangleVertices(
  info: TileInfo,
  buffers: TerrainTileBuffers,
  cellX: number,
  cellY: number,
  triangle: 0 | 1,
): readonly [Vec3, Vec3, Vec3] {
  const firstVertex =
    (cellY * TILE_SEGMENTS + cellX) * 6 + triangle * 3;
  return [0, 1, 2].map((offset) =>
    worldPosition(info, localPosition(buffers, firstVertex + offset)),
  ) as unknown as readonly [Vec3, Vec3, Vec3];
}

function weightedPoint(
  vertices: readonly [Vec3, Vec3, Vec3],
  weights: readonly [number, number, number],
): Vec3 {
  return {
    x:
      vertices[0].x * weights[0] +
      vertices[1].x * weights[1] +
      vertices[2].x * weights[2],
    y:
      vertices[0].y * weights[0] +
      vertices[1].y * weights[1] +
      vertices[2].y * weights[2],
    z:
      vertices[0].z * weights[0] +
      vertices[1].z * weights[1] +
      vertices[2].z * weights[2],
  };
}

function outwardTriangleNormal(
  vertices: readonly [Vec3, Vec3, Vec3],
  radialDirection: Vec3,
): Vec3 {
  const ab = directionFromTo(vertices[0], vertices[1]);
  const ac = directionFromTo(vertices[0], vertices[2]);
  let normal = normalize({
    x: ab.y * ac.z - ab.z * ac.y,
    y: ab.z * ac.x - ab.x * ac.z,
    z: ab.x * ac.y - ab.y * ac.x,
  });
  if (dotVectors(normal, radialDirection) < 0) {
    normal = { x: -normal.x, y: -normal.y, z: -normal.z };
  }
  return normal;
}

function validateMeshFootAgreement(selected: TileInfo[]): {
  maximumGroundHeightErrorMeters: number;
  maximumHeightErrorMeters: number;
  minimumGroundNormalDot: number;
} {
  const finest = selected.find((info) => info.level === RENDER_SURFACE_LEVEL);
  assert.ok(finest);
  const tiles = [2, 8, RENDER_SURFACE_LEVEL].map((level) => {
    const divisor = 2 ** (RENDER_SURFACE_LEVEL - level);
    return makeTileInfo(
      finest.face,
      level,
      Math.floor(finest.x / divisor),
      Math.floor(finest.y / divisor),
      planet,
    );
  });
  let maximumGroundHeightErrorMeters = 0;
  let maximumHeightErrorMeters = 0;
  let minimumGroundNormalDot = 1;

  for (const info of tiles) {
    const buffers = validationBuffersFor(info);
    for (let index = 0; index < 200; index += 1) {
      const cellX = (index * 7) % TILE_SEGMENTS;
      const cellY = (index * 13) % TILE_SEGMENTS;
      const fractionU = (((index * 37) % 97) + 0.25) / 97;
      const fractionV = (((index * 53) % 89) + 0.35) / 89;
      const globalCellX = info.x * TILE_SEGMENTS + cellX;
      const globalCellY = info.y * TILE_SEGMENTS + cellY;
      const sample = meshTriangleSample(
        globalCellX,
        globalCellY,
        fractionU,
        fractionV,
      );
      const vertices = meshTriangleVertices(
        info,
        buffers,
        cellX,
        cellY,
        sample.triangle,
      );
      const point = weightedPoint(vertices, sample.weights);
      const u =
        info.bounds.u0 +
        ((cellX + fractionU) / TILE_SEGMENTS) *
          (info.bounds.u1 - info.bounds.u0);
      const v =
        info.bounds.v0 +
        ((cellY + fractionV) / TILE_SEGMENTS) *
          (info.bounds.v1 - info.bounds.v0);
      const direction = directionFromCubeFace(info.face, u, v);
      const frame = sampleVisibleSurfaceFrame(planet, seed, direction, info.level);
      const meshHeight = dotVectors(point, direction) - planet.radiusMeters;
      const heightError = Math.abs(meshHeight - frame.heightMeters);
      maximumHeightErrorMeters = Math.max(maximumHeightErrorMeters, heightError);
      if (info.level !== RENDER_SURFACE_LEVEL) continue;
      maximumGroundHeightErrorMeters = Math.max(
        maximumGroundHeightErrorMeters,
        heightError,
      );
      minimumGroundNormalDot = Math.min(
        minimumGroundNormalDot,
        dotVectors(outwardTriangleNormal(vertices, direction), frame.normal),
      );
    }
  }

  assert.ok(
    maximumHeightErrorMeters < 0.5,
    `packed terrain mesh diverged from its sampler by ${maximumHeightErrorMeters} m`,
  );
  assert.ok(
    maximumGroundHeightErrorMeters < 0.001,
    `L${RENDER_SURFACE_LEVEL} mesh/foot error reached ${maximumGroundHeightErrorMeters} m`,
  );
  assert.ok(
    minimumGroundNormalDot > 0.999_999,
    `L${RENDER_SURFACE_LEVEL} mesh/foot normal dot fell to ${minimumGroundNormalDot}`,
  );
  return {
    maximumGroundHeightErrorMeters,
    maximumHeightErrorMeters,
    minimumGroundNormalDot,
  };
}

function sameBoundaryInterval(
  left: CubeBoundaryEdge,
  right: CubeBoundaryEdge,
): boolean {
  return (
    Math.abs(
      Math.min(left.parameterStart, left.parameterEnd) -
        Math.min(right.parameterStart, right.parameterEnd),
    ) <= edgeEpsilon &&
    Math.abs(
      Math.max(left.parameterStart, left.parameterEnd) -
        Math.max(right.parameterStart, right.parameterEnd),
    ) <= edgeEpsilon
  );
}

function sameLodBoundaryCandidates(
  level: number,
  alongValues: readonly number[],
): SameLodBoundaryCandidate[] {
  return CUBE_FACES.flatMap((face) =>
    [0, 1, 2, 3].flatMap((edgeIndex) =>
      alongValues.map((along) => {
        const info = makeBoundaryTile(face, edgeIndex, level, along);
        const descriptor = cubeBoundaryEdge(info, edgeIndex);
        assert.ok(descriptor);
        return { descriptor, edgeIndex, info };
      }),
    ),
  );
}

function validateSameLodSeams(): { contacts: number; maximumErrorMeters: number } {
  let contacts = 0;
  let maximumErrorMeters = 0;
  let maximumErrorContext = '';

  const compare = (comparison: SameLodSeamComparison): void => {
    const {
      left,
      leftEdgeIndex,
      leftParameterEnd,
      leftParameterStart,
      right,
      rightEdgeIndex,
      rightParameterEnd,
      rightParameterStart,
    } = comparison;
    contacts += 1;
    const leftEdge = edgeTopPositions(left, validationBuffersFor(left), leftEdgeIndex);
    const rightEdge = edgeTopPositions(right, validationBuffersFor(right), rightEdgeIndex);
    const overlapStart = Math.max(
      Math.min(leftParameterStart, leftParameterEnd),
      Math.min(rightParameterStart, rightParameterEnd),
    );
    const overlapEnd = Math.min(
      Math.max(leftParameterStart, leftParameterEnd),
      Math.max(rightParameterStart, rightParameterEnd),
    );
    assert.ok(overlapEnd > overlapStart);
    for (let index = 0; index <= TILE_SEGMENTS; index += 1) {
      const coordinate =
        overlapStart + (overlapEnd - overlapStart) * (index / TILE_SEGMENTS);
      const leftPoint = edgePositionAtCoordinate(
        leftEdge,
        leftParameterStart,
        leftParameterEnd,
        coordinate,
      );
      const rightPoint = edgePositionAtCoordinate(
        rightEdge,
        rightParameterStart,
        rightParameterEnd,
        coordinate,
      );
      const errorMeters = pointDistance(leftPoint, rightPoint);
      if (errorMeters <= maximumErrorMeters) continue;
      maximumErrorMeters = errorMeters;
      maximumErrorContext = [
        `${left.face} L${left.level} ${left.x},${left.y} e${leftEdgeIndex}`,
        `${right.face} L${right.level} ${right.x},${right.y} e${rightEdgeIndex}`,
        `vertex=${index}`,
      ].join(' / ');
    }
  };

  for (const level of [2, 8, RENDER_SURFACE_LEVEL]) {
    const tileCount = 2 ** level;
    const x = Math.max(0, Math.min(tileCount - 2, Math.floor(tileCount * 0.37)));
    const y = Math.max(0, Math.min(tileCount - 2, Math.floor(tileCount * 0.61)));
    for (const face of CUBE_FACES) {
      const tile = makeTileInfo(face, level, x, y, planet);
      const right = makeTileInfo(face, level, x + 1, y, planet);
      compare({
        left: tile,
        leftEdgeIndex: 3,
        leftParameterEnd: tile.bounds.v1,
        leftParameterStart: tile.bounds.v0,
        right,
        rightEdgeIndex: 2,
        rightParameterEnd: right.bounds.v1,
        rightParameterStart: right.bounds.v0,
      });
      const below = makeTileInfo(face, level, x, y + 1, planet);
      compare({
        left: tile,
        leftEdgeIndex: 1,
        leftParameterEnd: tile.bounds.u1,
        leftParameterStart: tile.bounds.u0,
        right: below,
        rightEdgeIndex: 0,
        rightParameterEnd: below.bounds.u1,
        rightParameterStart: below.bounds.u0,
      });
    }

    const along = Math.floor(tileCount * 0.37);
    const mirroredAlong = tileCount - 1 - along;
    const comparedCubeEdgeIds = new Set<string>();
    const candidates = sameLodBoundaryCandidates(level, [along, mirroredAlong]);
    for (let leftIndex = 0; leftIndex < candidates.length; leftIndex += 1) {
      for (let rightIndex = leftIndex + 1; rightIndex < candidates.length; rightIndex += 1) {
        const left = candidates[leftIndex];
        const right = candidates[rightIndex];
        if (left.info.face === right.info.face) continue;
        if (left.descriptor.id !== right.descriptor.id) continue;
        if (!sameBoundaryInterval(left.descriptor, right.descriptor)) continue;
        comparedCubeEdgeIds.add(left.descriptor.id);
        compare({
          left: left.info,
          leftEdgeIndex: left.edgeIndex,
          leftParameterEnd: left.descriptor.parameterEnd,
          leftParameterStart: left.descriptor.parameterStart,
          right: right.info,
          rightEdgeIndex: right.edgeIndex,
          rightParameterEnd: right.descriptor.parameterEnd,
          rightParameterStart: right.descriptor.parameterStart,
        });
      }
    }
    assert.equal(
      comparedCubeEdgeIds.size,
      12,
      `L${level} did not cover all cube edges`,
    );
  }

  assert.ok(
    maximumErrorMeters < 0.5,
    `same-LOD seam error reached ${maximumErrorMeters.toFixed(3)} m at ${maximumErrorContext}`,
  );
  return { contacts, maximumErrorMeters };
}

function makeBoundaryTile(
  face: CubeFace,
  edge: number,
  level: number,
  along: number,
): TileInfo {
  const last = 2 ** level - 1;
  if (edge === 0) return makeTileInfo(face, level, along, 0, planet);
  if (edge === 1) return makeTileInfo(face, level, along, last, planet);
  if (edge === 2) return makeTileInfo(face, level, 0, along, planet);
  return makeTileInfo(face, level, last, along, planet);
}

function interpolatedCoarseRadius(
  coarseEdge: Vec3[],
  parameterStart: number,
  parameterEnd: number,
  coordinate: number,
): number {
  const point = edgePositionAtCoordinate(
    coarseEdge,
    parameterStart,
    parameterEnd,
    coordinate,
  );
  return Math.hypot(point.x, point.y, point.z);
}

function validateMixedLodSkirts(selected: TileInfo[]): {
  contacts: number;
  maximumRatio: number;
  minimumFrontFacingDot: number;
} {
  let contacts = 0;
  let maximumRatio = 0;
  let maximumRatioContext = '';
  let minimumFrontFacingDot = 1;
  const measureContact = (input: MeasuredEdgeContact): void => {
    const {
      coarse,
      coarseEdgeIndex,
      coarseParameterEnd,
      coarseParameterStart,
      fine,
      fineEdgeIndex,
      fineParameterEnd,
      fineParameterStart,
    } = input;
    contacts += 1;
    const fineBuffers = validationBuffersFor(fine);
    const coarseBuffers = validationBuffersFor(coarse);
    const fineEdge = edgeTopPositions(fine, fineBuffers, fineEdgeIndex);
    const coarseEdge = edgeTopPositions(coarse, coarseBuffers, coarseEdgeIndex);
    const fineDepth = edgeSkirtDepthMeters(fine, fineBuffers, fineEdgeIndex);
    const coarseDepth = edgeSkirtDepthMeters(coarse, coarseBuffers, coarseEdgeIndex);
    const overlapStart = Math.max(
      Math.min(fineParameterStart, fineParameterEnd),
      Math.min(coarseParameterStart, coarseParameterEnd),
    );
    const overlapEnd = Math.min(
      Math.max(fineParameterStart, fineParameterEnd),
      Math.max(coarseParameterStart, coarseParameterEnd),
    );
    assert.ok(overlapEnd > overlapStart, 'measured seam edges did not overlap');
    const midpointCoordinate = (overlapStart + overlapEnd) * 0.5;
    const fineMidpoint = edgePositionAtCoordinate(
      fineEdge,
      fineParameterStart,
      fineParameterEnd,
      midpointCoordinate,
    );
    const coarseMidpoint = edgePositionAtCoordinate(
      coarseEdge,
      coarseParameterStart,
      coarseParameterEnd,
      midpointCoordinate,
    );
    const fineIsCovering =
      Math.hypot(fineMidpoint.x, fineMidpoint.y, fineMidpoint.z) >=
      Math.hypot(coarseMidpoint.x, coarseMidpoint.y, coarseMidpoint.z);
    const coveringBuffers = fineIsCovering ? fineBuffers : coarseBuffers;
    const coveringEdgeIndex = fineIsCovering ? fineEdgeIndex : coarseEdgeIndex;
    const coveringParameterStart = fineIsCovering
      ? fineParameterStart
      : coarseParameterStart;
    const coveringParameterEnd = fineIsCovering ? fineParameterEnd : coarseParameterEnd;
    const coveringMidpoint = fineIsCovering ? fineMidpoint : coarseMidpoint;
    const outwardNormal = edgeSkirtNormalAtCoordinate(
      coveringBuffers,
      {
        coordinate: midpointCoordinate,
        edgeIndex: coveringEdgeIndex,
        parameterEnd: coveringParameterEnd,
        parameterStart: coveringParameterStart,
      },
    );
    const inwardNormal = edgeSkirtNormalAtCoordinate(
      coveringBuffers,
      {
        coordinate: midpointCoordinate,
        edgeIndex: coveringEdgeIndex,
        parameterEnd: coveringParameterEnd,
        parameterStart: coveringParameterStart,
        sideOffset: 6,
      },
    );
    assert.ok(
      dotVectors(outwardNormal, inwardNormal) < -0.999,
      'paired skirt faces were not oppositely wound',
    );
    const cameraRadius =
      planet.radiusMeters + planet.terrainAmplitudeMeters + 2_000;
    for (const viewerTile of [fine, coarse]) {
      const camera = scaleDirection(viewerTile.centerDirection, cameraRadius);
      const viewDirection = directionFromTo(coveringMidpoint, camera);
      const frontFacingDot = Math.max(
        dotVectors(outwardNormal, viewDirection),
        dotVectors(inwardNormal, viewDirection),
      );
      minimumFrontFacingDot = Math.min(minimumFrontFacingDot, frontFacingDot);
    }

    for (let index = 0; index < fineEdge.length; index += 1) {
      const coordinate =
        fineParameterStart +
        (fineParameterEnd - fineParameterStart) * (index / TILE_SEGMENTS);
      const finePoint = fineEdge[index];
      const fineRadius = Math.hypot(finePoint.x, finePoint.y, finePoint.z);
      const coarseRadius = interpolatedCoarseRadius(
        coarseEdge,
        coarseParameterStart,
        coarseParameterEnd,
        coordinate,
      );
      const gap = Math.abs(fineRadius - coarseRadius);
      const coveringDepth = fineRadius >= coarseRadius ? fineDepth : coarseDepth;
      const ratio = gap / Math.max(coveringDepth, 1e-9);
      if (ratio > maximumRatio) {
        maximumRatio = ratio;
        maximumRatioContext = [
          `${fine.face} L${fine.level} ${fine.x},${fine.y}`,
          `${coarse.face} L${coarse.level} ${coarse.x},${coarse.y}`,
          `gap=${gap.toFixed(2)}m`,
          `depth=${coveringDepth.toFixed(2)}m`,
          `edge=${fineEdgeIndex}/${coarseEdgeIndex}`,
          `vertex=${index}`,
        ].join(' ');
      }
    }
  };

  const measureCrossFaceContacts = (fine: TileInfo, coarse: TileInfo): void => {
    const fineBoundaryEdges = cubeBoundaryEdges(fine);
    const coarseBoundaryEdges = cubeBoundaryEdges(coarse);
    for (const fineEdge of fineBoundaryEdges) {
      for (const coarseEdge of coarseBoundaryEdges) {
        if (fineEdge.id !== coarseEdge.id) continue;
        const overlap =
          Math.min(
            Math.max(fineEdge.parameterStart, fineEdge.parameterEnd),
            Math.max(coarseEdge.parameterStart, coarseEdge.parameterEnd),
          ) -
          Math.max(
            Math.min(fineEdge.parameterStart, fineEdge.parameterEnd),
            Math.min(coarseEdge.parameterStart, coarseEdge.parameterEnd),
          );
        if (overlap <= edgeEpsilon) continue;
        measureContact({
          coarse,
          coarseEdgeIndex: coarseEdge.edge,
          coarseParameterEnd: coarseEdge.parameterEnd,
          coarseParameterStart: coarseEdge.parameterStart,
          fine,
          fineEdgeIndex: fineEdge.edge,
          fineParameterEnd: fineEdge.parameterEnd,
          fineParameterStart: fineEdge.parameterStart,
        });
      }
    }
  };

  for (let leftIndex = 0; leftIndex < selected.length; leftIndex += 1) {
    for (let rightIndex = leftIndex + 1; rightIndex < selected.length; rightIndex += 1) {
      const left = selected[leftIndex];
      const right = selected[rightIndex];
      if (left.level === right.level) continue;
      const fineIsLeft = left.level > right.level;
      const fine = fineIsLeft ? left : right;
      const coarse = fineIsLeft ? right : left;
      const contact = edgeContact(left, right);
      if (contact) {
        const axis = contact.axis;
        measureContact({
          coarse,
          coarseEdgeIndex: fineIsLeft ? contact.edgeB : contact.edgeA,
          coarseParameterEnd: axis === 'u' ? coarse.bounds.u1 : coarse.bounds.v1,
          coarseParameterStart: axis === 'u' ? coarse.bounds.u0 : coarse.bounds.v0,
          fine,
          fineEdgeIndex: fineIsLeft ? contact.edgeA : contact.edgeB,
          fineParameterEnd: axis === 'u' ? fine.bounds.u1 : fine.bounds.v1,
          fineParameterStart: axis === 'u' ? fine.bounds.u0 : fine.bounds.v0,
        });
        continue;
      }
      if (left.face === right.face) continue;
      measureCrossFaceContacts(fine, coarse);
    }
  }
  assert.ok(contacts > 0, 'representative selection had no mixed-LOD edge contacts');
  assert.ok(
    maximumRatio <= 1,
    `mixed-LOD displacement exceeded skirt depth (${maximumRatio.toFixed(3)}x: ${maximumRatioContext})`,
  );
  assert.ok(
    minimumFrontFacingDot > 1e-6,
    `covering skirt became edge-on from both adjacent tile views (${minimumFrontFacingDot})`,
  );
  return { contacts, maximumRatio, minimumFrontFacingDot };
}

function validateTerrainTile(
  selected: TileInfo[],
): { finestTriangleSpanMeters: number } {
  const finest = selected
    .filter((info) => info.level === RENDER_SURFACE_LEVEL)
    .sort((left, right) => left.spanMeters - right.spanMeters)[0];
  assert.ok(finest, `ground selection never reached L${RENDER_SURFACE_LEVEL}`);
  const buffers = buildTerrainTileBuffers(finest, planet, seed);
  assert.ok(isValidTerrainTileBuffers(buffers));
  for (
    let offset = TERRAIN_SURFACE_VERTEX_COUNT * 3;
    offset < buffers.normals.length;
    offset += 3
  ) {
    assert.notDeepEqual(
      [buffers.normals[offset], buffers.normals[offset + 1], buffers.normals[offset + 2]],
      [0, 0, 0],
    );
  }
  const finestTriangleSpanMeters = finest.spanMeters / TILE_SEGMENTS;
  assert.ok(
    finestTriangleSpanMeters < 6,
    `finest triangle span remained ${finestTriangleSpanMeters.toFixed(2)} m`,
  );
  return { finestTriangleSpanMeters };
}

function main(): TerrainValidationSummary {
  const representativeDirection = normalize({ x: 1, y: 0.13, z: -0.22 });
  const representativeBody = bodyPositionAt(representativeDirection, 2);
  selectedTilesForBody(representativeBody, 2);
  const selectionStart = performance.now();
  let selected: TileInfo[] = [];
  for (let run = 0; run < 100; run += 1) {
    selected = selectedTilesForBody(representativeBody, 2);
  }
  const selectionMilliseconds = (performance.now() - selectionStart) / 100;
  // The corrected L16/900 m baseline selects 229 tiles at this probe. L17/450 m
  // should stay in the same envelope while halving triangle span.
  assert.ok(selected.length <= 320, `ground selection expanded to ${selected.length} tiles`);
  assert.equal(
    Math.max(...selected.map((info) => info.level)),
    RENDER_SURFACE_LEVEL,
  );
  const finestSelectedTiles = selected.filter(
    (info) => info.level === RENDER_SURFACE_LEVEL,
  ).length;
  assert.ok(
    finestSelectedTiles <= 200,
    `ground selection expanded to ${finestSelectedTiles} finest tiles`,
  );

  const fallbackCoverage = validateFallbackCoverage(selected);
  const horizonTileCounts = validateHorizonCoverage();
  const highlandGroundDetail = validateHighlandGroundDetail();
  const sharedVertexHeightErrorMeters = validateCanonicalSharedVertices();
  const maxVisibleFrameHeightErrorMeters = validateVisibleFrames();
  const meshFootAgreement = validateMeshFootAgreement(selected);
  const sameLodSeams = validateSameLodSeams();
  const hydrology = getRiverNetworkDiagnostics(planet, seed);
  assert.ok(hydrology.routes > 0);
  assert.ok(hydrology.confluences > 0);
  assert.equal(hydrology.centerlineSamplesBeyondCarveDepth, 0);
  assert.ok(hydrology.maximumWaterRiseNormalized <= Number.EPSILON);
  const seamSelections = [
    selected,
    selectedTilesAt({ x: -0.37, y: 0.91, z: 0.18 }, 2),
    selectedTilesAt({ x: 0.22, y: -0.31, z: -1 }, 2),
    selectedTilesAt({ x: 1, y: 0.2, z: 1 }, 2),
  ];
  let contacts = 0;
  let maximumRatio = 0;
  let minimumFrontFacingDot = 1;
  for (const seamSelection of seamSelections) {
    const result = validateMixedLodSkirts(seamSelection);
    contacts += result.contacts;
    maximumRatio = Math.max(maximumRatio, result.maximumRatio);
    minimumFrontFacingDot = Math.min(
      minimumFrontFacingDot,
      result.minimumFrontFacingDot,
    );
  }
  const { finestTriangleSpanMeters } = validateTerrainTile(selected);

  return {
    coldCacheFallbackLevel: fallbackCoverage.coldCacheFallbackLevel,
    fallbackChainMinimumLevel: fallbackCoverage.fallbackChainMinimumLevel,
    finestSelectedTiles,
    finestTriangleSpanMeters,
    highlandProbeHeightMeters: highlandGroundDetail.heightMeters,
    highlandSelectedLevel: highlandGroundDetail.selectedLevel,
    highlandSelectedTiles: highlandGroundDetail.selectedTiles,
    horizonTileCounts,
    hydrology,
    maxGroundMeshFootHeightErrorMeters:
      meshFootAgreement.maximumGroundHeightErrorMeters,
    maxMeshFootHeightErrorMeters: meshFootAgreement.maximumHeightErrorMeters,
    maxMixedLodGapToSkirtRatio: maximumRatio,
    maxSameLodSeamErrorMeters: sameLodSeams.maximumErrorMeters,
    maxVisibleFrameHeightErrorMeters,
    minimumSkirtFrontFacingDot: minimumFrontFacingDot,
    minimumGroundMeshFootNormalDot: meshFootAgreement.minimumGroundNormalDot,
    mixedLodContacts: contacts,
    pinnedFallbackRoots: fallbackCoverage.pinnedFallbackRoots,
    sameLodSeamContacts: sameLodSeams.contacts,
    selectedTiles: selected.length,
    selectionMilliseconds,
    sharedVertexHeightErrorMeters,
  };
}

console.log(JSON.stringify(main(), null, 2));
