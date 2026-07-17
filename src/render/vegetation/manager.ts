import * as THREE from 'three';
import type {
  Planet,
  TileInfo,
  VegetationCacheStats,
  VegetationSettings,
  Vec3,
} from '../../types';
import { loadVegetationTile, saveVegetationTile } from './cache/tile_cache';
import {
  MAX_CACHED_VEGETATION_TILES,
  TREE_LOD_DISTANCE_METERS,
  TREE_LOD_UPDATE_MIN_MOVE_METERS,
  VEGETATION_BUILD_BUDGET_PER_FRAME,
  VEGETATION_CACHE_STALE_FRAMES,
} from './domain/constants';
import { tileKey } from './domain/hash';
import { collectLandingGroveData } from './domain/landing_grove_data';
import { collectTileVegetationData } from './domain/tile_data';
import type { StoredVegetationTile } from './domain/storage';
import {
  isVegetationVisibleAtAltitude,
  shouldDecorateTile,
} from './domain/visibility';
import {
  disposeInstancedAssets,
  loadInstancedAssetCatalog,
  type InstancedAssetCatalog,
} from './render/instanced_assets';
import {
  createTreeLodAsset,
  disposeTreeLodAsset,
} from './render/tree_lod';
import { updateVegetationWind } from './render/wind';
import {
  createEmptyVegetationRenderGroup,
  createVegetationGroupFromStored,
  releaseVegetationGroup,
  type VegetationRenderGroup,
} from './render/vegetation_group';
import {
  DEFAULT_VEGETATION_SETTINGS,
  normalizeVegetationSettings,
} from './settings';

interface VegetationTileEntry {
  group: THREE.Group;
  renderGroup: VegetationRenderGroup;
  lastUsedFrame: number;
  status: 'loading-disk' | 'pending-build' | 'ready';
}

interface VegetationBuildJob {
  key: string;
  tileInfo: TileInfo;
}

interface VegetationCacheStatsAccumulator {
  diskHits: number;
  diskMisses: number;
  peakCachedTiles: number;
  totalBuilds: number;
  totalEvictions: number;
}

export interface PlanetVegetationManager {
  dispose: () => void;
  setVisible: (visible: boolean) => void;
  setSettings: (nextSettings: Partial<VegetationSettings>) => void;
  update: (
    bodyPosition: Vec3,
    selectedTiles: TileInfo[],
    altitudeMeters: number,
    timeSeconds: number,
  ) => VegetationCacheStats;
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
  let landingGrove = createEmptyVegetationRenderGroup();
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
  let builtThisFrame = 0;
  let evictedThisFrame = 0;
  let frameNumber = 0;
  let lastTreeLodFocus: Vec3 | null = null;
  const treeLodUpdateMinMoveSq =
    TREE_LOD_UPDATE_MIN_MOVE_METERS * TREE_LOD_UPDATE_MIN_MOVE_METERS;
  const treeLodNearCheckRadius =
    TREE_LOD_DISTANCE_METERS + TREE_LOD_UPDATE_MIN_MOVE_METERS;

  loadInstancedAssetCatalog(
    (catalog) => {
      assets = catalog;
      assetsReady = true;
      rebuildEverything();
    },
    (path, label, err) => {
      console.error(`Failed to load ${label} asset:`, path, err);
    },
  );

  function updateCachePeak(): void {
    cacheStats.peakCachedTiles = Math.max(
      cacheStats.peakCachedTiles,
      tileCache.size,
    );
  }

  function discardPendingBuild(key: string): void {
    for (let i = pendingBuildQueue.length - 1; i >= 0; i -= 1) {
      if (pendingBuildQueue[i].key === key) pendingBuildQueue.splice(i, 1);
    }
  }

  function releaseTileEntry(
    key: string,
    entry: VegetationTileEntry,
    countEviction = true,
  ): void {
    releaseVegetationGroup(vegetationGroup, entry.group);
    tileCache.delete(key);
    discardPendingBuild(key);
    if (!countEviction) return;
    cacheStats.totalEvictions += 1;
    evictedThisFrame += 1;
  }

  function countReadyEntries(): number {
    let count = 0;
    for (const entry of tileCache.values()) {
      if (entry.status === 'ready') count += 1;
    }
    return count;
  }

