import { add, cross, dot, normalize, scale, sub } from '../math/vec3';
import { directionFromCubeFace, faceUvFromDirection } from './cube_sphere';
import { sampleSurfaceHeightDetails, type SurfaceHeightDetails } from './elevation';
import { getActivePlanetConfig, type PlanetRuntimeConfig } from './planets/runtime';
import { clamp } from './terrain_noise';
import { terrainCellUsesNorthwestSoutheastDiagonal } from './terrain_triangulation';
import type { CubeFace, Planet, RenderableSurfaceCacheStats, TileBounds, Vec3 } from '../types';

export const RENDER_SURFACE_LEVEL = 17;
export const RENDER_SURFACE_SEGMENTS = 24;

// On-foot L17 + lush veg probes thrash at 120k; give the ring more headroom so
// short walks do not constantly recompute band-limited heights.
const MAX_RENDERABLE_HEIGHT_CACHE = 180_000;

interface RenderableHeightCacheStatsInternal {
  evictions: number;
  hits: number;
  limit: number;
  misses: number;
  peakEntries: number;
}

export interface VisibleSurfaceFrame {
  heightDetails: SurfaceHeightDetails;
  heightMeters: number;
  normal: Vec3;
  point: Vec3;
}

interface RenderableGridSample {
  details: SurfaceHeightDetails;
  point: Vec3;
}

interface RenderableGridCoordinates {
  face: CubeFace;
  gridX: number;
  gridY: number;
  level: number;
}

const renderableHeightCache = new Map<string, SurfaceHeightDetails>();
const renderableHeightCacheStats: RenderableHeightCacheStatsInternal = {
  evictions: 0,
  hits: 0,
  limit: MAX_RENDERABLE_HEIGHT_CACHE,
  misses: 0,
  peakEntries: 0,
};
let cachedTerrainConfig: PlanetRuntimeConfig | null = null;
let cachedTerrainRecipeKey = '';

function terrainRecipeKey(): string {
  const config = getActivePlanetConfig();
  if (config === cachedTerrainConfig) return cachedTerrainRecipeKey;
  const source = JSON.stringify([
    config.planetId,
    config.height,
    config.regions,
    config.hydrology,
  ]);
  let hash = 0x811c9dc5;
  for (let i = 0; i < source.length; i += 1) {
    hash ^= source.charCodeAt(i);
    hash = Math.imul(hash, 0x01000193);
  }
  cachedTerrainConfig = config;
  cachedTerrainRecipeKey = `${config.planetId}:${(hash >>> 0).toString(16)}`;
  return cachedTerrainRecipeKey;
}

function touchRenderableHeightEntry(key: string, details: SurfaceHeightDetails): void {
  if (renderableHeightCache.has(key)) renderableHeightCache.delete(key);
  renderableHeightCache.set(key, details);
  renderableHeightCacheStats.peakEntries = Math.max(
    renderableHeightCacheStats.peakEntries,
    renderableHeightCache.size,
  );
}

function evictRenderableHeightEntries(): void {
  while (renderableHeightCache.size > MAX_RENDERABLE_HEIGHT_CACHE) {
    const oldestKey = renderableHeightCache.keys().next().value;
    if (oldestKey == null) break;
    renderableHeightCache.delete(oldestKey);
    renderableHeightCacheStats.evictions += 1;
  }
}

export function getRenderableSurfaceCacheStats(): RenderableSurfaceCacheStats {
  return {
    entries: renderableHeightCache.size,
    evictions: renderableHeightCacheStats.evictions,
    hits: renderableHeightCacheStats.hits,
    limit: renderableHeightCacheStats.limit,
    misses: renderableHeightCacheStats.misses,
    peakEntries: renderableHeightCacheStats.peakEntries,
  };
}

function renderableHeightKey(
  planet: Planet,
  seed: number,
  coordinates: RenderableGridCoordinates,
): string {
  const { face, gridX, gridY, level } = coordinates;
  return [
    terrainRecipeKey(),
    planet.name ?? 'planet',
    planet.radiusMeters,
    planet.terrainAmplitudeMeters,
    seed,
    level,
    face,
    gridX,
    gridY,
  ].join(':');
}

