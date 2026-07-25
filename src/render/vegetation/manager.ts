import * as THREE from 'three';
import type {
  Planet,
  TileInfo,
  VegetationCacheStats,
  VegetationSettings,
  Vec3,
} from '../../types';
import {
  configureGrassDistanceMeters,
  getGrassDistanceMeters,
  GRASS_RADIUS_UPDATE_MIN_MOVE_METERS,
  TREE_LOD_DISTANCE_METERS,
  TREE_LOD_UPDATE_MIN_MOVE_METERS,
} from './domain/constants';
import {
  createVegetationTileRuntime,
  type VegetationBuildJob,
  type VegetationTileEntry,
} from './cache/tile-runtime';
import {
  disposeInstancedAssets,
  loadInstancedAssetCatalog,
  type InstancedAssetCatalog,
} from './render/instanced-assets';
import { createVegetationFrameUpdate } from './render/frame-update';
import {
  createTreeLodAsset,
  disposeTreeLodAsset,
} from './render/tree-lod';
import {
  createEmptyVegetationRenderGroup,
  releaseVegetationGroup,
  type VegetationRenderGroup,
} from './render/vegetation-group';
import {
  DEFAULT_VEGETATION_SETTINGS,
  normalizeVegetationSettings,
  vegetationAssetUrlsEqual,
} from './settings';

interface VegetationCacheStatsAccumulator {
  diskHits: number;
  diskMisses: number;
  peakCachedTiles: number;
  totalBuilds: number;
  totalEvictions: number;
}

export interface PlanetVegetationManager {
  dispose: () => void;
  prefetchAround: (
    position: Vec3,
    radiusMeters: number,
    options?: { maxStarts?: number; minLevel?: number; maxLevel?: number },
  ) => string[];
  setVisible: (visible: boolean) => void;
  setLayerVisible: (layers: { grass?: boolean; trees?: boolean }) => void;
  setGrassRenderDistanceMeters: (meters: number) => void;
  setSettings: (nextSettings: Partial<VegetationSettings>) => void;
  update: (
    bodyPosition: Vec3,
    selectedTiles: TileInfo[],
    altitudeMeters: number,
    timeSeconds: number,
  ) => VegetationCacheStats;
  waitForAssets: (timeoutMs?: number) => Promise<boolean>;
  waitUntilReady: (keys: readonly string[], timeoutMs: number) => Promise<number>;
}