  function createRenderGroupFromStored(
    data: StoredVegetationTile,
  ): VegetationRenderGroup {
    return createVegetationGroupFromStored(
      data,
      assets.grass,
      assets.trees,
      treeLodAsset,
    );
  }

  function buildAndCacheVegetation(
    tileInfo: TileInfo,
    key: string,
    visible: boolean,
  ): VegetationRenderGroup {
    const previous = tileCache.get(key);
    if (previous) releaseVegetationGroup(vegetationGroup, previous.group);

    const data = collectTileVegetationData(
      tileInfo,
      planet,
      seed,
      assets,
      vegetationSettings,
    );
    const renderGroup = createRenderGroupFromStored(data);
    renderGroup.group.visible = visible;
    vegetationGroup.add(renderGroup.group);
    tileCache.set(key, {
      group: renderGroup.group,
      renderGroup,
      lastUsedFrame: frameNumber,
      status: 'ready',
    });
    saveVegetationTile(
      planet,
      seed,
      vegetationSettings,
      tileInfo.face,
      tileInfo.level,
      tileInfo.x,
      tileInfo.y,
      data,
    );
    cacheStats.totalBuilds += 1;
    builtThisFrame += 1;
    updateCachePeak();
    return renderGroup;
  }

  function completeVegetationDiskLoad(
    key: string,
    tileInfo: TileInfo,
    stored: StoredVegetationTile | null,
  ): void {
    const entry = tileCache.get(key);
    if (!entry || entry.status !== 'loading-disk') return;

    const wasVisible = entry.group.visible;
    releaseVegetationGroup(vegetationGroup, entry.group);

    if (stored) {
      const renderGroup = createRenderGroupFromStored(stored);
      renderGroup.group.visible = wasVisible;
      vegetationGroup.add(renderGroup.group);
      entry.group = renderGroup.group;
      entry.renderGroup = renderGroup;
      entry.status = 'ready';
      cacheStats.diskHits += 1;
      updateCachePeak();
      // Freshly restored tiles start with all trees as low-poly imposters and
      // would stay that way until the player moves; refresh against the last
      // known focus so nearby trees pop in at full detail immediately.
      if (
        lastTreeLodFocus &&
        shouldUpdateRenderGroupLod(renderGroup, lastTreeLodFocus)
      ) {
        renderGroup.updateTreeLod(lastTreeLodFocus);
      }
      return;
    }

    cacheStats.diskMisses += 1;
    // Rebuilds are expensive main-thread work (hundreds of surface samples per
    // tile); queue them against a per-frame budget instead of building inline,
    // which caused frame spikes whenever several tiles missed the disk cache.
    const placeholder = createEmptyVegetationRenderGroup();
    placeholder.group.visible = wasVisible;
    vegetationGroup.add(placeholder.group);
    entry.group = placeholder.group;
    entry.renderGroup = placeholder;
    entry.status = 'pending-build';
    pendingBuildQueue.push({ key, tileInfo });
  }

  function startVegetationDiskLoad(tileInfo: TileInfo): void {
    const key = tileKey(tileInfo.face, tileInfo.level, tileInfo.x, tileInfo.y);
    if (tileCache.has(key) || diskLoadsInFlight.has(key)) return;

    const placeholder = createEmptyVegetationRenderGroup();
    placeholder.group.visible = false;
    vegetationGroup.add(placeholder.group);
    tileCache.set(key, {
      group: placeholder.group,
      renderGroup: placeholder,
      lastUsedFrame: frameNumber,
      status: 'loading-disk',
    });
    diskLoadsInFlight.add(key);
    updateCachePeak();

    void loadVegetationTile(
      planet,
      seed,
      vegetationSettings,
      tileInfo.face,
      tileInfo.level,
      tileInfo.x,
      tileInfo.y,
    )
      .then((stored) => {
        diskLoadsInFlight.delete(key);
        completeVegetationDiskLoad(key, tileInfo, stored);
      })
      .catch(() => {
        diskLoadsInFlight.delete(key);
        completeVegetationDiskLoad(key, tileInfo, null);
      });
  }

