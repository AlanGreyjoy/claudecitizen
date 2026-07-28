import { normalize, scale } from '../math/vec3';
import { directionFromCubeFace, faceUvFromDirection } from './cube-sphere';
import { sampleSurfaceHeightDetails, type SurfaceHeightDetails } from './elevation';
import { getActivePlanetConfig, type PlanetRuntimeConfig } from './planets/runtime';
import { clamp } from './terrain-noise';
import { terrainCellUsesNorthwestSoutheastDiagonal } from './terrain-triangulation';
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

/**
 * One cached grid corner. The surface point is stored next to the height
 * details so a cache hit is pure arithmetic — resolving it from the cube face
 * again would re-run `directionFromCubeFace` (two vector allocations) on every
 * one of the tens of thousands of probes a lush vegetation tile issues.
 */
interface RenderableGridEntry {
  details: SurfaceHeightDetails;
  x: number;
  y: number;
  z: number;
}

const FACE_KEY_INDEX: Record<CubeFace, number> = {
  nx: 1,
  ny: 3,
  nz: 5,
  px: 0,
  py: 2,
  pz: 4,
};

// Grid coordinates reach 2^17 * 24 ≈ 3.15M at the finest level, so 22 bits each
// covers them with headroom. face(3) + level(5) + x(22) + y(22) = 52 bits, which
// stays inside the exact-integer range of a double.
const GRID_COORDINATE_STRIDE = 4_194_304;
const FACE_LEVEL_STRIDE = GRID_COORDINATE_STRIDE * GRID_COORDINATE_STRIDE;

const renderableHeightCache = new Map<number, RenderableGridEntry>();
const renderableHeightCacheStats: RenderableHeightCacheStatsInternal = {
  evictions: 0,
  hits: 0,
  limit: MAX_RENDERABLE_HEIGHT_CACHE,
  misses: 0,
  peakEntries: 0,
};
let cachedTerrainConfig: PlanetRuntimeConfig | null = null;
let cachedTerrainRecipeKey = '';
let cachedPlanetIdentity = '';
let cachedGenerationPlanet: Planet | null = null;
let cachedGenerationSeed = Number.NaN;
let cachedGenerationConfig: PlanetRuntimeConfig | null = null;

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

/**
 * The planet, seed, and terrain recipe used to be baked into every cache key,
 * which meant building and hashing a ~70 character string four times per probe.
 * They change only when a different planet is activated, so treat them as a
 * cache generation instead: verify once per lookup batch and drop everything
 * when it moves.
 */
function ensureCacheGeneration(planet: Planet, seed: number): void {
  const config = getActivePlanetConfig();
  if (
    planet === cachedGenerationPlanet &&
    seed === cachedGenerationSeed &&
    config === cachedGenerationConfig
  ) {
    return;
  }
  cachedGenerationPlanet = planet;
  cachedGenerationSeed = seed;
  cachedGenerationConfig = config;
  // Slow path only. A re-activated config object or a re-created Planet can
  // still describe the same body, so compare the recipe itself before throwing
  // away a warm cache.
  const identity = `${terrainRecipeKey()}|${planet.name ?? 'planet'}|${planet.radiusMeters}|${planet.terrainAmplitudeMeters}|${seed}`;
  if (identity === cachedPlanetIdentity) return;
  cachedPlanetIdentity = identity;
  renderableHeightCache.clear();
}

function renderableHeightKey(
  face: CubeFace,
  level: number,
  gridX: number,
  gridY: number,
): number {
  return (
    (FACE_KEY_INDEX[face] * 32 + level) * FACE_LEVEL_STRIDE +
    gridX * GRID_COORDINATE_STRIDE +
    gridY
  );
}

function storeRenderableHeightEntry(key: number, entry: RenderableGridEntry): void {
  renderableHeightCache.set(key, entry);
  if (renderableHeightCache.size > renderableHeightCacheStats.peakEntries) {
    renderableHeightCacheStats.peakEntries = renderableHeightCache.size;
  }
  if (renderableHeightCache.size <= MAX_RENDERABLE_HEIGHT_CACHE) return;
  evictRenderableHeightEntries();
}

/**
 * Insertion-order (FIFO) eviction. The previous map re-inserted on every hit to
 * maintain true LRU, which cost three map operations per probe on the hottest
 * path in the engine. Probes are strongly spatially coherent, so FIFO over a
 * 180k window keeps effectively the same working set for a fraction of the
 * traffic. Trim in one batch so a full cache does not pay eviction per insert.
 */
