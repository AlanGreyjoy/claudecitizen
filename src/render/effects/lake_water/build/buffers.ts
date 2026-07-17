import type { LakeWaterBuffers, Planet, PlanetSurfaceSample, TileInfo, Vec3 } from '../../../../types';
import { distance, scale } from '../../../../math/vec3';
import { directionFromCubeFace } from '../../../../world/cube_sphere';
import { terrainCellUsesNorthwestSoutheastDiagonal } from '../../../../world/terrain_triangulation';
import {
  RENDER_SURFACE_SEGMENTS,
  samplePlanetSurface,
} from '../../../../world/planet_surface';

const TILE_SEGMENTS = RENDER_SURFACE_SEGMENTS;
const SHORE_PADDING_METERS = 28;
// Shore foam is a near-surface detail. At coarse flight/orbital LODs one grid
// cell can cover kilometres, so a cell-based foam ribbon becomes a giant white
// polygon. Fade the effect in metres and omit unresolved partial shore cells.
const WATER_EFFECT_FULL_CELL_SPAN_METERS = 100;
const WATER_EFFECT_MAX_CELL_SPAN_METERS = 700;
const WATER_FACET_PALETTE = [
  [0x16, 0x55, 0x78],
  [0x1a, 0x60, 0x82],
  [0x20, 0x6b, 0x8d],
  [0x26, 0x76, 0x97],
  [0x2d, 0x81, 0xa1],
] as const;

interface GridCell {
  depthMeters: number;
  direction: Vec3;
  padded: boolean;
  radius: number | null;
  shore: number;
  surface: PlanetSurfaceSample;
}

interface WaterSurfaceCell {
  depthMeters: number;
  direction: Vec3;
  radius: number;
  shore: number;
}

interface FacetedWaterSource {
  depths: number[];
  indices: number[];
  positions: number[];
  shoreFactors: number[];
}

function clamp01(value: number): number {
  return Math.max(0, Math.min(1, value));
}

function smoothstep(edge0: number, edge1: number, value: number): number {
  const t = clamp01((value - edge0) / Math.max(edge1 - edge0, 1e-6));
  return t * t * (3 - 2 * t);
}

function shoreFactorForDepth(depthMeters: number): number {
  return 1 - smoothstep(0.75, 6, Math.abs(depthMeters));
}

function nearestDryGridDistance(
  grid: GridCell[],
  gridWidth: number,
  x: number,
  y: number,
): number {
  const searchRadius = 2;
  let nearest = Number.POSITIVE_INFINITY;

  for (let dy = -searchRadius; dy <= searchRadius; dy += 1) {
    const neighborY = y + dy;
    if (neighborY < 0 || neighborY >= gridWidth) continue;
    for (let dx = -searchRadius; dx <= searchRadius; dx += 1) {
      const neighborX = x + dx;
      if (neighborX < 0 || neighborX >= gridWidth || (dx === 0 && dy === 0)) continue;
      if (grid[neighborY * gridWidth + neighborX].padded) continue;
      nearest = Math.min(nearest, Math.hypot(dx, dy));
    }
  }

  return nearest;
}

function markGridShoreline(grid: GridCell[], gridWidth: number): void {
  for (let y = 0; y < gridWidth; y += 1) {
    for (let x = 0; x < gridWidth; x += 1) {
      const cell = grid[y * gridWidth + x];
      if (!cell.padded) continue;
      const nearestDryCell = nearestDryGridDistance(grid, gridWidth, x, y);
      const topologyShore = clamp01((2.5 - nearestDryCell) / 1.5);
      cell.shore = Math.max(cell.shore, topologyShore);
    }
  }
}

