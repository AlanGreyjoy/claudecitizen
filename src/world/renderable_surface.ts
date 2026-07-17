import { add, cross, dot, normalize, scale, sub } from '../math/vec3';
import { directionFromCubeFace, faceUvFromDirection } from './cube_sphere';
import { sampleSurfaceHeight } from './elevation';
import { clamp } from './terrain_noise';
import { terrainCellUsesNorthwestSoutheastDiagonal } from './terrain_triangulation';
import type { CubeFace, Planet, RenderableSurfaceCacheStats, TileBounds, Vec3 } from '../types';

export const RENDER_SURFACE_LEVEL = 16;
export const RENDER_SURFACE_SEGMENTS = 24;

const MAX_RENDERABLE_HEIGHT_CACHE = 120_000;

interface RenderableHeightCacheStatsInternal {
  evictions: number;
  hits: number;
  limit: number;
  misses: number;
  peakEntries: number;
}

export interface VisibleSurfaceFrame {
  heightMeters: number;
  normal: Vec3;
}

const renderableHeightCache = new Map<string, number>();
const renderableHeightCacheStats: RenderableHeightCacheStatsInternal = {
  evictions: 0,
  hits: 0,
  limit: MAX_RENDERABLE_HEIGHT_CACHE,
  misses: 0,
  peakEntries: 0,
};

function touchRenderableHeightEntry(key: string, heightMeters: number): void {
  if (renderableHeightCache.has(key)) renderableHeightCache.delete(key);
  renderableHeightCache.set(key, heightMeters);
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
  level: number,
  face: CubeFace,
  gridX: number,
  gridY: number,
): string {
  return `${planet.name ?? 'planet'}:${seed}:${level}:${face}:${gridX}:${gridY}`;
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

function renderableGridPoint(
  planet: Planet,
  seed: number,
  level: number,
  face: CubeFace,
  gridX: number,
  gridY: number,
): Vec3 {
  const cellsPerFace = (2 ** level) * RENDER_SURFACE_SEGMENTS;
  const u = -1 + (gridX * 2) / cellsPerFace;
  const v = -1 + (gridY * 2) / cellsPerFace;
  const direction = directionFromCubeFace(face, u, v);
  const key = renderableHeightKey(planet, seed, level, face, gridX, gridY);
  let heightMeters = renderableHeightCache.get(key);

  if (heightMeters == null) {
    renderableHeightCacheStats.misses += 1;
    heightMeters = sampleSurfaceHeight(planet, seed, scale(direction, planet.radiusMeters));
    touchRenderableHeightEntry(key, heightMeters);
    evictRenderableHeightEntries();
  } else {
    renderableHeightCacheStats.hits += 1;
    touchRenderableHeightEntry(key, heightMeters);
  }

  return scale(direction, planet.radiusMeters + heightMeters);
}

function orientNormal(normal: Vec3, direction: Vec3): Vec3 {
  return dot(normal, direction) >= 0 ? normalize(normal) : scale(normalize(normal), -1);
}

export function sampleVisibleSurfaceFrame(
  planet: Planet,
  seed: number,
  position: Vec3,
  level: number = RENDER_SURFACE_LEVEL,
): VisibleSurfaceFrame {
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

  const p00 = renderableGridPoint(planet, seed, level, faceUv.face, gridX, gridY);
  const p10 = renderableGridPoint(planet, seed, level, faceUv.face, gridX + 1, gridY);
  const p01 = renderableGridPoint(planet, seed, level, faceUv.face, gridX, gridY + 1);
  const p11 = renderableGridPoint(planet, seed, level, faceUv.face, gridX + 1, gridY + 1);

  let normal: Vec3;
  let point: Vec3;
  const usesNorthwestSoutheastDiagonal =
    terrainCellUsesNorthwestSoutheastDiagonal(gridX, gridY);

  if (usesNorthwestSoutheastDiagonal && fracV <= fracU) {
    point = add(
      add(scale(p00, 1 - fracU), scale(p10, fracU - fracV)),
      scale(p11, fracV),
    );
    normal = cross(sub(p10, p00), sub(p11, p00));
  } else if (usesNorthwestSoutheastDiagonal) {
    point = add(
      add(scale(p00, 1 - fracV), scale(p11, fracU)),
      scale(p01, fracV - fracU),
    );
    normal = cross(sub(p11, p00), sub(p01, p00));
  } else if (fracU + fracV <= 1) {
    point = add(
      add(scale(p00, 1 - fracU - fracV), scale(p10, fracU)),
      scale(p01, fracV),
    );
    normal = cross(sub(p10, p00), sub(p01, p00));
  } else {
    point = add(
      add(scale(p10, 1 - fracV), scale(p11, fracU + fracV - 1)),
      scale(p01, 1 - fracU),
    );
    normal = cross(sub(p11, p10), sub(p01, p10));
  }

  return {
    heightMeters: dot(point, direction) - planet.radiusMeters,
    normal: orientNormal(normal, direction),
  };
}

export function sampleRenderableSurfaceHeight(
  planet: Planet,
  seed: number,
  position: Vec3,
  level: number = RENDER_SURFACE_LEVEL,
): number {
  return sampleVisibleSurfaceFrame(planet, seed, position, level).heightMeters;
}