export function createPlanetVegetationManager(
  scene: THREE.Scene,
  planet: Planet,
  seed: number,
  renderScale: number,
  initialSettings: Partial<VegetationSettings> = DEFAULT_VEGETATION_SETTINGS,
): PlanetVegetationManager {
  const vegetationGroup = new THREE.Group();
  vegetationGroup.scale.setScalar(renderScale);
  scene.add(vegetationGroup);

  const treeLodAsset = createTreeLodAsset();
  let assets: InstancedAssetCatalog = { grass: [], trees: [] };
  let assetsReady = false;
  let vegetationSettings = normalizeVegetationSettings(initialSettings);
  let landingGrove: VegetationRenderGroup = createEmptyVegetationRenderGroup();
  const tileCache = new Map<string, VegetationTileEntry>();
  const activeKeys = new Set<string>();
  const cacheStats: VegetationCacheStatsAccumulator = {
    diskHits: 0,
    diskMisses: 0,
    peakCachedTiles: 0,
    totalBuilds: 0,
    totalEvictions: 0,
  };
  const diskLoadsInFlight = new Set<string>();
  const pendingBuildQueue: VegetationBuildJob[] = [];
  let grassLayerVisible = true;
  let treesLayerVisible = true;
  let settingsEpoch = 0;
  const treeLodUpdateMinMoveSq =
    TREE_LOD_UPDATE_MIN_MOVE_METERS * TREE_LOD_UPDATE_MIN_MOVE_METERS;
  const treeLodNearCheckRadius =
    TREE_LOD_DISTANCE_METERS + TREE_LOD_UPDATE_MIN_MOVE_METERS;
  const grassRadiusUpdateMinMoveSq =
    GRASS_RADIUS_UPDATE_MIN_MOVE_METERS * GRASS_RADIUS_UPDATE_MIN_MOVE_METERS;
  let resolveAssetsReady: (() => void) | null = null;
  let assetsReadyPromise = new Promise<void>((resolve) => {
    resolveAssetsReady = resolve;
  });
  let assetLoadGeneration = 0;
  let assetsLoading = false;

  const shared = {
    activeKeys,
    assets,
    assetsReady,
    buildFocusPosition: null as Vec3 | null,
    builtThisFrame: 0,
    cacheStats,
    diskLoadsInFlight,
    evictedThisFrame: 0,
    frameNumber: 0,
    grassLayerVisible,
    landingGrove,
    lastGrassFocus: null as Vec3 | null,
    lastTreeLodFocus: null as Vec3 | null,
    pendingBuildQueue,
    planet,
    seed,
    settingsEpoch,
    tileCache,
    treeLodAsset,
    treeLodNearCheckRadius,
    treesLayerVisible,
    vegetationGroup,
    vegetationSettings,
  };

  const tileRuntime = createVegetationTileRuntime(shared);

  function startAssetCatalogLoad(): void {
    const generation = ++assetLoadGeneration;
    const previousGrass = assets.grass;
    const previousTrees = assets.trees;
    assetsReady = false;
    assetsLoading = true;
    if (!resolveAssetsReady) {
      assetsReadyPromise = new Promise<void>((resolve) => {
        resolveAssetsReady = resolve;
      });
    }

    loadInstancedAssetCatalog(
      {
        grassUrls: vegetationSettings.grass.assetUrls,
        treeUrls: vegetationSettings.tree.assetUrls,
        grassColor: vegetationSettings.grass.color,
      },
      (catalog) => {
        if (generation !== assetLoadGeneration) {
          disposeInstancedAssets(catalog.grass);
          disposeInstancedAssets(catalog.trees);
          return;
        }
        settingsEpoch += 1;
        releaseVegetationGroup(vegetationGroup, shared.landingGrove.group);
        shared.landingGrove = createEmptyVegetationRenderGroup();
        landingGrove = shared.landingGrove;
        for (const [key, entry] of tileCache) {
          tileRuntime.releaseTileEntry(key, entry, false);
        }
        diskLoadsInFlight.clear();
        pendingBuildQueue.length = 0;
        activeKeys.clear();
        shared.lastTreeLodFocus = null;
        shared.buildFocusPosition = null;
        shared.lastGrassFocus = null;

        disposeInstancedAssets(previousGrass);
        disposeInstancedAssets(previousTrees);
        shared.assets = catalog;
        assets = catalog;
        shared.assetsReady = true;
        assetsReady = true;
        assetsLoading = false;
        resolveAssetsReady?.();
        resolveAssetsReady = null;
        tileRuntime.rebuildEverything();
      },
      (path, label, err) => {
        console.error(`Failed to load ${label} asset:`, path, err);
      },
    );
  }

  const frameUpdate = createVegetationFrameUpdate({
    ...shared,
    assetsLoading,
    countReadyEntries: tileRuntime.countReadyEntries,
    drainBuildQueue: tileRuntime.drainBuildQueue,
    evictVegetation: tileRuntime.evictVegetation,
    grassRadiusUpdateMinMoveSq,
    renderScale,
    resolveBestAvailableVegetation: tileRuntime.resolveBestAvailableVegetation,
    startAssetCatalogLoad,
    treeLodUpdateMinMoveSq,
  });

  async function waitForAssets(timeoutMs = 15_000): Promise<boolean> {
    if (assetsReady) return true;
    if (!assetsLoading) startAssetCatalogLoad();
    let settled = false;
    await Promise.race([
      assetsReadyPromise.then(() => {
        settled = true;
      }),
      new Promise<void>((resolve) => {
        setTimeout(resolve, timeoutMs);
      }),
    ]);
    return settled || assetsReady;
  }

  async function waitUntilReady(
    keys: readonly string[],
    timeoutMs: number,
  ): Promise<number> {
    if (keys.length === 0) return 0;
    await waitForAssets(Math.min(timeoutMs, 15_000));
    const deadline = performance.now() + Math.max(0, timeoutMs);
    while (performance.now() < deadline) {
      let ready = 0;
      for (const key of keys) {
        if (tileRuntime.isVegetationTileReady(key)) ready += 1;
      }
      if (ready >= keys.length) return ready;
      if (shared.lastTreeLodFocus) tileRuntime.drainBuildQueue(shared.lastTreeLodFocus);
      await new Promise<void>((resolve) => {
        setTimeout(resolve, 16);
      });
    }
    let ready = 0;
    for (const key of keys) {
      if (tileRuntime.isVegetationTileReady(key)) ready += 1;
    }
    return ready;
  }

  tileRuntime.rebuildLandingGrove();

  function dispose(): void {
    releaseVegetationGroup(vegetationGroup, shared.landingGrove.group);
    for (const [key, entry] of tileCache) {
      tileRuntime.releaseTileEntry(key, entry, false);
    }
    disposeInstancedAssets(assets.grass);
    disposeInstancedAssets(assets.trees);
    disposeTreeLodAsset(treeLodAsset);
    scene.remove(vegetationGroup);
  }

  function setSettings(nextSettings: Partial<VegetationSettings>): void {
    const next = normalizeVegetationSettings(nextSettings);
    const assetsChanged =
      !vegetationAssetUrlsEqual(
        next.grass.assetUrls,
        vegetationSettings.grass.assetUrls,
      ) ||
      !vegetationAssetUrlsEqual(
        next.tree.assetUrls,
        vegetationSettings.tree.assetUrls,
      ) ||
      next.grass.color !== vegetationSettings.grass.color;
    const numbersUnchanged =
      next.grass.density === vegetationSettings.grass.density &&
      next.grass.gapMeters === vegetationSettings.grass.gapMeters &&
      next.grass.minScale === vegetationSettings.grass.minScale &&
      next.grass.maxScale === vegetationSettings.grass.maxScale &&
      next.tree.density === vegetationSettings.tree.density &&
      next.tree.gapMeters === vegetationSettings.tree.gapMeters &&
      next.tree.minScale === vegetationSettings.tree.minScale &&
      next.tree.maxScale === vegetationSettings.tree.maxScale;
    shared.vegetationSettings = next;
    vegetationSettings = next;
    if (assetsChanged) {
      if (assetsReady || assetsLoading) startAssetCatalogLoad();
      return;
    }
    if (!assetsReady || numbersUnchanged) return;
    tileRuntime.rebuildEverything();
  }

  function setGrassRenderDistanceMeters(meters: number): void {
    const previous = getGrassDistanceMeters();
    configureGrassDistanceMeters(meters);
    if (getGrassDistanceMeters() === previous) return;
    shared.lastGrassFocus = null;
  }

  function setLayerVisible(layers: { grass?: boolean; trees?: boolean }): void {
    if (layers.grass !== undefined && layers.grass !== shared.grassLayerVisible) {
      shared.grassLayerVisible = layers.grass;
      grassLayerVisible = layers.grass;
      if (!grassLayerVisible) {
        shared.landingGrove.setGrassVisible(false);
        for (const entry of tileCache.values()) {
          entry.renderGroup.setGrassVisible(false);
        }
      } else {
        shared.lastGrassFocus = null;
      }
    }
    if (layers.trees !== undefined && layers.trees !== shared.treesLayerVisible) {
      shared.treesLayerVisible = layers.trees;
      treesLayerVisible = layers.trees;
      shared.landingGrove.setTreesVisible(treesLayerVisible);
      for (const entry of tileCache.values()) {
        entry.renderGroup.setTreesVisible(treesLayerVisible);
      }
      if (treesLayerVisible) shared.lastTreeLodFocus = null;
    }
  }

  return {
    dispose,
    prefetchAround: tileRuntime.prefetchAround,
    setVisible(visible) {
      vegetationGroup.visible = visible;
    },
    setLayerVisible,
    setGrassRenderDistanceMeters,
    setSettings,
    update(bodyPosition, selectedTiles, altitudeMeters, timeSeconds) {
      return frameUpdate.update(bodyPosition, selectedTiles, altitudeMeters, timeSeconds);
    },
    waitForAssets,
    waitUntilReady,
  };
}
