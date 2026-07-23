import type {
  CubeFace,
  Planet,
  PlanetSpawnCatalog,
  PlanetSpawnEntry,
  SurfaceSpawnInstance,
  TileInfo,
  Vec3,
} from '../../types';
import { normalize, scale } from '../../math/vec3';
import { directionFromCubeFace } from '../cube_sphere';
import { classifyBiome } from '../climate';
import { samplePlanetSurface } from '../planet_surface';
import { sampleVisibleSurfaceFrame } from '../renderable_surface';
import { clamp01, hash01, lerp, scaledSampleCount } from './hash';
import {
  canPlaceWithGap,
  createPlacementGrid,
  registerPlacement,
  type PlacementGrid,
} from './placement_grid';

const FACE_INDEX: Record<CubeFace, number> = {
  nx: 1,
  ny: 2,
  nz: 3,
  px: 4,
  py: 5,
  pz: 6,
};

/** Hard clamp on catalog samplesPerTile (shared probes). */
export const MAX_SAMPLES_PER_TILE = 256;
/** Hard cap on instances produced for one tile. */
export const MAX_INSTANCES_PER_TILE = 512;
/** Soft per-entry cap within a tile (prevents one entry dominating). */
export const MAX_INSTANCES_PER_ENTRY_PER_TILE = 128;
/** Only decorate tiles at this LOD or finer (near-ground detail). */
export const SURFACE_SPAWN_MIN_TILE_LEVEL = 12;

/** Scratch list reused across probes — domain-only, not concurrent. */
const acceptScratch: PlanetSpawnEntry[] = [];
const weightScratch: number[] = [];

/** Biome + height-band + enabled/weight gates for one catalog entry. */
export function acceptsSurface(
  entry: PlanetSpawnEntry,
  biome: string,
  normalizedHeight: number,
): boolean {
  if (!entry.enabled || !entry.assetUrl || entry.biomes.length === 0) return false;
  if (entry.weight <= 0 || entry.density <= 0) return false;
  if (!entry.biomes.includes(biome as PlanetSpawnEntry['biomes'][number])) {
    return false;
  }
  return (
    normalizedHeight >= entry.minNormalizedHeight &&
    normalizedHeight <= entry.maxNormalizedHeight
  );
}

/** Relative lottery weight (weight × density). */
export function entryLotteryWeight(entry: PlanetSpawnEntry): number {
  return Math.max(0, entry.weight) * Math.max(0, entry.density);
}

/**
 * Offset a surface position along the normal by authored inset × scale.
 * Negative inset sinks into the terrain; positive lifts above it.
 */
export function applyTerrainInset(
  position: Vec3,
  normal: Vec3,
  terrainInsetMeters: number,
  scaleValue: number,
): void {
  if (!Number.isFinite(terrainInsetMeters) || terrainInsetMeters === 0) return;
  const offset = terrainInsetMeters * scaleValue;
  position.x += normal.x * offset;
  position.y += normal.y * offset;
  position.z += normal.z * offset;
}

/**
 * Seed-stable weighted lottery among accepting entries.
 * Returns the chosen entry or null if none / zero total weight.
 */
function pickWeightedEntry(
  seed: number,
  faceIndex: number,
  tileInfo: TileInfo,
  sampleIndex: number,
  candidates: readonly PlanetSpawnEntry[],
  weights: readonly number[],
): PlanetSpawnEntry | null {
  let total = 0;
  for (let i = 0; i < weights.length; i += 1) total += weights[i]!;
  if (total <= 0 || candidates.length === 0) return null;
  const roll =
    hash01(
      seed,
      faceIndex,
      tileInfo.level,
      tileInfo.x,
      tileInfo.y,
      sampleIndex,
      101,
    ) * total;
  let cursor = 0;
  for (let i = 0; i < candidates.length; i += 1) {
    cursor += weights[i]!;
    if (roll < cursor) return candidates[i]!;
  }
  return candidates[candidates.length - 1]!;
}

