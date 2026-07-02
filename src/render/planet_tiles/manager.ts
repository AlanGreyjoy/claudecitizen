import * as THREE from 'three';
import type { Planet, PlanetSurfaceSample, TileInfo, Vec3 } from '../../types';
import {
  sampleRenderablePlanetSurface,
} from '../../world/planet_surface';
import { createTileMeshCache } from './cache/mesh_cache';
import { createTerrainMaterial } from './render/terrain_material';
import { createTerrainTextureArray } from './render/terrain_texture_array';
import {
  MAX_CACHED_TILES,
  PLANET_RENDER_SCALE,
  TILE_BUILD_BUDGET_PER_FRAME,
} from './domain/constants';
import { setFootSurfaceSampleLevel } from '../../world/foot_surface_level';
import { finestSelectedTileLevel } from './domain/tile_coverage';
import { visitSelectedTiles } from './domain/selection';
import type { TileManagerUpdateResult } from './domain/types';

export interface PlanetTileManager {
  dispose: () => void;
  renderScale: number;
  update: (bodyPosition: Vec3, surface?: PlanetSurfaceSample) => TileManagerUpdateResult;
}

export function createPlanetTileManager(
  scene: THREE.Scene,
  planet: Planet,
  seed: number,
): PlanetTileManager {
  const tileGroup = new THREE.Group();
  tileGroup.scale.setScalar(PLANET_RENDER_SCALE);
  scene.add(tileGroup);

  const terrainTextures = createTerrainTextureArray();
  const material = createTerrainMaterial(terrainTextures);

  const meshCache = createTileMeshCache({
    material,
    planet,
    seed,
    tileGroup,
  });

  const activeKeys = new Set<string>();
  let frameNumber = 0;

  function update(
    bodyPosition: Vec3,
    surface: PlanetSurfaceSample = sampleRenderablePlanetSurface(planet, seed, bodyPosition),
  ): TileManagerUpdateResult {
    frameNumber += 1;
    meshCache.setFrameNumber(frameNumber);
    meshCache.resetFrameCounters();
    const buildBudget = { remaining: TILE_BUILD_BUDGET_PER_FRAME };
    const selectedKeys = new Set<string>();
    const selectedTiles: TileInfo[] = [];

    visitSelectedTiles(planet, bodyPosition, surface.altitudeMeters, (info) => {
      const resolved = meshCache.requestBestAvailableTile(info, buildBudget);
      if (!resolved.mesh) return;
      resolved.mesh.visible = true;
      if (!selectedKeys.has(resolved.key)) {
        selectedTiles.push(resolved.info);
      }
      selectedKeys.add(resolved.key);
    });

    const footLevel = finestSelectedTileLevel(selectedTiles, bodyPosition);
    if (footLevel > 0) {
      setFootSurfaceSampleLevel(footLevel);
    }

    meshCache.hideInactiveMeshes(selectedKeys, activeKeys);

    activeKeys.clear();
    for (const key of selectedKeys) activeKeys.add(key);
    meshCache.evictTileMeshes(selectedKeys);

    tileGroup.position.set(
      -bodyPosition.x * PLANET_RENDER_SCALE,
      -bodyPosition.y * PLANET_RENDER_SCALE,
      -bodyPosition.z * PLANET_RENDER_SCALE,
    );

    const cacheStats = meshCache.stats();
    const frameStats = meshCache.snapshotFrameStats();
    return {
      selectedTiles,
      stats: {
        activeTiles: selectedTiles.length,
        builtThisFrame: frameStats.builtThisFrame,
        cacheLimit: MAX_CACHED_TILES,
        cachedTiles: meshCache.countEntries('ready'),
        diskHits: cacheStats.diskHits,
        diskMisses: cacheStats.diskMisses,
        evictedThisFrame: frameStats.evictedThisFrame,
        peakCachedTiles: cacheStats.peakCachedTiles,
        pendingTiles: meshCache.countEntries('pending'),
        queuedThisFrame: frameStats.queuedThisFrame,
        totalBuilds: cacheStats.totalBuilds,
        totalEvictions: cacheStats.totalEvictions,
        workerBuildsEnabled: meshCache.isWorkerEnabled(),
        workerErrors: cacheStats.workerErrors,
      },
      surface,
    };
  }

  function dispose(): void {
    meshCache.dispose();
    material.dispose();
    terrainTextures.dispose();
    scene.remove(tileGroup);
  }

  return {
    dispose,
    renderScale: PLANET_RENDER_SCALE,
    update,
  };
}
