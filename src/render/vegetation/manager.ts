import * as THREE from 'three';
import type {
  Planet,
  TileInfo,
  VegetationCacheStats,
  VegetationSettings,
  Vec3,
} from '../../types';
import { distance } from '../../math/vec3';
import { MAX_LEVEL } from '../planet_tiles/domain/constants';
import { collectTilesNearPosition } from '../planet_tiles/domain/spawn_tiles';
import { loadVegetationTile, saveVegetationTile } from './cache/tile_cache';
import {
  configureGrassDistanceMeters,
  getGrassDistanceMeters,
  GRASS_RADIUS_UPDATE_MIN_MOVE_METERS,
  MAX_CACHED_VEGETATION_TILES,
  TREE_LOD_DISTANCE_METERS,
  TREE_LOD_UPDATE_MIN_MOVE_METERS,
  VEGETATION_BUILD_BUDGET_MS_PER_FRAME,
  VEGETATION_BUILD_BUDGET_PER_FRAME,
  VEGETATION_CACHE_STALE_FRAMES,
  VEGETATION_MIN_TILE_LEVEL,
} from './domain/constants';
import { tileKey } from './domain/hash';
import { collectLandingGroveData } from './domain/landing_grove_data';
import { collectTileVegetationData } from './domain/tile_data';
import type { StoredVegetationInstance, StoredVegetationTile } from './domain/storage';
import {
  isVegetationVisibleAtAltitude,
  selectVegetationTiles,
  shouldShowGrassOnTile,
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
  tileInfo: TileInfo | null;
  /** Preserved so grass-only setting tweaks can re-save without regenerating trees. */
  storedTrees: StoredVegetationInstance[];
  lastUsedFrame: number;
  status: 'loading-disk' | 'pending-build' | 'ready';
}

interface VegetationBuildJob {
  key: string;
  priority: number;
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
  let buildFocusPosition: Vec3 | null = null;
  let lastTreeLodFocus: Vec3 | null = null;
  let lastGrassFocus: Vec3 | null = null;
  let grassLayerVisible = true;
  let treesLayerVisible = true;
  /** Bumped on settings changes so in-flight IDB loads cannot apply stale tiles. */
  let settingsEpoch = 0;
  const treeLodUpdateMinMoveSq =
    TREE_LOD_UPDATE_MIN_MOVE_METERS * TREE_LOD_UPDATE_MIN_MOVE_METERS;
  const treeLodNearCheckRadius =
    TREE_LOD_DISTANCE_METERS + TREE_LOD_UPDATE_MIN_MOVE_METERS;
  const grassRadiusUpdateMinMoveSq =
    GRASS_RADIUS_UPDATE_MIN_MOVE_METERS * GRASS_RADIUS_UPDATE_MIN_MOVE_METERS;
  let resolveAssetsReady: (() => void) | null = null;
  const assetsReadyPromise = new Promise<void>((resolve) => {
    resolveAssetsReady = resolve;
  });