/**
 * Deterministic surface-prop placements for one terrain tile from a shared
 * probe set. Entries compete by accept rules + weighted lottery — no per-entry
 * full sample loops. Pure domain — no Three.js.
 */
function gatherAcceptedEntries(
  entries: PlanetSpawnEntry[],
  surface: ReturnType<typeof samplePlanetSurface>,
  perEntryCounts: Map<string, number>,
): void {
  acceptScratch.length = 0;
  weightScratch.length = 0;
  for (const entry of entries) {
    if (!acceptsSurface(entry, surface.biome, surface.normalizedHeight)) continue;
    const count = perEntryCounts.get(entry.id) ?? 0;
    if (count >= MAX_INSTANCES_PER_ENTRY_PER_TILE) continue;
    const w = entryLotteryWeight(entry);
    if (w <= 0) continue;
    acceptScratch.push(entry);
    weightScratch.push(w);
  }
}

function passesSpawnLottery(
  seed: number,
  faceIndex: number,
  tileInfo: TileInfo,
  sampleIndex: number,
  catalogDensity: number,
  chosen: PlanetSpawnEntry,
): boolean {
  const catalogAccept =
    hash01(seed, faceIndex, tileInfo.level, tileInfo.x, tileInfo.y, sampleIndex, 71) <
    Math.min(1, 0.85 * Math.sqrt(Math.max(0.01, catalogDensity)));
  if (!catalogAccept) return false;
  return (
    hash01(
      seed + chosen.seedOffset,
      faceIndex,
      tileInfo.level,
      tileInfo.x,
      tileInfo.y,
      sampleIndex,
      73,
    ) < Math.min(1, 0.85 * Math.sqrt(Math.max(0.01, chosen.density)))
  );
}

interface SpawnPlacementContext {
  chosen: PlanetSpawnEntry;
  direction: Vec3;
  surface: ReturnType<typeof samplePlanetSurface>;
  planet: Planet;
  planetSeed: number;
  probe: Vec3;
  seed: number;
  faceIndex: number;
  tileInfo: TileInfo;
  sampleIndex: number;
  grids: Map<string, PlacementGrid | null>;
}

function tryPlaceSpawnInstance(context: SpawnPlacementContext): SurfaceSpawnInstance | null {
  const {
    chosen,
    direction,
    surface,
    planet,
    planetSeed,
    probe,
    seed,
    faceIndex,
    tileInfo,
    sampleIndex,
    grids,
  } = context;
  const worldPosition: Vec3 = {
    x: direction.x * surface.surfaceRadiusMeters,
    y: direction.y * surface.surfaceRadiusMeters,
    z: direction.z * surface.surfaceRadiusMeters,
  };

  let grid: PlacementGrid | null | undefined = grids.get(chosen.id);
  if (grid === undefined) {
    grid = createPlacementGrid(chosen.gapMeters);
    grids.set(chosen.id, grid);
  }
  if (!canPlaceWithGap(grid, worldPosition)) return null;
  registerPlacement(grid, worldPosition);

  let normal: Vec3 = direction;
  if (chosen.alignToNormal) {
    normal = normalize(sampleVisibleSurfaceFrame(planet, planetSeed, probe).normal);
  }

  const yaw =
    hash01(
      seed + chosen.seedOffset,
      faceIndex,
      tileInfo.level,
      tileInfo.x,
      tileInfo.y,
      sampleIndex,
      47,
    ) *
    Math.PI *
    2;
  const scaleValue = lerp(
    chosen.minScale,
    chosen.maxScale,
    clamp01(hash01(seed + chosen.seedOffset, tileInfo.x, tileInfo.y, sampleIndex, 83)),
  );
  applyTerrainInset(worldPosition, normal, chosen.terrainInsetMeters ?? 0, scaleValue);
  return {
    layerId: chosen.id,
    position: worldPosition,
    normal,
    yawRadians: yaw,
    scale: scaleValue,
  };
}