  function rebuildLandingGrove(): void {
    releaseVegetationGroup(vegetationGroup, landingGrove.group);
    const data = collectLandingGroveData(planet, seed, assets, vegetationSettings);
    landingGrove = data
      ? createRenderGroupFromStored(data)
      : createEmptyVegetationRenderGroup();
    vegetationGroup.add(landingGrove.group);
  }

  function rebuildEverything(): void {
    rebuildLandingGrove();
    lastTreeLodFocus = null;

    for (const [key, entry] of tileCache) {
      releaseTileEntry(key, entry, false);
    }
    diskLoadsInFlight.clear();
    pendingBuildQueue.length = 0;
    activeKeys.clear();
  }

  rebuildLandingGrove();

  function ensureVegetation(tileInfo: TileInfo): {
    renderGroup: VegetationRenderGroup;
    key: string;
  } {
    const key = tileKey(tileInfo.face, tileInfo.level, tileInfo.x, tileInfo.y);
    let entry = tileCache.get(key);
    if (entry?.status === 'ready') {
      entry.lastUsedFrame = frameNumber;
      return { renderGroup: entry.renderGroup, key };
    }

    if (entry?.status === 'loading-disk' || entry?.status === 'pending-build') {
      entry.lastUsedFrame = frameNumber;
      return { renderGroup: entry.renderGroup, key };
    }

    startVegetationDiskLoad(tileInfo);
    entry = tileCache.get(key);
    if (entry) {
      entry.lastUsedFrame = frameNumber;
      return { renderGroup: entry.renderGroup, key };
    }

    const renderGroup = buildAndCacheVegetation(tileInfo, key, false);
    return { renderGroup, key };
  }

  function shouldUpdateRenderGroupLod(
    renderGroup: VegetationRenderGroup,
    bodyPosition: Vec3,
  ): boolean {
    return renderGroup.hasTreeNearFocus(bodyPosition, treeLodNearCheckRadius);
  }

  function hasTreeLodFocusMoved(bodyPosition: Vec3): boolean {
    if (!lastTreeLodFocus) return true;

    const dx = bodyPosition.x - lastTreeLodFocus.x;
    const dy = bodyPosition.y - lastTreeLodFocus.y;
    const dz = bodyPosition.z - lastTreeLodFocus.z;
    return dx * dx + dy * dy + dz * dz >= treeLodUpdateMinMoveSq;
  }

  function updateTreeLodForVisible(
    bodyPosition: Vec3,
    selectedKeys: Set<string>,
    newlyVisibleKeys: Set<string>,
  ): void {
    const focusMoved = hasTreeLodFocusMoved(bodyPosition);
    if (!focusMoved && newlyVisibleKeys.size === 0) return;

    if (focusMoved) {
      lastTreeLodFocus = {
        x: bodyPosition.x,
        y: bodyPosition.y,
        z: bodyPosition.z,
      };
    }

    const updateLandingGrove =
      focusMoved || newlyVisibleKeys.has('landing-grove');
    if (
      updateLandingGrove &&
      shouldUpdateRenderGroupLod(landingGrove, bodyPosition)
    ) {
      landingGrove.updateTreeLod(bodyPosition);
    }

    for (const key of selectedKeys) {
      if (!focusMoved && !newlyVisibleKeys.has(key)) continue;

      const entry = tileCache.get(key);
      if (entry?.status !== 'ready') continue;
      if (!shouldUpdateRenderGroupLod(entry.renderGroup, bodyPosition)) continue;
      entry.renderGroup.updateTreeLod(bodyPosition);
    }
  }

  function evictVegetation(selectedKeys: Set<string>): void {
    for (const [key, entry] of tileCache) {
      if (selectedKeys.has(key)) continue;
      if (frameNumber - entry.lastUsedFrame > VEGETATION_CACHE_STALE_FRAMES) {
        releaseTileEntry(key, entry);
      }
    }

    if (tileCache.size <= MAX_CACHED_VEGETATION_TILES) return;

    const inactiveEntries: [string, VegetationTileEntry][] = [];
    for (const [key, entry] of tileCache) {
      if (selectedKeys.has(key)) continue;
      inactiveEntries.push([key, entry]);
    }
    inactiveEntries.sort((a, b) => a[1].lastUsedFrame - b[1].lastUsedFrame);

    for (const [key, entry] of inactiveEntries) {
      if (tileCache.size <= MAX_CACHED_VEGETATION_TILES) break;
      releaseTileEntry(key, entry);
    }
  }

