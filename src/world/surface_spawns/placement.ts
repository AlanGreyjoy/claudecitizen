import type {
  CubeFace,
  Planet,
  PlanetSpawnLayer,
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
} from './placement_grid';

const FACE_INDEX: Record<CubeFace, number> = {
  nx: 1,
  ny: 2,
  nz: 3,
  px: 4,
  py: 5,
  pz: 6,
};

/** Base sample attempts per tile before density scaling. */
const BASE_SAMPLES_PER_TILE = 96;
/** Only decorate tiles at this LOD or finer (near-ground detail). */
export const SURFACE_SPAWN_MIN_TILE_LEVEL = 12;

function layerSampleSeed(planetSeed: number, layer: PlanetSpawnLayer): number {
  return (planetSeed + layer.seedOffset) >>> 0;
}

function acceptsSurface(
  layer: PlanetSpawnLayer,
  biome: string,
  normalizedHeight: number,
): boolean {
  if (!layer.enabled || !layer.assetUrl || layer.biomes.length === 0) return false;
  if (!layer.biomes.includes(biome as PlanetSpawnLayer['biomes'][number])) {
    return false;
  }
  return (
    normalizedHeight >= layer.minNormalizedHeight &&
    normalizedHeight <= layer.maxNormalizedHeight
  );
}

/**
 * Deterministic surface-prop placements for one terrain tile and one layer.
 * Pure domain — no Three.js.
 */
export function collectLayerInstancesForTile(
  tileInfo: TileInfo,
  planet: Planet,
  planetSeed: number,
  layer: PlanetSpawnLayer,
): SurfaceSpawnInstance[] {
  if (
    !layer.enabled ||
    !layer.assetUrl ||
    layer.biomes.length === 0 ||
    layer.density <= 0 ||
    tileInfo.level < SURFACE_SPAWN_MIN_TILE_LEVEL
  ) {
    return [];
  }

  const seed = layerSampleSeed(planetSeed, layer);
  const faceIndex = FACE_INDEX[tileInfo.face] ?? 0;
  const densityScale = Math.pow(layer.density, 1.2);
  const sampleCount = scaledSampleCount(BASE_SAMPLES_PER_TILE, densityScale);
  if (sampleCount <= 0) return [];

  const placementGrid = createPlacementGrid(layer.gapMeters);
  const instances: SurfaceSpawnInstance[] = [];

  for (let i = 0; i < sampleCount; i += 1) {
    const uJitter = hash01(seed, faceIndex, tileInfo.level, tileInfo.x, tileInfo.y, i, 11);
    const vJitter = hash01(seed, faceIndex, tileInfo.level, tileInfo.x, tileInfo.y, i, 29);
    const u =
      tileInfo.bounds.u0 + (tileInfo.bounds.u1 - tileInfo.bounds.u0) * uJitter;
    const v =
      tileInfo.bounds.v0 + (tileInfo.bounds.v1 - tileInfo.bounds.v0) * vJitter;
    const direction = directionFromCubeFace(tileInfo.face, u, v);
    const probe = scale(direction, planet.radiusMeters);
    const surface = samplePlanetSurface(planet, planetSeed, probe);

    if (
      !acceptsSurface(layer, surface.biome, surface.normalizedHeight)
    ) {
      continue;
    }

    // Stochastic accept so density feels sparse at low values.
    const accept =
      hash01(seed, faceIndex, tileInfo.level, tileInfo.x, tileInfo.y, i, 71) <
      Math.min(1, 0.85 * Math.sqrt(Math.max(0.01, layer.density)));
    if (!accept) continue;

    const worldPosition: Vec3 = {
      x: direction.x * surface.surfaceRadiusMeters,
      y: direction.y * surface.surfaceRadiusMeters,
      z: direction.z * surface.surfaceRadiusMeters,
    };

    if (!canPlaceWithGap(placementGrid, worldPosition)) continue;
    registerPlacement(placementGrid, worldPosition);

    let normal: Vec3 = direction;
    if (layer.alignToNormal) {
      normal = normalize(
        sampleVisibleSurfaceFrame(planet, planetSeed, probe).normal,
      );
    }

    const yaw =
      hash01(seed, faceIndex, tileInfo.level, tileInfo.x, tileInfo.y, i, 47) *
      Math.PI *
      2;
    const scaleValue = lerp(
      layer.minScale,
      layer.maxScale,
      clamp01(hash01(seed, tileInfo.x, tileInfo.y, i, 83)),
    );

    instances.push({
      layerId: layer.id,
      position: worldPosition,
      normal,
      yawRadians: yaw,
      scale: scaleValue,
    });
  }

  return instances;
}

export function collectTileSurfaceSpawns(
  tileInfo: TileInfo,
  planet: Planet,
  planetSeed: number,
  layers: readonly PlanetSpawnLayer[],
): SurfaceSpawnInstance[] {
  const out: SurfaceSpawnInstance[] = [];
  for (const layer of layers) {
    out.push(
      ...collectLayerInstancesForTile(tileInfo, planet, planetSeed, layer),
    );
  }
  return out;
}

/** Re-classify helper for editor docs / tests. */
export function classifySpawnBiome(
  planet: Planet,
  seed: number,
  direction: Vec3,
): { biome: string; normalizedHeight: number } {
  const surface = samplePlanetSurface(planet, seed, scale(direction, planet.radiusMeters));
  return {
    biome: classifyBiome({
      heightMeters: surface.heightMeters,
      lakeWaterLevelMeters: surface.lakeWaterLevelMeters,
      moisture: surface.moisture,
      mountainRegion: surface.mountainRegion,
      normalizedHeight: surface.normalizedHeight,
      riverWaterLevelMeters: surface.riverWaterLevelMeters,
      temperature: surface.temperature,
    }),
    normalizedHeight: surface.normalizedHeight,
  };
}
