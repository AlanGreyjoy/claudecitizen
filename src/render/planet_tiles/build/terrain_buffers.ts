import type { Biome, CubeFace, Planet, PlanetSurfaceSample, TerrainTileBuffers, TileInfo } from '../../../types';
import { scale } from '../../../math/vec3';
import { directionFromCubeFace } from '../../../world/cube_sphere';
import { sampleRenderablePlanetSurface } from '../../../world/planet_surface';
import { terrainCellUsesNorthwestSoutheastDiagonal } from '../../../world/terrain_triangulation';
import { TILE_SEGMENTS } from '../domain/constants';

type RgbColor = [number, number, number];

// The palette is deliberately compact and texture-free. Lighting and the
// triangle normals provide the fine variation; biome, height, and slope only
// choose broad art-directed color families.
const OCEAN_DEEP_COLOR = hexToRgb(0x173653);
const OCEAN_SHALLOW_COLOR = hexToRgb(0x3f7898);
const LAKE_BED_COLOR = hexToRgb(0x53665a);
const RIVER_BED_COLOR = hexToRgb(0x776f50);
const BEACH_COLOR = hexToRgb(0xd8c58e);
const DESERT_COLOR = hexToRgb(0xc89b62);
const PLAINS_COLOR = hexToRgb(0x719447);
const FOREST_COLOR = hexToRgb(0x3e6c42);
const TUNDRA_COLOR = hexToRgb(0x9eaa91);
const ALPINE_COLOR = hexToRgb(0x7f895f);
const ROCK_COLOR = hexToRgb(0x737887);
const SNOW_COLOR = hexToRgb(0xe7e6dc);
const scratchColor: RgbColor = [0, 0, 0];

interface TerrainGrid {
  colors: Float32Array;
  positions: Float32Array;
  rockAffinity: Float32Array;
  width: number;
}

interface FacetIdentity {
  cellX: number;
  cellY: number;
  face: CubeFace;
  level: number;
  triangle: number;
}

interface TriangleWriteContext {
  buffers: TerrainTileBuffers;
  grid: TerrainGrid;
  info: TileInfo;
  seed: number;
}

const NORTHWEST_SOUTHEAST_TRIANGLES = [0, 1, 3, 0, 3, 2] as const;
const NORTHEAST_SOUTHWEST_TRIANGLES = [0, 1, 2, 1, 3, 2] as const;

function hexToRgb(hex: number): RgbColor {
  return [
    ((hex >> 16) & 255) / 255,
    ((hex >> 8) & 255) / 255,
    (hex & 255) / 255,
  ];
}

function clamp01(value: number): number {
  return Math.max(0, Math.min(1, value));
}

function smoothstep(edge0: number, edge1: number, value: number): number {
  const t = clamp01((value - edge0) / Math.max(edge1 - edge0, 1e-6));
  return t * t * (3 - 2 * t);
}

function copyColor(target: RgbColor, source: RgbColor): void {
  target[0] = source[0];
  target[1] = source[1];
  target[2] = source[2];
}

function lerpColor(target: RgbColor, start: RgbColor, end: RgbColor, t: number): void {
  target[0] = start[0] + (end[0] - start[0]) * t;
  target[1] = start[1] + (end[1] - start[1]) * t;
  target[2] = start[2] + (end[2] - start[2]) * t;
}

function blendColor(target: RgbColor, end: RgbColor, t: number): void {
  target[0] += (end[0] - target[0]) * t;
  target[1] += (end[1] - target[1]) * t;
  target[2] += (end[2] - target[2]) * t;
}

function writeSurfaceBaseColor(
  surface: PlanetSurfaceSample,
  colors: Float32Array,
  offset: number,
): void {
  if (surface.biome === 'ocean') {
    const depth = clamp01(surface.normalizedHeight + 1);
    lerpColor(scratchColor, OCEAN_DEEP_COLOR, OCEAN_SHALLOW_COLOR, depth);
  } else if (surface.biome === 'lake') {
    copyColor(scratchColor, LAKE_BED_COLOR);
  } else if (surface.biome === 'river') {
    copyColor(scratchColor, RIVER_BED_COLOR);
  } else if (surface.biome === 'beach') {
    copyColor(scratchColor, BEACH_COLOR);
  } else if (surface.biome === 'forest') {
    copyColor(scratchColor, FOREST_COLOR);
  } else if (surface.biome === 'plains') {
    copyColor(scratchColor, PLAINS_COLOR);
  } else if (surface.biome === 'desert') {
    copyColor(scratchColor, DESERT_COLOR);
  } else if (surface.biome === 'tundra') {
    copyColor(scratchColor, TUNDRA_COLOR);
  } else if (surface.biome === 'highlands') {
    copyColor(scratchColor, ALPINE_COLOR);
    blendColor(
      scratchColor,
      ROCK_COLOR,
      smoothstep(0.42, 0.68, surface.normalizedHeight) * 0.88,
    );
    blendColor(scratchColor, SNOW_COLOR, smoothstep(0.68, 0.92, surface.normalizedHeight));
  } else if (surface.biome === 'peak') {
    lerpColor(
      scratchColor,
      ROCK_COLOR,
      SNOW_COLOR,
      smoothstep(0.52, 0.78, surface.normalizedHeight),
    );
  } else {
    copyColor(scratchColor, ROCK_COLOR);
  }

  colors[offset] = scratchColor[0];
  colors[offset + 1] = scratchColor[1];
  colors[offset + 2] = scratchColor[2];
}

