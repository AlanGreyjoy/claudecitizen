import type { Biome, Planet, PlanetSurfaceSample, TerrainTileBuffers, TileInfo } from '../../../types';
import { scale } from '../../../math/vec3';
import { directionFromCubeFace } from '../../../world/cube_sphere';
import { sampleRenderablePlanetSurface } from '../../../world/planet_surface';
import { TILE_SEGMENTS } from '../domain/constants';
import {
  TERRAIN_TEXTURE_LAYER_COUNT,
  TERRAIN_TEXTURE_REPEAT_METERS,
  TerrainTextureLayer,
  terrainTextureLayerForBiome,
} from '../domain/texture_layers';
const OCEAN_DEEP_COLOR = hexToRgb(0x0e2542);
const OCEAN_SHALLOW_COLOR = hexToRgb(0x28639e);
const LAKE_BED_COLOR = hexToRgb(0x5f6f52);
const RIVER_BED_COLOR = hexToRgb(0x6b6f54);
const BEACH_COLOR = hexToRgb(0xd6c697);
const DESERT_COLOR = hexToRgb(0xc2b280);
const PLAINS_COLOR = hexToRgb(0x608038);
const FOREST_COLOR = hexToRgb(0x2d5a27);
const TUNDRA_COLOR = hexToRgb(0xaabcb8);
const HIGHLAND_COLOR = hexToRgb(0x8a7e66);
const ROCK_COLOR = hexToRgb(0x7f725f);
const PEAK_COLOR = hexToRgb(0xffffff);
const scratchColor: [number, number, number] = [0, 0, 0];

type RgbColor = [number, number, number];

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

function writeSurfaceColor(surface: PlanetSurfaceSample, colors: Float32Array, offset: number): void {
  if (surface.biome === 'ocean') {
    const depth = clamp01(surface.normalizedHeight + 1.0);
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
    copyColor(scratchColor, HIGHLAND_COLOR);
  } else if (surface.biome === 'peak') {
    copyColor(scratchColor, PEAK_COLOR);
  } else {
    copyColor(scratchColor, ROCK_COLOR);
  }

  // Only mountain biomes fade toward rock/snow with height; plains and
  // forests keep their colors even at moderate elevation.
  if (surface.biome === 'highlands' || surface.biome === 'peak') {
    if (surface.normalizedHeight > 0.6) {
      blendColor(scratchColor, PEAK_COLOR, clamp01((surface.normalizedHeight - 0.6) / 0.4));
    } else if (surface.normalizedHeight > 0.4) {
      blendColor(
        scratchColor,
        HIGHLAND_COLOR,
        clamp01((surface.normalizedHeight - 0.4) / 0.2),
      );
    }
  }

  colors[offset] = scratchColor[0];
  colors[offset + 1] = scratchColor[1];
  colors[offset + 2] = scratchColor[2];
}

const scratchWeights = new Float32Array(TERRAIN_TEXTURE_LAYER_COUNT);

function writeSurfaceWeights(
  surface: PlanetSurfaceSample,
  weights0: Float32Array,
  weights1: Float32Array,
  vertexIndex: number,
): void {
  scratchWeights.fill(0);
  scratchWeights[terrainTextureLayerForBiome(surface.biome)] = 1;

  // Mirror the height-based color blending so texture layers transition to
  // rock and snow toward highlands and peaks.
  if (surface.biome === 'highlands' || surface.biome === 'peak') {
    let blendLayer: TerrainTextureLayer | null = null;
    let blend = 0;
    if (surface.normalizedHeight > 0.6) {
      blendLayer = TerrainTextureLayer.Snow;
      blend = clamp01((surface.normalizedHeight - 0.6) / 0.4);
    } else if (surface.normalizedHeight > 0.4) {
      blendLayer = TerrainTextureLayer.Rock;
      blend = clamp01((surface.normalizedHeight - 0.4) / 0.2);
    }
    if (blendLayer != null && blend > 0) {
      for (let i = 0; i < TERRAIN_TEXTURE_LAYER_COUNT; i += 1) {
        scratchWeights[i] *= 1 - blend;
      }
      scratchWeights[blendLayer] += blend;
    }
  }

  const offset = vertexIndex * 4;
  weights0[offset] = scratchWeights[0];
  weights0[offset + 1] = scratchWeights[1];
  weights0[offset + 2] = scratchWeights[2];
  weights0[offset + 3] = scratchWeights[3];
  weights1[offset] = scratchWeights[4];
  weights1[offset + 1] = scratchWeights[5];
  weights1[offset + 2] = scratchWeights[6];
  weights1[offset + 3] = scratchWeights[7];
}