function tileBounds(level: number, x: number, y: number): TileBounds {
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

export function renderableCellSampleSpacingMeters(
  planet: Planet,
  level: number,
): number {
  const cellsPerFace = (2 ** level) * RENDER_SURFACE_SEGMENTS;
  // The face-center cube-sphere diagonal is the largest cell footprint at a
  // given level. Using it globally is conservative near face edges and keeps
  // the octave cutoff identical for every vertex introduced at that level.
  return (planet.radiusMeters * 2 * Math.SQRT2) / cellsPerFace;
}

export function renderableGridSampleSpacingMeters(
  planet: Planet,
  level: number,
): number {
  // Every vertex introduced by a tile must use the same band limit. Letting
  // inherited even/even vertices fall back to a coarser level creates sparse
  // height outliers surrounded by fine samples: the visible pyramid spikes and
  // inverted holes that this grid is meant to prevent.
  return renderableCellSampleSpacingMeters(planet, level);
}

function renderableGridPoint(
  planet: Planet,
  seed: number,
  coordinates: RenderableGridCoordinates,
): RenderableGridSample {
  const { face, gridX, gridY, level } = coordinates;
  const cellsPerFace = (2 ** level) * RENDER_SURFACE_SEGMENTS;
  const u = -1 + (gridX * 2) / cellsPerFace;
  const v = -1 + (gridY * 2) / cellsPerFace;
  const direction = directionFromCubeFace(face, u, v);
  const key = renderableHeightKey(planet, seed, coordinates);
  let details = renderableHeightCache.get(key);

  if (details == null) {
    renderableHeightCacheStats.misses += 1;
    details = sampleSurfaceHeightDetails(
      planet,
      seed,
      scale(direction, planet.radiusMeters),
      {
        sampleSpacingMeters: renderableGridSampleSpacingMeters(planet, level),
      },
    );
    touchRenderableHeightEntry(key, details);
    evictRenderableHeightEntries();
  } else {
    renderableHeightCacheStats.hits += 1;
    touchRenderableHeightEntry(key, details);
  }

  return {
    details,
    point: scale(direction, planet.radiusMeters + details.heightMeters),
  };
}

function interpolateHeightDetails(
  samples: readonly [
    RenderableGridSample,
    RenderableGridSample,
    RenderableGridSample,
    RenderableGridSample,
  ],
  weights: readonly [number, number, number, number],
  heightMeters: number,
): SurfaceHeightDetails {
  let lakeMask = 0;
  let mountainRegion = 0;
  let preRiverElevationNormalized = 0;
  let riverStrength = 0;
  let riverWaterLevelNormalized = 0;
  let riverWaterWeight = 0;
  let hasRiverStrength = true;
  for (let i = 0; i < samples.length; i += 1) {
    const weight = weights[i];
    if (weight === 0) continue;
    const details = samples[i].details;
    lakeMask += details.lakeMask * weight;
    mountainRegion += details.mountainRegion * weight;
    preRiverElevationNormalized += details.preRiverElevationNormalized * weight;
    if (details.riverStrength == null) hasRiverStrength = false;
    else riverStrength += details.riverStrength * weight;
    if (details.riverWaterLevelNormalized != null) {
      riverWaterLevelNormalized += details.riverWaterLevelNormalized * weight;
      riverWaterWeight += weight;
    }
  }
  return {
    heightMeters,
    lakeMask,
    mountainRegion,
    preRiverElevationNormalized,
    riverStrength: hasRiverStrength ? riverStrength : undefined,
    riverWaterLevelNormalized:
      riverWaterWeight > 0 ? riverWaterLevelNormalized / riverWaterWeight : null,
  };
}

function orientNormal(normal: Vec3, direction: Vec3): Vec3 {
  return dot(normal, direction) >= 0 ? normalize(normal) : scale(normalize(normal), -1);
}

function sampleRenderableSurfaceGrid(
  planet: Planet,
  seed: number,
  position: Vec3,
  level: number,
  includeNormal: boolean,
): {
  direction: Vec3;
  heightDetails: SurfaceHeightDetails;
  heightMeters: number;
  normal: Vec3 | null;
  point: Vec3;
} {
  const direction = normalize(position);
  const faceUv = faceUvFromDirection(direction);
  const tileCount = 2 ** level;
  const tileX = clamp(Math.floor(((faceUv.u + 1) * 0.5) * tileCount), 0, tileCount - 1);
  const tileY = clamp(Math.floor(((faceUv.v + 1) * 0.5) * tileCount), 0, tileCount - 1);
  const bounds = tileBounds(level, tileX, tileY);
  const scaledU = ((faceUv.u - bounds.u0) / (bounds.u1 - bounds.u0)) * RENDER_SURFACE_SEGMENTS;
  const scaledV = ((faceUv.v - bounds.v0) / (bounds.v1 - bounds.v0)) * RENDER_SURFACE_SEGMENTS;
  const cellX = clamp(Math.floor(scaledU), 0, RENDER_SURFACE_SEGMENTS - 1);
  const cellY = clamp(Math.floor(scaledV), 0, RENDER_SURFACE_SEGMENTS - 1);
  const fracU = scaledU - cellX;
  const fracV = scaledV - cellY;
  const gridX = tileX * RENDER_SURFACE_SEGMENTS + cellX;
  const gridY = tileY * RENDER_SURFACE_SEGMENTS + cellY;

  const s00 = renderableGridPoint(planet, seed, {
    face: faceUv.face,
    gridX,
    gridY,
    level,
  });
  const s10 = renderableGridPoint(planet, seed, {
    face: faceUv.face,
    gridX: gridX + 1,
    gridY,
    level,
  });
  const s01 = renderableGridPoint(planet, seed, {
    face: faceUv.face,
    gridX,
    gridY: gridY + 1,
    level,
  });
  const s11 = renderableGridPoint(planet, seed, {
    face: faceUv.face,
    gridX: gridX + 1,
    gridY: gridY + 1,
    level,
  });
  const samples = [s00, s10, s01, s11] as const;
  const p00 = s00.point;
  const p10 = s10.point;
  const p01 = s01.point;
  const p11 = s11.point;

  let point: Vec3;
  let weights: [number, number, number, number];
  let normal: Vec3 | null = null;
  const usesNorthwestSoutheastDiagonal =
    terrainCellUsesNorthwestSoutheastDiagonal(gridX, gridY);

  if (usesNorthwestSoutheastDiagonal && fracV <= fracU) {
    point = add(
      add(scale(p00, 1 - fracU), scale(p10, fracU - fracV)),
      scale(p11, fracV),
    );
    weights = [1 - fracU, fracU - fracV, 0, fracV];
    if (includeNormal) normal = cross(sub(p10, p00), sub(p11, p00));
  } else if (usesNorthwestSoutheastDiagonal) {
    point = add(
      add(scale(p00, 1 - fracV), scale(p11, fracU)),
      scale(p01, fracV - fracU),
    );
    weights = [1 - fracV, 0, fracV - fracU, fracU];
    if (includeNormal) normal = cross(sub(p11, p00), sub(p01, p00));
  } else if (fracU + fracV <= 1) {
    point = add(
      add(scale(p00, 1 - fracU - fracV), scale(p10, fracU)),
      scale(p01, fracV),
    );
    weights = [1 - fracU - fracV, fracU, fracV, 0];
    if (includeNormal) normal = cross(sub(p10, p00), sub(p01, p00));
  } else {
    point = add(
      add(scale(p10, 1 - fracV), scale(p11, fracU + fracV - 1)),
      scale(p01, 1 - fracU),
    );
    weights = [0, 1 - fracV, 1 - fracU, fracU + fracV - 1];
    if (includeNormal) normal = cross(sub(p11, p10), sub(p01, p10));
  }

  const heightMeters = dot(point, direction) - planet.radiusMeters;
  return {
    direction,
    heightDetails: interpolateHeightDetails(samples, weights, heightMeters),
    heightMeters,
    normal: normal ? orientNormal(normal, direction) : null,
    point,
  };
}

/**
 * Height + details from the per-LOD renderable grid without building a triangle
 * normal. Vegetation placement rejection uses this so rejected
 * attempts avoid the cross/normalize work; accepted instances call
 * {@link sampleVisibleSurfaceFrame} (corners are already cache-warm).
 */
export function sampleRenderableSurfaceHeightDetails(
  planet: Planet,
  seed: number,
  position: Vec3,
  level: number = RENDER_SURFACE_LEVEL,
): { heightDetails: SurfaceHeightDetails; heightMeters: number } {
  const sample = sampleRenderableSurfaceGrid(planet, seed, position, level, false);
  return {
    heightDetails: sample.heightDetails,
    heightMeters: sample.heightMeters,
  };
}

export function sampleVisibleSurfaceFrame(
  planet: Planet,
  seed: number,
  position: Vec3,
  level: number = RENDER_SURFACE_LEVEL,
): VisibleSurfaceFrame {
  const sample = sampleRenderableSurfaceGrid(planet, seed, position, level, true);
  return {
    heightDetails: sample.heightDetails,
    heightMeters: sample.heightMeters,
    normal: sample.normal ?? sample.direction,
    point: sample.point,
  };
}

export function sampleRenderableSurfaceHeight(
  planet: Planet,
  seed: number,
  position: Vec3,
  level: number = RENDER_SURFACE_LEVEL,
): number {
  return sampleRenderableSurfaceHeightDetails(planet, seed, position, level).heightMeters;
}