  loadInstancedAssetCatalog(
    (catalog) => {
      assets = catalog;
      assetsReady = true;
      resolveAssetsReady?.();
      resolveAssetsReady = null;
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
      tileInfo,
      storedTrees: data.trees,
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
      entry.tileInfo = tileInfo;
      entry.storedTrees = stored.trees;
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
    entry.tileInfo = tileInfo;
    entry.storedTrees = [];
    entry.status = 'pending-build';
    enqueueVegetationBuild(key, tileInfo);
  }

  function jobPriority(tileInfo: TileInfo): number {
    // Lower sorts first. Prefer nearer tiles, then finer LODs (grass).
    if (!buildFocusPosition) return 1_000_000 - tileInfo.level;
    return distance(tileInfo.centerPosition, buildFocusPosition) - tileInfo.level * 80;
  }

  function enqueueVegetationBuild(key: string, tileInfo: TileInfo): void {
    const priority = jobPriority(tileInfo);
    let insertAt = pendingBuildQueue.length;
    for (let i = 0; i < pendingBuildQueue.length; i += 1) {
      if (pendingBuildQueue[i].priority > priority) {
        insertAt = i;
        break;
      }
    }
    pendingBuildQueue.splice(insertAt, 0, { key, priority, tileInfo });
  }

  function isVegetationTileReady(key: string): boolean {
    const entry = tileCache.get(key);
    return entry?.status === 'ready';
  }

  function prefetchAround(
    position: Vec3,
    radiusMeters: number,
    options?: { maxStarts?: number; minLevel?: number; maxLevel?: number },
  ): string[] {
    buildFocusPosition = position;
    const tiles = collectTilesNearPosition(planet, position, {
      minLevel: options?.minLevel ?? Math.max(VEGETATION_MIN_TILE_LEVEL, 14),
      maxLevel: options?.maxLevel ?? MAX_LEVEL,
      radiusMeters,
    })
      .sort(
        (a, b) =>
          distance(a.centerPosition, position) -
          distance(b.centerPosition, position),
      )
      .slice(0, MAX_CACHED_VEGETATION_TILES);
    const keys: string[] = [];
    let starts = 0;
    for (const tileInfo of tiles) {
      const key = tileKey(tileInfo.face, tileInfo.level, tileInfo.x, tileInfo.y);
      keys.push(key);
      if (isVegetationTileReady(key) || tileCache.has(key) || diskLoadsInFlight.has(key)) {
        continue;
      }
      if (options?.maxStarts != null && starts >= options.maxStarts) continue;
      startVegetationDiskLoad(tileInfo);
      starts += 1;
    }
    return keys;
  }

  async function waitForAssets(timeoutMs = 15_000): Promise<boolean> {
    if (assetsReady) return true;
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
        if (isVegetationTileReady(key)) ready += 1;
      }
      if (ready >= keys.length) return ready;
      if (lastTreeLodFocus) drainBuildQueue(lastTreeLodFocus);
      await new Promise<void>((resolve) => {
        setTimeout(resolve, 16);
      });
    }
    let ready = 0;
    for (const key of keys) {
      if (isVegetationTileReady(key)) ready += 1;
    }
    return ready;
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
      tileInfo,
      storedTrees: [],
      lastUsedFrame: frameNumber,
      status: 'loading-disk',
    });
    diskLoadsInFlight.add(key);
    updateCachePeak();

    const epoch = settingsEpoch;
    const settingsForLoad = vegetationSettings;
    void loadVegetationTile(
      planet,
      seed,
      settingsForLoad,
      tileInfo.face,
      tileInfo.level,
      tileInfo.x,
      tileInfo.y,
    )
      .then((stored) => {
        diskLoadsInFlight.delete(key);
        if (epoch !== settingsEpoch) {
          // Grass/tree settings changed mid-flight; retry with the new hash.
          const entry = tileCache.get(key);
          if (entry?.status === 'loading-disk') {
            releaseTileEntry(key, entry, false);
            startVegetationDiskLoad(tileInfo);
          }
          return;
        }
        completeVegetationDiskLoad(key, tileInfo, stored);
      })
      .catch(() => {
        diskLoadsInFlight.delete(key);
        if (epoch !== settingsEpoch) {
          const entry = tileCache.get(key);
          if (entry?.status === 'loading-disk') {
            releaseTileEntry(key, entry, false);
            startVegetationDiskLoad(tileInfo);
          }
          return;
        }
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
    settingsEpoch += 1;
    rebuildLandingGrove();
    lastTreeLodFocus = null;
    buildFocusPosition = null;
    lastGrassFocus = null;

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

  function hasGrassFocusMoved(bodyPosition: Vec3): boolean {
    if (!lastGrassFocus) return true;
    const dx = bodyPosition.x - lastGrassFocus.x;
    const dy = bodyPosition.y - lastGrassFocus.y;
    const dz = bodyPosition.z - lastGrassFocus.z;
    return dx * dx + dy * dy + dz * dz >= grassRadiusUpdateMinMoveSq;
  }

  function updateGrassRadiusForVisible(
    bodyPosition: Vec3,
    selectedKeys: Set<string>,
    newlyVisibleKeys: Set<string>,
  ): void {
    const focusMoved = hasGrassFocusMoved(bodyPosition);
    if (!focusMoved && newlyVisibleKeys.size === 0) return;

    if (focusMoved) {
      lastGrassFocus = {
        x: bodyPosition.x,
        y: bodyPosition.y,
        z: bodyPosition.z,
      };
    }

    if (focusMoved || newlyVisibleKeys.has('landing-grove')) {
      if (
        distance(landingGrove.anchor, bodyPosition) < getGrassDistanceMeters() + 80
      ) {
        landingGrove.updateGrassRadius(bodyPosition);
      }
    }

    for (const key of selectedKeys) {
      if (!focusMoved && !newlyVisibleKeys.has(key)) continue;
      const entry = tileCache.get(key);
      if (entry?.status !== 'ready' || !entry.tileInfo) continue;
      if (!shouldShowGrassOnTile(entry.tileInfo, bodyPosition)) continue;
      entry.renderGroup.updateGrassRadius(bodyPosition);
    }
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
    if (!assetsReady) return;
    let budget = VEGETATION_BUILD_BUDGET_PER_FRAME;
    const deadlineMs = performance.now() + VEGETATION_BUILD_BUDGET_MS_PER_FRAME;
    while (budget > 0 && pendingBuildQueue.length > 0) {
      if (performance.now() >= deadlineMs) break;
      const job = pendingBuildQueue.shift()!;
      const entry = tileCache.get(job.key);
      if (!entry || entry.status !== 'pending-build') continue;
      const wasVisible = entry.group.visible;
      const renderGroup = buildAndCacheVegetation(job.tileInfo, job.key, wasVisible);
      renderGroup.setTreesVisible(treesLayerVisible);
      // Queued builds finish after the tile's "newly visible" frame, so refresh
      // tree LOD here or nearby trees stay as low-poly imposters until the
      // player moves again.
      if (
        treesLayerVisible &&
        shouldUpdateRenderGroupLod(renderGroup, bodyPosition)
      ) {
        renderGroup.updateTreeLod(bodyPosition);
      }
      if (
        grassLayerVisible &&
        shouldShowGrassOnTile(job.tileInfo, bodyPosition)
      ) {
        renderGroup.updateGrassRadius(bodyPosition);
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
    buildFocusPosition = bodyPosition;
    const selectedKeys = new Set<string>();
    const vegetationVisible =
      isVegetationVisibleAtAltitude(altitudeMeters) && assetsReady;

    if (vegetationVisible) {
      const decoratedTiles = selectVegetationTiles(
        planet,
        selectedTiles,
        bodyPosition,
        altitudeMeters,
        MAX_CACHED_VEGETATION_TILES,
      );

      for (const tileInfo of decoratedTiles) {
        const { renderGroup, key } = ensureVegetation(tileInfo);
        renderGroup.group.visible = true;
        renderGroup.setTreesVisible(treesLayerVisible);
        // Trees use the long veg radius; grass is near-field only.
        const showGrass =
          grassLayerVisible &&
          (shouldShowGrassOnTile(tileInfo, bodyPosition) ||
            distance(renderGroup.anchor, bodyPosition) <
              getGrassDistanceMeters() + tileInfo.spanMeters);
        renderGroup.setGrassVisible(showGrass);
        if (showGrass) renderGroup.updateGrassRadius(bodyPosition);
        selectedKeys.add(key);
      }
    }

    // Drain after enqueue so newly visible tiles can build the same frame.
    drainBuildQueue(bodyPosition);

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
      landingGrove.setTreesVisible(treesLayerVisible);
      const showGroveGrass =
        grassLayerVisible &&
        distance(landingGrove.anchor, bodyPosition) < getGrassDistanceMeters() + 80;
      landingGrove.setGrassVisible(showGroveGrass);
      if (showGroveGrass) landingGrove.updateGrassRadius(bodyPosition);
      if (grassLayerVisible) {
        updateGrassRadiusForVisible(bodyPosition, selectedKeys, newlyVisibleKeys);
      }
      if (treesLayerVisible) {
        updateTreeLodForVisible(bodyPosition, selectedKeys, newlyVisibleKeys);
      }
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
    const next = normalizeVegetationSettings(nextSettings);
    const unchanged =
      next.grass.density === vegetationSettings.grass.density &&
      next.grass.gapMeters === vegetationSettings.grass.gapMeters &&
      next.grass.minScale === vegetationSettings.grass.minScale &&
      next.grass.maxScale === vegetationSettings.grass.maxScale &&
      next.tree.density === vegetationSettings.tree.density &&
      next.tree.gapMeters === vegetationSettings.tree.gapMeters &&
      next.tree.minScale === vegetationSettings.tree.minScale &&
      next.tree.maxScale === vegetationSettings.tree.maxScale;
    vegetationSettings = next;
    if (!assetsReady || unchanged) return;
    rebuildEverything();
  }

  function setGrassRenderDistanceMeters(meters: number): void {
    const previous = getGrassDistanceMeters();
    configureGrassDistanceMeters(meters);
    if (getGrassDistanceMeters() === previous) return;
    // Force the next update to re-pack the near-field grass disk.
    lastGrassFocus = null;
  }

  function setLayerVisible(layers: { grass?: boolean; trees?: boolean }): void {
    if (layers.grass !== undefined && layers.grass !== grassLayerVisible) {
      grassLayerVisible = layers.grass;
      if (!grassLayerVisible) {
        landingGrove.setGrassVisible(false);
        for (const entry of tileCache.values()) {
          entry.renderGroup.setGrassVisible(false);
        }
      } else {
        lastGrassFocus = null;
      }
    }
    if (layers.trees !== undefined && layers.trees !== treesLayerVisible) {
      treesLayerVisible = layers.trees;
      landingGrove.setTreesVisible(treesLayerVisible);
      for (const entry of tileCache.values()) {
        entry.renderGroup.setTreesVisible(treesLayerVisible);
      }
      if (treesLayerVisible) lastTreeLodFocus = null;
    }
  }

  return {
    dispose,
    prefetchAround,
    setVisible(visible) {
      vegetationGroup.visible = visible;
    },
    setLayerVisible,
    setGrassRenderDistanceMeters,
    setSettings,
    update,
    waitForAssets,
    waitUntilReady,
  };
}