function rockAffinityForBiome(biome: Biome): number {
  if (biome === 'ocean' || biome === 'lake' || biome === 'river') return 0;
  if (biome === 'beach') return 0.12;
  if (biome === 'highlands' || biome === 'peak' || biome === 'rock') return 1;
  if (biome === 'desert') return 0.82;
  return 0.68;
}

function cubeFaceCode(face: CubeFace): number {
  if (face === 'px') return 0;
  if (face === 'nx') return 1;
  if (face === 'py') return 2;
  if (face === 'ny') return 3;
  if (face === 'pz') return 4;
  return 5;
}

function facetVariation(identity: FacetIdentity, seed: number): number {
  const { cellX, cellY, face, level, triangle } = identity;
  let hash = seed | 0;
  hash = Math.imul(hash ^ (cubeFaceCode(face) + 1), 0x45d9f3b);
  hash = Math.imul(hash ^ (level + 1), 0x45d9f3b);
  hash = Math.imul(hash ^ cellX, 0x45d9f3b);
  hash = Math.imul(hash ^ cellY, 0x45d9f3b);
  hash = Math.imul(hash ^ triangle, 0x45d9f3b);
  hash ^= hash >>> 16;
  return (hash >>> 0) / 0xffffffff;
}

function writeTriangle(
  context: TriangleWriteContext,
  vertices: readonly [number, number, number],
  identity: FacetIdentity,
  outputVertex: number,
): number {
  const { buffers, grid, info, seed } = context;
  const { colors, normals, positions } = buffers;
  const { colors: gridColors, positions: gridPositions } = grid;
  const [ia, ib, ic] = vertices;
  const ax = gridPositions[ia * 3];
  const ay = gridPositions[ia * 3 + 1];
  const az = gridPositions[ia * 3 + 2];
  const bx = gridPositions[ib * 3];
  const by = gridPositions[ib * 3 + 1];
  const bz = gridPositions[ib * 3 + 2];
  const cx = gridPositions[ic * 3];
  const cy = gridPositions[ic * 3 + 1];
  const cz = gridPositions[ic * 3 + 2];

  const abx = bx - ax;
  const aby = by - ay;
  const abz = bz - az;
  const acx = cx - ax;
  const acy = cy - ay;
  const acz = cz - az;
  let nx = aby * acz - abz * acy;
  let ny = abz * acx - abx * acz;
  let nz = abx * acy - aby * acx;
  const normalLength = Math.max(Math.hypot(nx, ny, nz), 1e-9);
  nx /= normalLength;
  ny /= normalLength;
  nz /= normalLength;

  const worldCenterX = info.centerPosition.x + (ax + bx + cx) / 3;
  const worldCenterY = info.centerPosition.y + (ay + by + cy) / 3;
  const worldCenterZ = info.centerPosition.z + (az + bz + cz) / 3;
  const worldCenterLength = Math.max(
    Math.hypot(worldCenterX, worldCenterY, worldCenterZ),
    1e-9,
  );
  const upX = worldCenterX / worldCenterLength;
  const upY = worldCenterY / worldCenterLength;
  const upZ = worldCenterZ / worldCenterLength;

  // The authored triangle order is outward-facing on every cube face. Keep a
  // defensive correction here because an inverted normal would turn a facet
  // black even though the surface itself remains valid.
  if (nx * upX + ny * upY + nz * upZ < 0) {
    nx *= -1;
    ny *= -1;
    nz *= -1;
  }

  scratchColor[0] =
    (gridColors[ia * 3] + gridColors[ib * 3] + gridColors[ic * 3]) / 3;
  scratchColor[1] =
    (gridColors[ia * 3 + 1] + gridColors[ib * 3 + 1] + gridColors[ic * 3 + 1]) / 3;
  scratchColor[2] =
    (gridColors[ia * 3 + 2] + gridColors[ib * 3 + 2] + gridColors[ic * 3 + 2]) / 3;

  const upwardness = clamp01(nx * upX + ny * upY + nz * upZ);
  const rockAffinity =
    (grid.rockAffinity[ia] + grid.rockAffinity[ib] + grid.rockAffinity[ic]) / 3;
  const exposedRock = smoothstep(0.08, 0.34, 1 - upwardness) * rockAffinity;
  blendColor(scratchColor, ROCK_COLOR, exposedRock * 0.82);

  // A restrained deterministic value shift makes adjacent facets readable in
  // diffuse light without adding noisy textures. Quantization keeps the final
  // palette graphic rather than gradient-heavy.
  const variation = 0.94 + facetVariation(identity, seed) * 0.12;
  scratchColor[0] = Math.round(clamp01(scratchColor[0] * variation) * 32) / 32;
  scratchColor[1] = Math.round(clamp01(scratchColor[1] * variation) * 32) / 32;
  scratchColor[2] = Math.round(clamp01(scratchColor[2] * variation) * 32) / 32;

  const triangleVertices = vertices;
  for (let localVertex = 0; localVertex < 3; localVertex += 1) {
    const sourceVertex = triangleVertices[localVertex];
    const sourceOffset = sourceVertex * 3;
    const outputOffset = (outputVertex + localVertex) * 3;
    positions[outputOffset] = gridPositions[sourceOffset];
    positions[outputOffset + 1] = gridPositions[sourceOffset + 1];
    positions[outputOffset + 2] = gridPositions[sourceOffset + 2];
    colors[outputOffset] = Math.round(scratchColor[0] * 255);
    colors[outputOffset + 1] = Math.round(scratchColor[1] * 255);
    colors[outputOffset + 2] = Math.round(scratchColor[2] * 255);
    normals[outputOffset] = Math.round(nx * 32767);
    normals[outputOffset + 1] = Math.round(ny * 32767);
    normals[outputOffset + 2] = Math.round(nz * 32767);
  }

  return outputVertex + 3;
}

