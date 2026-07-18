import type {
  Biome,
  CubeFace,
  Planet,
  PlanetSurfaceSample,
  TerrainTileBuffers,
  TileInfo,
  Vec3,
} from '../../../types';
import { scale } from '../../../math/vec3';
import { directionFromCubeFace } from '../../../world/cube_sphere';
import { getActivePlanetConfig } from '../../../world/planets/runtime';
import { sampleAnalyticPlanetSurface } from '../../../world/planet_surface';
import { renderableGridSampleSpacingMeters } from '../../../world/renderable_surface';
import { terrainCellUsesNorthwestSoutheastDiagonal } from '../../../world/terrain_triangulation';
import { TERRAIN_TILE_VERTEX_COUNT, TILE_SEGMENTS } from '../domain/constants';

type RgbColor = [number, number, number];

const scratchColor: RgbColor = [0, 0, 0];
const oceanDeepColor: RgbColor = [0, 0, 0];
const oceanShallowColor: RgbColor = [0, 0, 0];
const lakeBedColor: RgbColor = [0, 0, 0];
const riverBedColor: RgbColor = [0, 0, 0];
const beachColor: RgbColor = [0, 0, 0];
const desertColor: RgbColor = [0, 0, 0];
const plainsColor: RgbColor = [0, 0, 0];
const forestColor: RgbColor = [0, 0, 0];
const tundraColor: RgbColor = [0, 0, 0];
const alpineColor: RgbColor = [0, 0, 0];
const rockColor: RgbColor = [0, 0, 0];
const snowColor: RgbColor = [0, 0, 0];

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
const TERRAIN_SKIRT_DEPTH_FACTOR = 0.75;
const TERRAIN_SKIRT_MIN_AMPLITUDE_RATIO = 0.12;
const TERRAIN_SKIRT_MAX_AMPLITUDE_RATIO = 0.75;

function hexStringToRgb(hex: string, target: RgbColor): void {
  const normalized = hex.startsWith('#') ? hex.slice(1) : hex;
  const value = Number.parseInt(normalized, 16);
  target[0] = ((value >> 16) & 255) / 255;
  target[1] = ((value >> 8) & 255) / 255;
  target[2] = (value & 255) / 255;
}