function packFacetedWaterBuffers(
  info: TileInfo,
  seed: number,
  source: FacetedWaterSource,
): LakeWaterBuffers {
  const { depths, indices, positions, shoreFactors } = source;
  const facetedPositions = new Float32Array(indices.length * 3);
  const barycentrics = new Uint8Array(indices.length * 3);
  const colors = new Uint8Array(indices.length * 3);
  const effectDetails = new Uint8Array(indices.length);
  const normals = new Int16Array(indices.length * 3);
  const shores = new Uint8Array(indices.length);
  const waterDepths = new Float32Array(indices.length);
  const cellSpanMeters = info.spanMeters / TILE_SEGMENTS;
  const effectDetail =
    1 - smoothstep(
      WATER_EFFECT_FULL_CELL_SPAN_METERS,
      WATER_EFFECT_MAX_CELL_SPAN_METERS,
      cellSpanMeters,
    );
  const packedEffectDetail = Math.round(effectDetail * 255);

  for (let facetIndex = 0; facetIndex < indices.length / 3; facetIndex += 1) {
    const color = WATER_FACET_PALETTE[facetPaletteIndex(info, seed, facetIndex)];
    const sourceA = indices[facetIndex * 3];
    const sourceB = indices[facetIndex * 3 + 1];
    const sourceC = indices[facetIndex * 3 + 2];
    const aOffset = sourceA * 3;
    const bOffset = sourceB * 3;
    const cOffset = sourceC * 3;
    const abX = positions[bOffset] - positions[aOffset];
    const abY = positions[bOffset + 1] - positions[aOffset + 1];
    const abZ = positions[bOffset + 2] - positions[aOffset + 2];
    const acX = positions[cOffset] - positions[aOffset];
    const acY = positions[cOffset + 1] - positions[aOffset + 1];
    const acZ = positions[cOffset + 2] - positions[aOffset + 2];
    const normalX = abY * acZ - abZ * acY;
    const normalY = abZ * acX - abX * acZ;
    const normalZ = abX * acY - abY * acX;
    const inverseNormalLength = 1 / Math.max(Math.hypot(normalX, normalY, normalZ), 1e-9);
    const packedNormalX = Math.round(normalX * inverseNormalLength * 32_767);
    const packedNormalY = Math.round(normalY * inverseNormalLength * 32_767);
    const packedNormalZ = Math.round(normalZ * inverseNormalLength * 32_767);
    for (let corner = 0; corner < 3; corner += 1) {
      const outputVertex = facetIndex * 3 + corner;
      const sourceVertex = indices[outputVertex];
      const outputOffset = outputVertex * 3;
      const sourceOffset = sourceVertex * 3;
      facetedPositions[outputOffset] = positions[sourceOffset];
      facetedPositions[outputOffset + 1] = positions[sourceOffset + 1];
      facetedPositions[outputOffset + 2] = positions[sourceOffset + 2];
      barycentrics[outputOffset + corner] = 255;
      colors[outputOffset] = color[0];
      colors[outputOffset + 1] = color[1];
      colors[outputOffset + 2] = color[2];
      effectDetails[outputVertex] = packedEffectDetail;
      normals[outputOffset] = packedNormalX;
      normals[outputOffset + 1] = packedNormalY;
      normals[outputOffset + 2] = packedNormalZ;
      shores[outputVertex] = Math.round(clamp01(shoreFactors[sourceVertex]) * 255);
      waterDepths[outputVertex] = depths[sourceVertex];
    }
  }

  return {
    barycentrics,
    colors,
    effectDetails,
    normals,
    positions: facetedPositions,
    shores,
    waterDepths,
  };
}

function cubeFaceCode(face: TileInfo['face']): number {
  if (face === 'px') return 0;
  if (face === 'nx') return 1;
  if (face === 'py') return 2;
  if (face === 'ny') return 3;
  if (face === 'pz') return 4;
  return 5;
}

function facetPaletteIndex(info: TileInfo, seed: number, facetIndex: number): number {
  let hash = seed | 0;
  hash = Math.imul(hash ^ (cubeFaceCode(info.face) + 1), 0x45d9f3b);
  hash = Math.imul(hash ^ (info.level + 1), 0x45d9f3b);
  hash = Math.imul(hash ^ info.x, 0x45d9f3b);
  hash = Math.imul(hash ^ info.y, 0x45d9f3b);
  hash = Math.imul(hash ^ facetIndex, 0x45d9f3b);
  hash ^= hash >>> 16;
  return (hash >>> 0) % WATER_FACET_PALETTE.length;
}

function isShorePadded(surface: PlanetSurfaceSample): boolean {
  return (
    surface.lakeWaterLevelMeters != null &&
    surface.heightMeters < surface.lakeWaterLevelMeters + SHORE_PADDING_METERS
  );
}

function tileBounds(level: number, x: number, y: number) {
  const tileCount = 2 ** level;
  const step = 2 / tileCount;
  const u0 = -1 + x * step;
  const v0 = -1 + y * step;
  return {
    u0,
    u1: u0 + step,
    v0,
    v1: v0 + step,
  };
}

export function makeLakeWaterTileInfo(
  face: TileInfo['face'],
  level: number,
  x: number,
  y: number,
  planet: Planet,
): TileInfo {
  const bounds = tileBounds(level, x, y);
  const centerDirection = directionFromCubeFace(
    face,
    (bounds.u0 + bounds.u1) * 0.5,
    (bounds.v0 + bounds.v1) * 0.5,
  );
  const cornerA = scale(directionFromCubeFace(face, bounds.u0, bounds.v0), planet.radiusMeters);
  const cornerB = scale(directionFromCubeFace(face, bounds.u1, bounds.v1), planet.radiusMeters);
  const centerPosition = scale(centerDirection, planet.radiusMeters);
  return {
    bounds,
    centerDirection,
    centerPosition,
    face,
    level,
    spanMeters: distance(cornerA, cornerB),
    x,
    y,
  };
}