function buildTerrainGrid(
  info: TileInfo,
  planet: Planet,
  seed: number,
): TerrainGrid {
  const { u0, u1, v0, v1 } = info.bounds;
  const gridWidth = TILE_SEGMENTS + 1;
  const gridVertexCount = gridWidth * gridWidth;
  const positions = new Float32Array(gridVertexCount * 3);
  const colors = new Float32Array(gridVertexCount * 3);
  const rockAffinity = new Float32Array(gridVertexCount);
  let gridVertex = 0;

  for (let iy = 0; iy <= TILE_SEGMENTS; iy += 1) {
    const v = v0 + ((v1 - v0) * iy) / TILE_SEGMENTS;
    for (let ix = 0; ix <= TILE_SEGMENTS; ix += 1) {
      const u = u0 + ((u1 - u0) * ix) / TILE_SEGMENTS;
      const direction = directionFromCubeFace(info.face, u, v);
      const samplePosition = scale(direction, planet.radiusMeters);
      const surface = sampleRenderablePlanetSurface(planet, seed, samplePosition);
      const renderSurface: PlanetSurfaceSample =
        surface.lakeWaterLevelMeters != null &&
        surface.heightMeters < surface.lakeWaterLevelMeters - 0.5
          ? {
              ...surface,
              biome: (surface.riverWaterLevelMeters != null ? 'river' : 'lake') as Biome,
            }
          : surface;
      const offset = gridVertex * 3;

      positions[offset] =
        direction.x * surface.surfaceRadiusMeters - info.centerPosition.x;
      positions[offset + 1] =
        direction.y * surface.surfaceRadiusMeters - info.centerPosition.y;
      positions[offset + 2] =
        direction.z * surface.surfaceRadiusMeters - info.centerPosition.z;
      writeSurfaceBaseColor(renderSurface, colors, offset);
      rockAffinity[gridVertex] = rockAffinityForBiome(renderSurface.biome);
      gridVertex += 1;
    }
  }

  return { colors, positions, rockAffinity, width: gridWidth };
}

function triangulateTerrainGrid(grid: TerrainGrid, info: TileInfo, seed: number): TerrainTileBuffers {
  const triangleVertexCount = TILE_SEGMENTS * TILE_SEGMENTS * 6;
  const buffers: TerrainTileBuffers = {
    colors: new Uint8Array(triangleVertexCount * 3),
    normals: new Int16Array(triangleVertexCount * 3),
    positions: new Float32Array(triangleVertexCount * 3),
  };
  const context = { buffers, grid, info, seed };
  let outputVertex = 0;

  for (let y = 0; y < TILE_SEGMENTS; y += 1) {
    for (let x = 0; x < TILE_SEGMENTS; x += 1) {
      const northwest = y * grid.width + x;
      const northeast = northwest + 1;
      const southwest = northwest + grid.width;
      const southeast = southwest + 1;
      const globalCellX = info.x * TILE_SEGMENTS + x;
      const globalCellY = info.y * TILE_SEGMENTS + y;
      const corners = [northwest, northeast, southwest, southeast] as const;
      const pattern = terrainCellUsesNorthwestSoutheastDiagonal(globalCellX, globalCellY)
        ? NORTHWEST_SOUTHEAST_TRIANGLES
        : NORTHEAST_SOUTHWEST_TRIANGLES;

      for (let triangle = 0; triangle < 2; triangle += 1) {
        const patternOffset = triangle * 3;
        outputVertex = writeTriangle(
          context,
          [
            corners[pattern[patternOffset]],
            corners[pattern[patternOffset + 1]],
            corners[pattern[patternOffset + 2]],
          ],
          {
            cellX: globalCellX,
            cellY: globalCellY,
            face: info.face,
            level: info.level,
            triangle,
          },
          outputVertex,
        );
      }
    }
  }

  return buffers;
}

export function buildTerrainTileBuffers(
  info: TileInfo,
  planet: Planet,
  seed: number,
): TerrainTileBuffers {
  return triangulateTerrainGrid(buildTerrainGrid(info, planet, seed), info, seed);
}