function accumulateTriangleNormal(
  positions: Float32Array,
  normals: Float32Array,
  ia: number,
  ib: number,
  ic: number,
): void {
  const ax = positions[ia * 3];
  const ay = positions[ia * 3 + 1];
  const az = positions[ia * 3 + 2];
  const abx = positions[ib * 3] - ax;
  const aby = positions[ib * 3 + 1] - ay;
  const abz = positions[ib * 3 + 2] - az;
  const acx = positions[ic * 3] - ax;
  const acy = positions[ic * 3 + 1] - ay;
  const acz = positions[ic * 3 + 2] - az;
  const nx = aby * acz - abz * acy;
  const ny = abz * acx - abx * acz;
  const nz = abx * acy - aby * acx;

  normals[ia * 3] += nx;
  normals[ia * 3 + 1] += ny;
  normals[ia * 3 + 2] += nz;
  normals[ib * 3] += nx;
  normals[ib * 3 + 1] += ny;
  normals[ib * 3 + 2] += nz;
  normals[ic * 3] += nx;
  normals[ic * 3 + 1] += ny;
  normals[ic * 3 + 2] += nz;
}

function buildVertexNormals(positions: Float32Array): Float32Array {
  const normals = new Float32Array(positions.length);

  for (let y = 0; y < TILE_SEGMENTS; y += 1) {
    for (let x = 0; x < TILE_SEGMENTS; x += 1) {
      const topLeft = y * (TILE_SEGMENTS + 1) + x;
      const topRight = topLeft + 1;
      const bottomLeft = topLeft + TILE_SEGMENTS + 1;
      const bottomRight = bottomLeft + 1;
      accumulateTriangleNormal(positions, normals, topLeft, bottomLeft, topRight);
      accumulateTriangleNormal(positions, normals, topRight, bottomLeft, bottomRight);
    }
  }

  for (let i = 0; i < normals.length; i += 3) {
    const nx = normals[i];
    const ny = normals[i + 1];
    const nz = normals[i + 2];
    const length = Math.hypot(nx, ny, nz);
    if (length <= 1e-9) continue;
    normals[i] = nx / length;
    normals[i + 1] = ny / length;
    normals[i + 2] = nz / length;
  }

  return normals;
}

export function buildTerrainTileBuffers(
  info: TileInfo,
  planet: Planet,
  seed: number,
): TerrainTileBuffers {
  const { u0, u1, v0, v1 } = info.bounds;
  const vertexCount = (TILE_SEGMENTS + 1) * (TILE_SEGMENTS + 1);
  const positions = new Float32Array(vertexCount * 3);
  const colors = new Float32Array(vertexCount * 3);
  const uvs = new Float32Array(vertexCount * 2);
  const weights0 = new Float32Array(vertexCount * 4);
  const weights1 = new Float32Array(vertexCount * 4);
  // Face-uv units to texture repeats. Rebasing on the tile origin (in whole
  // repeats) keeps the values small enough for Float32 while staying
  // continuous with neighbouring tiles.
  const repeatsPerFaceUnit = planet.radiusMeters / TERRAIN_TEXTURE_REPEAT_METERS;
  const uRepeatBase = Math.floor(u0 * repeatsPerFaceUnit);
  const vRepeatBase = Math.floor(v0 * repeatsPerFaceUnit);
  let ptr = 0;

  for (let iy = 0; iy <= TILE_SEGMENTS; iy += 1) {
    const v = v0 + ((v1 - v0) * iy) / TILE_SEGMENTS;
    for (let ix = 0; ix <= TILE_SEGMENTS; ix += 1) {
      const u = u0 + ((u1 - u0) * ix) / TILE_SEGMENTS;
      const direction = directionFromCubeFace(info.face, u, v);
      const samplePos = scale(direction, planet.radiusMeters);
      const surface = sampleRenderablePlanetSurface(planet, seed, samplePos);
      const radius = surface.surfaceRadiusMeters;
      const renderSurface: PlanetSurfaceSample =
        surface.lakeWaterLevelMeters != null &&
        surface.heightMeters < surface.lakeWaterLevelMeters - 0.5
          ? {
              ...surface,
              biome: (surface.riverWaterLevelMeters != null ? 'river' : 'lake') as Biome,
            }
          : surface;

      positions[ptr * 3] = direction.x * radius - info.centerPosition.x;
      positions[ptr * 3 + 1] = direction.y * radius - info.centerPosition.y;
      positions[ptr * 3 + 2] = direction.z * radius - info.centerPosition.z;
      writeSurfaceColor(renderSurface, colors, ptr * 3);
      writeSurfaceWeights(renderSurface, weights0, weights1, ptr);
      uvs[ptr * 2] = u * repeatsPerFaceUnit - uRepeatBase;
      uvs[ptr * 2 + 1] = v * repeatsPerFaceUnit - vRepeatBase;
      ptr += 1;
    }
  }

  return {
    colors,
    normals: buildVertexNormals(positions),
    positions,
    uvs,
    weights0,
    weights1,
  };
}