function tileKey(face: TileInfo['face'], level: number, x: number, y: number): string {
  return `${face}:${level}:${x}:${y}`;
}

function inFaceNeighborTileInfos(info: TileInfo, planet: Planet): TileInfo[] {
  const tileCount = 2 ** info.level;
  const neighbors: TileInfo[] = [];
  const deltas: [number, number][] = [
    [-1, 0],
    [1, 0],
    [0, -1],
    [0, 1],
  ];

  for (const [dx, dy] of deltas) {
    const nx = info.x + dx;
    const ny = info.y + dy;
    if (nx < 0 || ny < 0 || nx >= tileCount || ny >= tileCount) continue;
    neighbors.push(makeLakeWaterTileInfo(info.face, info.level, nx, ny, planet));
  }

  return neighbors;
}

export function tileHasLakeWater(info: TileInfo, planet: Planet, seed: number): boolean {
  const { u0, u1, v0, v1 } = info.bounds;
  const stride = Math.max(1, Math.floor(TILE_SEGMENTS / 6));

  for (let iy = 0; iy <= TILE_SEGMENTS; iy += stride) {
    const v = v0 + ((v1 - v0) * iy) / TILE_SEGMENTS;
    for (let ix = 0; ix <= TILE_SEGMENTS; ix += stride) {
      const u = u0 + ((u1 - u0) * ix) / TILE_SEGMENTS;
      const direction = directionFromCubeFace(info.face, u, v);
      const surface = samplePlanetSurface(planet, seed, scale(direction, planet.radiusMeters));
      if (isShorePadded(surface)) return true;
    }
  }

  return false;
}

export function expandLakeWaterTiles(
  selectedTiles: TileInfo[],
  planet: Planet,
  seed: number,
): TileInfo[] {
  const expanded = new Map<string, TileInfo>();

  for (const info of selectedTiles) {
    expanded.set(tileKey(info.face, info.level, info.x, info.y), info);
  }

  for (const info of selectedTiles) {
    if (!tileHasLakeWater(info, planet, seed)) continue;

    for (const neighbor of inFaceNeighborTileInfos(info, planet)) {
      const key = tileKey(neighbor.face, neighbor.level, neighbor.x, neighbor.y);
      if (!expanded.has(key)) expanded.set(key, neighbor);
    }
  }

  return [...expanded.values()];
}

function sampleGridCell(
  info: TileInfo,
  planet: Planet,
  seed: number,
  u: number,
  v: number,
): GridCell {
  const direction = directionFromCubeFace(info.face, u, v);
  const samplePos = scale(direction, planet.radiusMeters);
  const surface = samplePlanetSurface(planet, seed, samplePos);
  const padded = isShorePadded(surface);
  const depthMeters =
    surface.lakeWaterLevelMeters == null
      ? -SHORE_PADDING_METERS
      : surface.lakeWaterLevelMeters - surface.heightMeters;

  return {
    depthMeters,
    direction,
    padded,
    radius: padded ? planet.radiusMeters + surface.lakeWaterLevelMeters! : null,
    shore: surface.lakeWaterLevelMeters == null ? 0 : shoreFactorForDepth(depthMeters),
    surface,
  };
}

function waterSurfaceCellFromLevel(
  cell: GridCell,
  waterLevelMeters: number,
  planetRef: Planet,
): WaterSurfaceCell {
  const depthMeters = waterLevelMeters - cell.surface.heightMeters;
  return {
    depthMeters,
    direction: cell.direction,
    radius: planetRef.radiusMeters + waterLevelMeters,
    shore: Math.max(cell.padded ? cell.shore : 1, shoreFactorForDepth(depthMeters)),
  };
}

