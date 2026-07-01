import type { LakeWaterBuffers, Planet, PlanetSurfaceSample, TileInfo, Vec3 } from '../types';
import { distance, scale } from '../math/vec3';
import { directionFromCubeFace } from '../world/cube_sphere';
import {
  RENDER_SURFACE_SEGMENTS,
  samplePlanetSurface,
} from '../world/planet_surface';

const TILE_SEGMENTS = RENDER_SURFACE_SEGMENTS;
const SHORE_PADDING_METERS = 28;

interface GridCell {
  direction: Vec3;
  padded: boolean;
  radius: number | null;
  surface: PlanetSurfaceSample;
  u: number;
  underwater: boolean;
  v: number;
}

interface WaterSurfaceCell {
  direction: Vec3;
  padded: boolean;
  radius: number;
  u: number;
  v: number;
}

function isUnderwater(surface: PlanetSurfaceSample): boolean {
  return (
    surface.lakeWaterLevelMeters != null &&
    surface.heightMeters < surface.lakeWaterLevelMeters - 0.5
  );
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

  return {
    direction,
    padded,
    radius: padded ? planet.radiusMeters + surface.lakeWaterLevelMeters! : null,
    surface,
    u: (u - info.bounds.u0) / (info.bounds.u1 - info.bounds.u0),
    underwater: isUnderwater(surface),
    v: (v - info.bounds.v0) / (info.bounds.v1 - info.bounds.v0),
  };
}

function waterSurfaceCellFromLevel(
  cell: GridCell,
  waterLevelMeters: number,
  planetRef: Planet,
): WaterSurfaceCell {
  return {
    direction: cell.direction,
    padded: true,
    radius: planetRef.radiusMeters + waterLevelMeters,
    u: cell.u,
    v: cell.v,
  };
}

export function buildLakeWaterGeometry(
  info: TileInfo,
  planetRef: Planet,
  seed: number,
): LakeWaterBuffers | null {
  const { u0, u1, v0, v1 } = info.bounds;
  const gridWidth = TILE_SEGMENTS + 1;
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

  const positions: number[] = [];
  const uvs: number[] = [];
  const indices: number[] = [];
  const indexLookup = new Int32Array(grid.length);
  indexLookup.fill(-1);
  const extraIndexLookup = new Map<string, number>();

  function emitVertex(cell: GridCell | WaterSurfaceCell): number {
    positions.push(
      cell.direction.x * cell.radius! - info.centerPosition.x,
      cell.direction.y * cell.radius! - info.centerPosition.y,
      cell.direction.z * cell.radius! - info.centerPosition.z,
    );
    uvs.push(cell.u, cell.v);
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

      const cornerIndices = cornerCoords.map(([cx, cy]) => vertexIndexForCell(cx, cy));
      const centerU = u0 + ((u1 - u0) * (x + 0.5)) / TILE_SEGMENTS;
      const centerV = v0 + ((v1 - v0) * (y + 0.5)) / TILE_SEGMENTS;
      const centerSample = sampleGridCell(info, planetRef, seed, centerU, centerV);
      const waterLevelMeters =
        centerSample.surface.lakeWaterLevelMeters ??
        corners.find((corner) => corner.padded)?.surface.lakeWaterLevelMeters;

      if (waterLevelMeters == null) continue;

      if (corners.every((corner) => corner.padded)) {
        addTriangle(cornerIndices[0], cornerIndices[1], cornerIndices[3]);
        addTriangle(cornerIndices[1], cornerIndices[2], cornerIndices[3]);
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

  return {
    indices: new Uint32Array(indices),
    positions: new Float32Array(positions),
    uvs: new Float32Array(uvs),
  };
}