function refreshPaletteColors(): void {
  const { oceanShallow, palette } = getActivePlanetConfig();
  hexStringToRgb(palette.ocean, oceanDeepColor);
  hexStringToRgb(oceanShallow, oceanShallowColor);
  hexStringToRgb(palette.lake, lakeBedColor);
  hexStringToRgb(palette.river, riverBedColor);
  hexStringToRgb(palette.beach, beachColor);
  hexStringToRgb(palette.desert, desertColor);
  hexStringToRgb(palette.plains, plainsColor);
  hexStringToRgb(palette.forest, forestColor);
  hexStringToRgb(palette.tundra, tundraColor);
  hexStringToRgb(palette.highlands, alpineColor);
  hexStringToRgb(palette.rock, rockColor);
  hexStringToRgb(palette.peak, snowColor);
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
    lerpColor(scratchColor, oceanDeepColor, oceanShallowColor, depth);
  } else if (surface.biome === 'lake') {
    copyColor(scratchColor, lakeBedColor);
  } else if (surface.biome === 'river') {
    copyColor(scratchColor, riverBedColor);
  } else if (surface.biome === 'beach') {
    copyColor(scratchColor, beachColor);
  } else if (surface.biome === 'forest') {
    copyColor(scratchColor, forestColor);
  } else if (surface.biome === 'plains') {
    copyColor(scratchColor, plainsColor);
  } else if (surface.biome === 'desert') {
    copyColor(scratchColor, desertColor);
  } else if (surface.biome === 'tundra') {
    copyColor(scratchColor, tundraColor);
  } else if (surface.biome === 'highlands') {
    copyColor(scratchColor, alpineColor);
    blendColor(
      scratchColor,
      rockColor,
      smoothstep(0.42, 0.68, surface.normalizedHeight) * 0.88,
    );
    blendColor(scratchColor, snowColor, smoothstep(0.68, 0.92, surface.normalizedHeight));
  } else if (surface.biome === 'peak') {
    lerpColor(
      scratchColor,
      rockColor,
      snowColor,
      smoothstep(0.52, 0.78, surface.normalizedHeight),
    );
  } else {
    copyColor(scratchColor, rockColor);
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
  blendColor(scratchColor, rockColor, exposedRock * 0.82);

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

function terrainSkirtDepthMeters(info: TileInfo, planet: Planet): number {
  const cellSpanMeters = info.spanMeters / TILE_SEGMENTS;
  const minimumDepthMeters = Math.max(
    16,
    planet.terrainAmplitudeMeters * TERRAIN_SKIRT_MIN_AMPLITUDE_RATIO,
  );
  const maximumDepthMeters = Math.max(
    500,
    planet.terrainAmplitudeMeters * TERRAIN_SKIRT_MAX_AMPLITUDE_RATIO,
  );
  return Math.max(
    minimumDepthMeters,
    Math.min(maximumDepthMeters, cellSpanMeters * TERRAIN_SKIRT_DEPTH_FACTOR),
  );
}

function terrainGridPosition(grid: TerrainGrid, index: number): Vec3 {
  const offset = index * 3;
  return {
    x: grid.positions[offset],
    y: grid.positions[offset + 1],
    z: grid.positions[offset + 2],
  };
}

function extrudeSkirtVertex(
  vertex: Vec3,
  info: TileInfo,
  depthMeters: number,
): Vec3 {
  const worldX = info.centerPosition.x + vertex.x;
  const worldY = info.centerPosition.y + vertex.y;
  const worldZ = info.centerPosition.z + vertex.z;
  const inverseLength = 1 / Math.max(Math.hypot(worldX, worldY, worldZ), 1e-9);
  return {
    x: vertex.x - worldX * inverseLength * depthMeters,
    y: vertex.y - worldY * inverseLength * depthMeters,
    z: vertex.z - worldZ * inverseLength * depthMeters,
  };
}

function writeSkirtTriangle(
  buffers: TerrainTileBuffers,
  vertices: readonly [Vec3, Vec3, Vec3],
  outward: Vec3,
  color: readonly [number, number, number],
  outputVertex: number,
): number {
  const a = vertices[0];
  let b = vertices[1];
  let c = vertices[2];
  const abx = b.x - a.x;
  const aby = b.y - a.y;
  const abz = b.z - a.z;
  const acx = c.x - a.x;
  const acy = c.y - a.y;
  const acz = c.z - a.z;
  let nx = aby * acz - abz * acy;
  let ny = abz * acx - abx * acz;
  let nz = abx * acy - aby * acx;
  const inverseNormalLength = 1 / Math.max(Math.hypot(nx, ny, nz), 1e-9);
  nx *= inverseNormalLength;
  ny *= inverseNormalLength;
  nz *= inverseNormalLength;

  if (nx * outward.x + ny * outward.y + nz * outward.z < 0) {
    [b, c] = [c, b];
    nx *= -1;
    ny *= -1;
    nz *= -1;
  }

  const orientedVertices = [a, b, c];
  for (let localVertex = 0; localVertex < 3; localVertex += 1) {
    const vertex = orientedVertices[localVertex];
    const outputOffset = (outputVertex + localVertex) * 3;
    buffers.positions[outputOffset] = vertex.x;
    buffers.positions[outputOffset + 1] = vertex.y;
    buffers.positions[outputOffset + 2] = vertex.z;
    buffers.colors[outputOffset] = color[0];
    buffers.colors[outputOffset + 1] = color[1];
    buffers.colors[outputOffset + 2] = color[2];
    buffers.normals[outputOffset] = Math.round(nx * 32767);
    buffers.normals[outputOffset + 1] = Math.round(ny * 32767);
    buffers.normals[outputOffset + 2] = Math.round(nz * 32767);
  }
  return outputVertex + 3;
}

function appendTerrainSkirts(
  buffers: TerrainTileBuffers,
  grid: TerrainGrid,
  info: TileInfo,
  planet: Planet,
  outputVertex: number,
): number {
  const edgeIndices = [
    Array.from({ length: grid.width }, (_, index) => index),
    Array.from(
      { length: grid.width },
      (_, index) => TILE_SEGMENTS * grid.width + index,
    ),
    Array.from({ length: grid.width }, (_, index) => index * grid.width),
    Array.from(
      { length: grid.width },
      (_, index) => index * grid.width + TILE_SEGMENTS,
    ),
  ];
  const depthMeters = terrainSkirtDepthMeters(info, planet);

  for (const edge of edgeIndices) {
    for (let segment = 0; segment < TILE_SEGMENTS; segment += 1) {
      const indexA = edge[segment];
      const indexB = edge[segment + 1];
      const topA = terrainGridPosition(grid, indexA);
      const topB = terrainGridPosition(grid, indexB);
      const bottomA = extrudeSkirtVertex(topA, info, depthMeters);
      const bottomB = extrudeSkirtVertex(topB, info, depthMeters);
      const worldMidX = info.centerPosition.x + (topA.x + topB.x) * 0.5;
      const worldMidY = info.centerPosition.y + (topA.y + topB.y) * 0.5;
      const worldMidZ = info.centerPosition.z + (topA.z + topB.z) * 0.5;
      const inverseWorldMidLength =
        1 / Math.max(Math.hypot(worldMidX, worldMidY, worldMidZ), 1e-9);
      const edgeDirection = {
        x: worldMidX * inverseWorldMidLength,
        y: worldMidY * inverseWorldMidLength,
        z: worldMidZ * inverseWorldMidLength,
      };
      const centerFacing =
        edgeDirection.x * info.centerDirection.x +
        edgeDirection.y * info.centerDirection.y +
        edgeDirection.z * info.centerDirection.z;
      const outwardRaw = {
        x: edgeDirection.x * centerFacing - info.centerDirection.x,
        y: edgeDirection.y * centerFacing - info.centerDirection.y,
        z: edgeDirection.z * centerFacing - info.centerDirection.z,
      };
      const inverseOutwardLength =
        1 / Math.max(Math.hypot(outwardRaw.x, outwardRaw.y, outwardRaw.z), 1e-9);
      const outward = {
        x: outwardRaw.x * inverseOutwardLength,
        y: outwardRaw.y * inverseOutwardLength,
        z: outwardRaw.z * inverseOutwardLength,
      };
      const inward = {
        x: -outward.x,
        y: -outward.y,
        z: -outward.z,
      };
      const colorAOffset = indexA * 3;
      const colorBOffset = indexB * 3;
      const color = [
        Math.round(
          clamp01((grid.colors[colorAOffset] + grid.colors[colorBOffset]) * 0.36) * 255,
        ),
        Math.round(
          clamp01((grid.colors[colorAOffset + 1] + grid.colors[colorBOffset + 1]) * 0.36) *
            255,
        ),
        Math.round(
          clamp01((grid.colors[colorAOffset + 2] + grid.colors[colorBOffset + 2]) * 0.36) *
            255,
        ),
      ] as const;

      outputVertex = writeSkirtTriangle(
        buffers,
        [topA, topB, bottomB],
        outward,
        color,
        outputVertex,
      );
      outputVertex = writeSkirtTriangle(
        buffers,
        [topA, bottomB, bottomA],
        outward,
        color,
        outputVertex,
      );
      outputVertex = writeSkirtTriangle(
        buffers,
        [topA, topB, bottomB],
        inward,
        color,
        outputVertex,
      );
      outputVertex = writeSkirtTriangle(
        buffers,
        [topA, bottomB, bottomA],
        inward,
        color,
        outputVertex,
      );
    }
  }

  return outputVertex;
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
      // Every vertex in this tile uses one uniform LOD band limit. The
      // visible-frame sampler would fetch four heights to reconstruct a normal
      // that this builder discards before calculating flat facet normals, so
      // sample the analytic height once here.
      const surface = sampleAnalyticPlanetSurface(planet, seed, samplePosition, {
        sampleSpacingMeters: renderableGridSampleSpacingMeters(planet, info.level),
      });
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

function triangulateTerrainGrid(
  grid: TerrainGrid,
  info: TileInfo,
  planet: Planet,
  seed: number,
): TerrainTileBuffers {
  const buffers: TerrainTileBuffers = {
    colors: new Uint8Array(TERRAIN_TILE_VERTEX_COUNT * 3),
    normals: new Int16Array(TERRAIN_TILE_VERTEX_COUNT * 3),
    positions: new Float32Array(TERRAIN_TILE_VERTEX_COUNT * 3),
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

  const finalVertex = appendTerrainSkirts(buffers, grid, info, planet, outputVertex);
  if (finalVertex !== TERRAIN_TILE_VERTEX_COUNT) {
    throw new Error(
      `Terrain tile vertex layout mismatch: wrote ${finalVertex}, expected ${TERRAIN_TILE_VERTEX_COUNT}.`,
    );
  }
  return buffers;
}

export function buildTerrainTileBuffers(
  info: TileInfo,
  planet: Planet,
  seed: number,
): TerrainTileBuffers {
  refreshPaletteColors();
  return triangulateTerrainGrid(buildTerrainGrid(info, planet, seed), info, planet, seed);
}