  function drainBuildQueue(bodyPosition: Vec3): void {
    let budget = VEGETATION_BUILD_BUDGET_PER_FRAME;
    while (budget > 0 && pendingBuildQueue.length > 0) {
      const job = pendingBuildQueue.shift()!;
      const entry = tileCache.get(job.key);
      if (!entry || entry.status !== 'pending-build') continue;
      const wasVisible = entry.group.visible;
      const renderGroup = buildAndCacheVegetation(job.tileInfo, job.key, wasVisible);
      // Queued builds finish after the tile's "newly visible" frame, so refresh
      // tree LOD here or nearby trees stay as low-poly imposters until the
      // player moves again.
      if (shouldUpdateRenderGroupLod(renderGroup, bodyPosition)) {
        renderGroup.updateTreeLod(bodyPosition);
      }
      budget -= 1;
    }
  }

  function update(
    bodyPosition: Vec3,
    selectedTiles: TileInfo[],
    altitudeMeters: number,
    timeSeconds: number,
  ): VegetationCacheStats {
    frameNumber += 1;
    updateVegetationWind(timeSeconds);
    builtThisFrame = 0;
    evictedThisFrame = 0;
    drainBuildQueue(bodyPosition);
    const selectedKeys = new Set<string>();
    const vegetationVisible =
      isVegetationVisibleAtAltitude(altitudeMeters) && assetsReady;

    if (vegetationVisible) {
      for (const tileInfo of selectedTiles) {
        if (!shouldDecorateTile(tileInfo, bodyPosition, altitudeMeters))
          continue;
        const { renderGroup, key } = ensureVegetation(tileInfo);
        renderGroup.group.visible = true;
        selectedKeys.add(key);
      }
    }

    for (const key of activeKeys) {
      if (selectedKeys.has(key)) continue;
      const entry = tileCache.get(key);
      if (entry) entry.group.visible = false;
    }

    const newlyVisibleKeys = new Set<string>();
    for (const key of selectedKeys) {
      if (!activeKeys.has(key)) newlyVisibleKeys.add(key);
    }
    const landingGroveWasHidden = !activeKeys.has('landing-grove');
    if (vegetationVisible && landingGroveWasHidden) {
      newlyVisibleKeys.add('landing-grove');
    }

    activeKeys.clear();
    for (const key of selectedKeys) activeKeys.add(key);
    if (vegetationVisible) activeKeys.add('landing-grove');
    evictVegetation(selectedKeys);

    vegetationGroup.position.set(
      -bodyPosition.x * renderScale,
      -bodyPosition.y * renderScale,
      -bodyPosition.z * renderScale,
    );

    if (vegetationVisible) {
      updateTreeLodForVisible(bodyPosition, selectedKeys, newlyVisibleKeys);
    }

    return {
      activeTiles: selectedKeys.size,
      builtThisFrame,
      cacheLimit: MAX_CACHED_VEGETATION_TILES,
      cachedTiles: countReadyEntries(),
      diskHits: cacheStats.diskHits,
      diskMisses: cacheStats.diskMisses,
      evictedThisFrame,
      peakCachedTiles: cacheStats.peakCachedTiles,
      totalBuilds: cacheStats.totalBuilds,
      totalEvictions: cacheStats.totalEvictions,
    };
  }

  function dispose(): void {
    releaseVegetationGroup(vegetationGroup, landingGrove.group);
    for (const [key, entry] of tileCache) {
      releaseTileEntry(key, entry, false);
    }
    disposeInstancedAssets(assets.grass);
    disposeInstancedAssets(assets.trees);
    disposeTreeLodAsset(treeLodAsset);
    scene.remove(vegetationGroup);
  }

  function setSettings(nextSettings: Partial<VegetationSettings>): void {
    vegetationSettings = normalizeVegetationSettings(nextSettings);
    if (assetsReady) rebuildEverything();
  }

  return {
    dispose,
    setVisible(visible) {
      vegetationGroup.visible = visible;
    },
    setSettings,
    update,
  };
}