export function collectTileSurfaceSpawns(
  tileInfo: TileInfo,
  planet: Planet,
  planetSeed: number,
  catalog: PlanetSpawnCatalog,
): SurfaceSpawnInstance[] {
  if (tileInfo.level < SURFACE_SPAWN_MIN_TILE_LEVEL) return [];

  const entries = catalog.entries;
  if (entries.length === 0) return [];

  const faceIndex = FACE_INDEX[tileInfo.face] ?? 0;
  const catalogDensity = Math.max(0, catalog.density);
  if (catalogDensity <= 0) return [];

  const baseSamples = Math.min(
    MAX_SAMPLES_PER_TILE,
    Math.max(0, Math.round(catalog.samplesPerTile)),
  );
  const densityScale = Math.pow(catalogDensity, 1.2);
  const sampleCount = scaledSampleCount(baseSamples, densityScale);
  if (sampleCount <= 0) return [];

  const seed = planetSeed >>> 0;
  const grids = new Map<string, PlacementGrid | null>();
  const perEntryCounts = new Map<string, number>();
  const instances: SurfaceSpawnInstance[] = [];

  for (let i = 0; i < sampleCount; i += 1) {
    if (instances.length >= MAX_INSTANCES_PER_TILE) break;

    const uJitter = hash01(seed, faceIndex, tileInfo.level, tileInfo.x, tileInfo.y, i, 11);
    const vJitter = hash01(seed, faceIndex, tileInfo.level, tileInfo.x, tileInfo.y, i, 29);
    const u =
      tileInfo.bounds.u0 + (tileInfo.bounds.u1 - tileInfo.bounds.u0) * uJitter;
    const v =
      tileInfo.bounds.v0 + (tileInfo.bounds.v1 - tileInfo.bounds.v0) * vJitter;
    const direction = directionFromCubeFace(tileInfo.face, u, v);
    const probe = scale(direction, planet.radiusMeters);
    const surface = samplePlanetSurface(planet, planetSeed, probe);
    if (surface.waterBody != null) continue;

    gatherAcceptedEntries(entries, surface, perEntryCounts);
    if (acceptScratch.length === 0) continue;

    const chosen = pickWeightedEntry(
      seed,
      faceIndex,
      tileInfo,
      i,
      acceptScratch,
      weightScratch,
    );
    if (!chosen) continue;
    if (!passesSpawnLottery(seed, faceIndex, tileInfo, i, catalogDensity, chosen)) continue;

    const instance = tryPlaceSpawnInstance({
      chosen,
      direction,
      surface,
      planet,
      planetSeed,
      probe,
      seed,
      faceIndex,
      tileInfo,
      sampleIndex: i,
      grids,
    });
    if (!instance) continue;

    instances.push(instance);
    perEntryCounts.set(chosen.id, (perEntryCounts.get(chosen.id) ?? 0) + 1);
  }

  return instances;
}

/**
 * Legacy single-entry helper — wraps a one-entry catalog so density/feel stays
 * comparable for callers that still place one layer at a time.
 */
export function collectLayerInstancesForTile(
  tileInfo: TileInfo,
  planet: Planet,
  planetSeed: number,
  layer: PlanetSpawnEntry,
): SurfaceSpawnInstance[] {
  return collectTileSurfaceSpawns(tileInfo, planet, planetSeed, {
    samplesPerTile: 96,
    density: 1,
    entries: [layer],
  });
}

/** Re-classify helper for editor docs / tests. */
export function classifySpawnBiome(
  planet: Planet,
  seed: number,
  direction: Vec3,
): { biome: string; normalizedHeight: number } {
  const surface = samplePlanetSurface(planet, seed, scale(direction, planet.radiusMeters));
  const latFactor = Math.abs(Math.asin(Math.min(1, Math.max(-1, direction.y)))) / (Math.PI / 2);
  return {
    biome: classifyBiome({
      latFactor,
      moisture: surface.moisture,
      mountainRegion: surface.mountainRegion,
      normalizedHeight: surface.normalizedHeight,
      temperature: surface.temperature,
    }),
    normalizedHeight: surface.normalizedHeight,
  };
}