function evictRenderableHeightEntries(): void {
  const target = Math.floor(MAX_RENDERABLE_HEIGHT_CACHE * 0.95);
  for (const key of renderableHeightCache.keys()) {
    if (renderableHeightCache.size <= target) break;
    renderableHeightCache.delete(key);
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
  face: CubeFace,
  gridX: number,
  gridY: number,
  level: number,
): RenderableGridEntry {
  const key = renderableHeightKey(face, level, gridX, gridY);
  const cached = renderableHeightCache.get(key);
  if (cached !== undefined) {
    renderableHeightCacheStats.hits += 1;
    return cached;
  }

  renderableHeightCacheStats.misses += 1;
  const cellsPerFace = (2 ** level) * RENDER_SURFACE_SEGMENTS;
  const u = -1 + (gridX * 2) / cellsPerFace;
  const v = -1 + (gridY * 2) / cellsPerFace;
  const direction = directionFromCubeFace(face, u, v);
  const details = sampleSurfaceHeightDetails(
    planet,
    seed,
    scale(direction, planet.radiusMeters),
    {
      sampleSpacingMeters: renderableGridSampleSpacingMeters(planet, level),
    },
  );
  const surfaceRadius = planet.radiusMeters + details.heightMeters;
  const entry: RenderableGridEntry = {
    details,
    x: direction.x * surfaceRadius,
    y: direction.y * surfaceRadius,
    z: direction.z * surfaceRadius,
  };
  storeRenderableHeightEntry(key, entry);
  return entry;
}

function interpolateHeightDetails(
  samples: readonly [
    RenderableGridEntry,
    RenderableGridEntry,
    RenderableGridEntry,
    RenderableGridEntry,
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

/** Unit-length triangle normal oriented outward, built without intermediates. */
function orientedTriangleNormal(
  a: RenderableGridEntry,
  b: RenderableGridEntry,
  c: RenderableGridEntry,
  direction: Vec3,
): Vec3 {
  const abx = b.x - a.x;
  const aby = b.y - a.y;
  const abz = b.z - a.z;
  const acx = c.x - a.x;
  const acy = c.y - a.y;
  const acz = c.z - a.z;
  let nx = aby * acz - abz * acy;
  let ny = abz * acx - abx * acz;
  let nz = abx * acy - aby * acx;
  const inverseLength = 1 / Math.max(Math.hypot(nx, ny, nz), 1e-12);
  nx *= inverseLength;
  ny *= inverseLength;
  nz *= inverseLength;
  if (nx * direction.x + ny * direction.y + nz * direction.z < 0) {
    nx = -nx;
    ny = -ny;
    nz = -nz;
  }
  return { x: nx, y: ny, z: nz };
}

/** Reused across probes; only ever read back inside sampleRenderableSurfaceGrid. */
const cornerScratch: [
  RenderableGridEntry,
  RenderableGridEntry,
  RenderableGridEntry,
  RenderableGridEntry,
] = [
  { details: null!, x: 0, y: 0, z: 0 },
  { details: null!, x: 0, y: 0, z: 0 },
  { details: null!, x: 0, y: 0, z: 0 },
  { details: null!, x: 0, y: 0, z: 0 },
];
const weightScratch: [number, number, number, number] = [0, 0, 0, 0];

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
  ensureCacheGeneration(planet, seed);
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

  const face = faceUv.face;
  const s00 = renderableGridPoint(planet, seed, face, gridX, gridY, level);
  const s10 = renderableGridPoint(planet, seed, face, gridX + 1, gridY, level);
  const s01 = renderableGridPoint(planet, seed, face, gridX, gridY + 1, level);
  const s11 = renderableGridPoint(planet, seed, face, gridX + 1, gridY + 1, level);
  cornerScratch[0] = s00;
  cornerScratch[1] = s10;
  cornerScratch[2] = s01;
  cornerScratch[3] = s11;

  // Barycentric blend across the active half of the cell, written as scalars.
  // The vector-combinator form allocated nine Vec3s per probe, and this runs
  // once per foot sample and once per vegetation placement attempt.
  let w00 = 0;
  let w10 = 0;
  let w01 = 0;
  let w11 = 0;
  let normal: Vec3 | null = null;
  const usesNorthwestSoutheastDiagonal =
    terrainCellUsesNorthwestSoutheastDiagonal(gridX, gridY);

  if (usesNorthwestSoutheastDiagonal && fracV <= fracU) {
    w00 = 1 - fracU;
    w10 = fracU - fracV;
    w11 = fracV;
    if (includeNormal) {
      normal = orientedTriangleNormal(s00, s10, s11, direction);
    }
  } else if (usesNorthwestSoutheastDiagonal) {
    w00 = 1 - fracV;
    w01 = fracV - fracU;
    w11 = fracU;
    if (includeNormal) {
      normal = orientedTriangleNormal(s00, s11, s01, direction);
    }
  } else if (fracU + fracV <= 1) {
    w00 = 1 - fracU - fracV;
    w10 = fracU;
    w01 = fracV;
    if (includeNormal) {
      normal = orientedTriangleNormal(s00, s10, s01, direction);
    }
  } else {
    w10 = 1 - fracV;
    w01 = 1 - fracU;
    w11 = fracU + fracV - 1;
    if (includeNormal) {
      normal = orientedTriangleNormal(s10, s11, s01, direction);
    }
  }

  weightScratch[0] = w00;
  weightScratch[1] = w10;
  weightScratch[2] = w01;
  weightScratch[3] = w11;
  const point: Vec3 = {
    x: s00.x * w00 + s10.x * w10 + s01.x * w01 + s11.x * w11,
    y: s00.y * w00 + s10.y * w10 + s01.y * w01 + s11.y * w11,
    z: s00.z * w00 + s10.z * w10 + s01.z * w01 + s11.z * w11,
  };

  const heightMeters =
    point.x * direction.x + point.y * direction.y + point.z * direction.z -
    planet.radiusMeters;
  return {
    direction,
    heightDetails: interpolateHeightDetails(cornerScratch, weightScratch, heightMeters),
    heightMeters,
    normal,
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