export function buildLakeWaterGeometry(
  info: TileInfo,
  planetRef: Planet,
  seed: number,
): LakeWaterBuffers | null {
  const { u0, u1, v0, v1 } = info.bounds;
  const gridWidth = TILE_SEGMENTS + 1;
  const cellSpanMeters = info.spanMeters / TILE_SEGMENTS;
  const renderPartialShoreCells = cellSpanMeters < WATER_EFFECT_MAX_CELL_SPAN_METERS;
  const grid: GridCell[] = new Array(gridWidth * gridWidth);
  let paddedVertices = 0;

  for (let iy = 0; iy <= TILE_SEGMENTS; iy += 1) {
    const v = v0 + ((v1 - v0) * iy) / TILE_SEGMENTS;
    for (let ix = 0; ix <= TILE_SEGMENTS; ix += 1) {
      const u = u0 + ((u1 - u0) * ix) / TILE_SEGMENTS;
      const cell = sampleGridCell(info, planetRef, seed, u, v);
      if (cell.padded) paddedVertices += 1;
      grid[iy * gridWidth + ix] = cell;
    }
  }

  if (paddedVertices < 3) return null;
  if (renderPartialShoreCells) markGridShoreline(grid, gridWidth);

  const positions: number[] = [];
  const depths: number[] = [];
  const shoreFactors: number[] = [];
  const indices: number[] = [];
  const indexLookup = new Int32Array(grid.length);
  indexLookup.fill(-1);
  const extraIndexLookup = new Map<string, number>();

  function emitVertex(cell: GridCell | WaterSurfaceCell): number {
    depths.push(cell.depthMeters);
    positions.push(
      cell.direction.x * cell.radius! - info.centerPosition.x,
      cell.direction.y * cell.radius! - info.centerPosition.y,
      cell.direction.z * cell.radius! - info.centerPosition.z,
    );
    shoreFactors.push(cell.shore);
    return positions.length / 3 - 1;
  }

  function vertexIndexForCell(x: number, y: number): number {
    const gridIdx = y * gridWidth + x;
    const cell = grid[gridIdx];
    if (!cell.padded) return -1;
    if (indexLookup[gridIdx] === -1) {
      indexLookup[gridIdx] = emitVertex(cell);
    }
    return indexLookup[gridIdx];
  }

  function vertexIndexForExtra(key: string, cell: WaterSurfaceCell): number {
    if (!extraIndexLookup.has(key)) {
      extraIndexLookup.set(key, emitVertex(cell));
    }
    return extraIndexLookup.get(key)!;
  }

  function cornerIndex(x: number, y: number): number {
    return y * gridWidth + x;
  }

  function addTriangle(a: number, b: number, c: number): void {
    if (a < 0 || b < 0 || c < 0) return;
    indices.push(a, b, c);
  }

  for (let y = 0; y < TILE_SEGMENTS; y += 1) {
    for (let x = 0; x < TILE_SEGMENTS; x += 1) {
      const cornerCoords: [number, number][] = [
        [x, y],
        [x + 1, y],
        [x + 1, y + 1],
        [x, y + 1],
      ];
      const corners = cornerCoords.map(([cx, cy]) => grid[cornerIndex(cx, cy)]);

      if (!corners.some((corner) => corner.padded)) continue;
      const allCornersPadded = corners.every((corner) => corner.padded);
      if (!allCornersPadded && !renderPartialShoreCells) continue;

      const cornerIndices = cornerCoords.map(([cx, cy]) => vertexIndexForCell(cx, cy));
      const centerU = u0 + ((u1 - u0) * (x + 0.5)) / TILE_SEGMENTS;
      const centerV = v0 + ((v1 - v0) * (y + 0.5)) / TILE_SEGMENTS;
      const centerSample = sampleGridCell(info, planetRef, seed, centerU, centerV);
      const waterLevelMeters =
        centerSample.surface.lakeWaterLevelMeters ??
        corners.find((corner) => corner.padded)?.surface.lakeWaterLevelMeters;

      if (waterLevelMeters == null) continue;

      if (allCornersPadded) {
        const globalCellX = info.x * TILE_SEGMENTS + x;
        const globalCellY = info.y * TILE_SEGMENTS + y;
        if (terrainCellUsesNorthwestSoutheastDiagonal(globalCellX, globalCellY)) {
          addTriangle(cornerIndices[0], cornerIndices[1], cornerIndices[2]);
          addTriangle(cornerIndices[0], cornerIndices[2], cornerIndices[3]);
        } else {
          addTriangle(cornerIndices[0], cornerIndices[1], cornerIndices[3]);
          addTriangle(cornerIndices[1], cornerIndices[2], cornerIndices[3]);
        }
        continue;
      }

      const centerCell = waterSurfaceCellFromLevel(centerSample, waterLevelMeters, planetRef);
      const centerIndex = vertexIndexForExtra(`center:${x}:${y}`, centerCell);

      for (let i = 0; i < 4; i += 1) {
        const a = cornerIndices[i];
        const b = cornerIndices[(i + 1) % 4];
        if (a >= 0 && b >= 0) addTriangle(a, b, centerIndex);
      }
    }
  }

  if (indices.length === 0) return null;
  return packFacetedWaterBuffers(info, seed, { depths, indices, positions, shoreFactors });
}
