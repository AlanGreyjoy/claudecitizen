import type { Planet, TileInfo, VegetationSettings, Vec3 } from '../../../types';
import { distance } from '../../../math/vec3';
import { MAX_LEVEL } from '../../planet_tiles/domain/constants';
import { collectTilesNearPosition } from '../../planet_tiles/domain/spawn-tiles';
import { parentTileInfo } from '../../planet_tiles/domain/tile-info';
import { loadVegetationTile, saveVegetationTile } from './tile-cache';
import {
  MAX_CACHED_VEGETATION_TILES,
  VEGETATION_BUILD_BUDGET_MS_PER_FRAME,
  VEGETATION_BUILD_BUDGET_PER_FRAME,
  VEGETATION_CACHE_ACTIVE_HEADROOM,
  VEGETATION_CACHE_STALE_FRAMES,
  VEGETATION_MIN_TILE_LEVEL,
} from '../domain/constants';
import { tileKey } from '../domain/hash';
import { collectLandingGroveData } from '../domain/landing-grove-data';
import { collectTileVegetationData } from '../domain/tile-data';
import { createVegetationWorkerPool } from './tile-worker-pool';
import type { StoredVegetationInstance, StoredVegetationTile } from '../domain/storage';
import {
  shouldShowGrassOnTile,
} from '../domain/visibility';
import type { InstancedAssetCatalog } from '../render/instanced-assets';
import {
  createEmptyVegetationRenderGroup,
  createVegetationGroupFromStored,
  releaseVegetationGroup,
  type VegetationRenderGroup,
} from '../render/vegetation-group';

export interface VegetationTileEntry {
  group: import('three').Group;
  renderGroup: VegetationRenderGroup;
  tileInfo: TileInfo | null;
  storedTrees: StoredVegetationInstance[];
  lastUsedFrame: number;
  status: 'loading-disk' | 'pending-build' | 'ready';
}

export interface VegetationBuildJob {
  key: string;
  priority: number;
  tileInfo: TileInfo;
}

export interface VegetationTileRuntimeCtx {
  activeKeys: Set<string>;
  assets: InstancedAssetCatalog;
  assetsReady: boolean;
  buildFocusPosition: Vec3 | null;
  builtThisFrame: number;
  cacheStats: {
    diskHits: number;
    diskMisses: number;
    peakCachedTiles: number;
    totalBuilds: number;
    totalEvictions: number;
  };
  diskLoadsInFlight: Set<string>;
  evictedThisFrame: number;
  frameNumber: number;
  grassLayerVisible: boolean;
  landingGrove: VegetationRenderGroup;
  lastGrassFocus: Vec3 | null;
  lastTreeLodFocus: Vec3 | null;
  pendingBuildQueue: VegetationBuildJob[];
  planet: Planet;
  seed: number;
  settingsEpoch: number;
  tileCache: Map<string, VegetationTileEntry>;
  treeLodAsset: ReturnType<typeof import('../render/tree-lod').createTreeLodAsset>;
  treeLodNearCheckRadius: number;
  treesLayerVisible: boolean;
  vegetationGroup: import('three').Group;
  vegetationSettings: VegetationSettings;
}

export interface ResolvedVegetationTile {
  key: string;
  renderGroup: VegetationRenderGroup;
  tileInfo: TileInfo;
}

type ReleaseTileEntry = (key: string, entry: VegetationTileEntry) => void;

function evictVegetationTiles(
  ctx: VegetationTileRuntimeCtx,
  keepKeys: Set<string>,
  releaseTileEntry: ReleaseTileEntry,
): void {
  for (const [key, entry] of ctx.tileCache) {
    if (keepKeys.has(key)) continue;
    if (ctx.frameNumber - entry.lastUsedFrame > VEGETATION_CACHE_STALE_FRAMES) {
      releaseTileEntry(key, entry);
    }
  }

  const effectiveCacheLimit = Math.max(
    MAX_CACHED_VEGETATION_TILES,
    keepKeys.size + VEGETATION_CACHE_ACTIVE_HEADROOM,
  );
  if (ctx.tileCache.size <= effectiveCacheLimit) return;

  const focus = ctx.buildFocusPosition;
  const inactiveEntries: [string, VegetationTileEntry][] = [];
  for (const [key, entry] of ctx.tileCache) {
    if (keepKeys.has(key)) continue;
    inactiveEntries.push([key, entry]);
  }
  // Prefer dropping far corridor tiles first so a short walk reuses nearby
  // GPU meshes instead of thrashing LRU at the selection boundary.
  inactiveEntries.sort((a, b) => {
    if (!focus) return a[1].lastUsedFrame - b[1].lastUsedFrame;
    const aCenter = a[1].tileInfo?.centerPosition;
    const bCenter = b[1].tileInfo?.centerPosition;
    if (!aCenter && !bCenter) return a[1].lastUsedFrame - b[1].lastUsedFrame;
    if (!aCenter) return -1;
    if (!bCenter) return 1;
    const distDelta = distance(bCenter, focus) - distance(aCenter, focus);
    if (Math.abs(distDelta) > 1) return distDelta;
    return a[1].lastUsedFrame - b[1].lastUsedFrame;
  });

  for (const [key, entry] of inactiveEntries) {
    if (ctx.tileCache.size <= effectiveCacheLimit) break;
    releaseTileEntry(key, entry);
  }
}

export function createVegetationTileRuntime(ctx: VegetationTileRuntimeCtx) {
  let lastBuildFocus: Vec3 | null = null;

  function updateCachePeak(): void {
    ctx.cacheStats.peakCachedTiles = Math.max(
      ctx.cacheStats.peakCachedTiles,
      ctx.tileCache.size,
    );
  }

  function discardPendingBuild(key: string): void {
    for (let i = ctx.pendingBuildQueue.length - 1; i >= 0; i -= 1) {
      if (ctx.pendingBuildQueue[i].key === key) ctx.pendingBuildQueue.splice(i, 1);
    }
  }

  function releaseTileEntry(
    key: string,
    entry: VegetationTileEntry,
    countEviction = true,
  ): void {
    releaseVegetationGroup(ctx.vegetationGroup, entry.group);
    ctx.tileCache.delete(key);
    discardPendingBuild(key);
    if (!countEviction) return;
    ctx.cacheStats.totalEvictions += 1;
    ctx.evictedThisFrame += 1;
  }

  function countReadyEntries(): number {
    let count = 0;
    for (const entry of ctx.tileCache.values()) {
      if (entry.status === 'ready') count += 1;
    }
    return count;
  }

  function createRenderGroupFromStored(
    data: StoredVegetationTile,
  ): VegetationRenderGroup {
    return createVegetationGroupFromStored(
      data,
      ctx.assets.grass,
      ctx.assets.trees,
      ctx.treeLodAsset,
    );
  }

  /** Everything after generation: GPU group, cache entry, disk write, stats. */
  function installVegetationTile(
    tileInfo: TileInfo,
    key: string,
    visible: boolean,
    data: StoredVegetationTile,
  ): VegetationRenderGroup {
    const previous = ctx.tileCache.get(key);
    if (previous) releaseVegetationGroup(ctx.vegetationGroup, previous.group);

    const renderGroup = createRenderGroupFromStored(data);
    renderGroup.group.visible = visible;
    ctx.vegetationGroup.add(renderGroup.group);
    ctx.tileCache.set(key, {
      group: renderGroup.group,
      renderGroup,
      tileInfo,
      storedTrees: data.trees,
      lastUsedFrame: ctx.frameNumber,
      status: 'ready',
    });
    saveVegetationTile(
      ctx.planet,
      ctx.seed,
      ctx.vegetationSettings,
      tileInfo.face,
      tileInfo.level,
      tileInfo.x,
      tileInfo.y,
      data,
    );
    ctx.cacheStats.totalBuilds += 1;
    ctx.builtThisFrame += 1;
    updateCachePeak();
    return renderGroup;
  }

  function buildAndCacheVegetation(
    tileInfo: TileInfo,
    key: string,
    visible: boolean,
  ): VegetationRenderGroup {
    const data = collectTileVegetationData(
      tileInfo,
      ctx.planet,
      ctx.seed,
      ctx.assets,
      ctx.vegetationSettings,
    );
    return installVegetationTile(tileInfo, key, visible, data);
  }

  /** Refresh LOD/grass packing for a group that finished after its first frame. */
  function refreshFinishedGroup(
    renderGroup: VegetationRenderGroup,
    tileInfo: TileInfo,
    focus: Vec3,
  ): void {
    renderGroup.setTreesVisible(ctx.treesLayerVisible);
    if (ctx.treesLayerVisible && shouldUpdateRenderGroupLod(renderGroup, focus)) {
      renderGroup.updateTreeLod(focus);
    }
    if (ctx.grassLayerVisible && shouldShowGrassOnTile(tileInfo, focus)) {
      renderGroup.updateGrassRadius(focus);
    }
  }

  function completeVegetationDiskLoad(
    key: string,
    tileInfo: TileInfo,
    stored: StoredVegetationTile | null,
  ): void {
    const entry = ctx.tileCache.get(key);
    if (!entry || entry.status !== 'loading-disk') return;

    const wasVisible = entry.group.visible;
    releaseVegetationGroup(ctx.vegetationGroup, entry.group);

    if (stored) {
      const renderGroup = createRenderGroupFromStored(stored);
      renderGroup.group.visible = wasVisible;
      ctx.vegetationGroup.add(renderGroup.group);
      entry.group = renderGroup.group;
      entry.renderGroup = renderGroup;
      entry.tileInfo = tileInfo;
      entry.storedTrees = stored.trees;
      entry.status = 'ready';
      ctx.cacheStats.diskHits += 1;
      updateCachePeak();
      // Freshly restored tiles start with all trees as low-poly imposters and
      // would stay that way until the player moves; refresh against the last
      // known focus so nearby trees pop in at full detail immediately.
      if (
        ctx.lastTreeLodFocus &&
        shouldUpdateRenderGroupLod(renderGroup, ctx.lastTreeLodFocus)
      ) {
        renderGroup.updateTreeLod(ctx.lastTreeLodFocus);
      }
      return;
    }

    ctx.cacheStats.diskMisses += 1;
    // Rebuilds are expensive main-thread work (hundreds of surface samples per
    // tile); queue them against a per-frame budget instead of building inline,
    // which caused frame spikes whenever several tiles missed the disk cache.
    const placeholder = createEmptyVegetationRenderGroup();
    placeholder.group.visible = wasVisible;
    ctx.vegetationGroup.add(placeholder.group);
    entry.group = placeholder.group;
    entry.renderGroup = placeholder;
    entry.tileInfo = tileInfo;
    entry.storedTrees = [];
    entry.status = 'pending-build';
    enqueueVegetationBuild(key, tileInfo);
  }

  function jobPriority(tileInfo: TileInfo): number {
    // Lower sorts first. Prefer nearer tiles, then finer LODs (grass).
    if (!ctx.buildFocusPosition) return 1_000_000 - tileInfo.level;
    return distance(tileInfo.centerPosition, ctx.buildFocusPosition) - tileInfo.level * 80;
  }

  function enqueueVegetationBuild(key: string, tileInfo: TileInfo): void {
    const priority = jobPriority(tileInfo);
    let insertAt = ctx.pendingBuildQueue.length;
    for (let i = 0; i < ctx.pendingBuildQueue.length; i += 1) {
      if (ctx.pendingBuildQueue[i].priority > priority) {
        insertAt = i;
        break;
      }
    }
    ctx.pendingBuildQueue.splice(insertAt, 0, { key, priority, tileInfo });
  }

  function isVegetationTileReady(key: string): boolean {
    const entry = ctx.tileCache.get(key);
    return entry?.status === 'ready';
  }

  function prefetchAround(
    position: Vec3,
    radiusMeters: number,
    options?: { maxStarts?: number; minLevel?: number; maxLevel?: number },
  ): string[] {
    ctx.buildFocusPosition = position;
    const tiles = collectTilesNearPosition(ctx.planet, position, {
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
      if (isVegetationTileReady(key) || ctx.tileCache.has(key) || ctx.diskLoadsInFlight.has(key)) {
        continue;
      }
      if (options?.maxStarts != null && starts >= options.maxStarts) continue;
      startVegetationDiskLoad(tileInfo);
      starts += 1;
    }
    return keys;
  }

  function startVegetationDiskLoad(tileInfo: TileInfo): void {
    const key = tileKey(tileInfo.face, tileInfo.level, tileInfo.x, tileInfo.y);
    if (ctx.tileCache.has(key) || ctx.diskLoadsInFlight.has(key)) return;

    const placeholder = createEmptyVegetationRenderGroup();
    placeholder.group.visible = false;
    ctx.vegetationGroup.add(placeholder.group);
    ctx.tileCache.set(key, {
      group: placeholder.group,
      renderGroup: placeholder,
      tileInfo,
      storedTrees: [],
      lastUsedFrame: ctx.frameNumber,
      status: 'loading-disk',
    });
    ctx.diskLoadsInFlight.add(key);
    updateCachePeak();

    const epoch = ctx.settingsEpoch;
    const settingsForLoad = ctx.vegetationSettings;
    void loadVegetationTile(
      ctx.planet,
      ctx.seed,
      settingsForLoad,
      tileInfo.face,
      tileInfo.level,
      tileInfo.x,
      tileInfo.y,
    )
      .then((stored) => {
        ctx.diskLoadsInFlight.delete(key);
        if (epoch !== ctx.settingsEpoch) {
          // Grass/tree settings changed mid-flight; retry with the new hash.
          const entry = ctx.tileCache.get(key);
          if (entry?.status === 'loading-disk') {
            releaseTileEntry(key, entry, false);
            startVegetationDiskLoad(tileInfo);
          }
          return;
        }
        completeVegetationDiskLoad(key, tileInfo, stored);
      })
      .catch(() => {
        ctx.diskLoadsInFlight.delete(key);
        if (epoch !== ctx.settingsEpoch) {
          const entry = ctx.tileCache.get(key);
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
    releaseVegetationGroup(ctx.vegetationGroup, ctx.landingGrove.group);
    const data = collectLandingGroveData(ctx.planet, ctx.seed, ctx.assets, ctx.vegetationSettings);
    ctx.landingGrove = data
      ? createRenderGroupFromStored(data)
      : createEmptyVegetationRenderGroup();
    ctx.vegetationGroup.add(ctx.landingGrove.group);
  }

  function rebuildEverything(): void {
    ctx.settingsEpoch += 1;
    rebuildLandingGrove();
    ctx.lastTreeLodFocus = null;
    ctx.buildFocusPosition = null;
    ctx.lastGrassFocus = null;

    for (const [key, entry] of ctx.tileCache) {
      releaseTileEntry(key, entry, false);
    }
    ctx.diskLoadsInFlight.clear();
    ctx.pendingBuildQueue.length = 0;
    ctx.activeKeys.clear();
  }

  rebuildLandingGrove();

  function ensureVegetation(tileInfo: TileInfo): {
    renderGroup: VegetationRenderGroup;
    key: string;
  } {
    const key = tileKey(tileInfo.face, tileInfo.level, tileInfo.x, tileInfo.y);
    let entry = ctx.tileCache.get(key);
    if (entry?.status === 'ready') {
      entry.lastUsedFrame = ctx.frameNumber;
      return { renderGroup: entry.renderGroup, key };
    }

    if (entry?.status === 'loading-disk' || entry?.status === 'pending-build') {
      entry.lastUsedFrame = ctx.frameNumber;
      return { renderGroup: entry.renderGroup, key };
    }

    startVegetationDiskLoad(tileInfo);
    entry = ctx.tileCache.get(key);
    if (entry) {
      entry.lastUsedFrame = ctx.frameNumber;
      return { renderGroup: entry.renderGroup, key };
    }

    const renderGroup = buildAndCacheVegetation(tileInfo, key, false);
    return { renderGroup, key };
  }

  function resolveBestAvailableVegetation(
    tileInfo: TileInfo,
  ): ResolvedVegetationTile {
    const target = ensureVegetation(tileInfo);
    const targetEntry = ctx.tileCache.get(target.key);
    if (targetEntry?.status === 'ready') {
      return { ...target, tileInfo };
    }

    // Keep a ready parent visible while a finer vegetation tile loads/builds.
    // This mirrors terrain fallback and prevents whole square forests from
    // disappearing during a terrain LOD transition.
    let parent = parentTileInfo(tileInfo, ctx.planet);
    while (parent && parent.level >= VEGETATION_MIN_TILE_LEVEL) {
      const key = tileKey(parent.face, parent.level, parent.x, parent.y);
      const entry = ctx.tileCache.get(key);
      if (entry?.status === 'ready') {
        entry.lastUsedFrame = ctx.frameNumber;
        return { key, renderGroup: entry.renderGroup, tileInfo: parent };
      }
      parent = parentTileInfo(parent, ctx.planet);
    }

    return { ...target, tileInfo };
  }

  function shouldUpdateRenderGroupLod(
    renderGroup: VegetationRenderGroup,
    bodyPosition: Vec3,
  ): boolean {
    return renderGroup.hasTreeNearFocus(bodyPosition, ctx.treeLodNearCheckRadius);
  }

  function evictVegetation(keepKeys: Set<string>): void {
    evictVegetationTiles(ctx, keepKeys, releaseTileEntry);
  }

  const workerPool = createVegetationWorkerPool(ctx, {
    claimNextJob() {
      while (ctx.pendingBuildQueue.length > 0) {
        const job = ctx.pendingBuildQueue.shift()!;
        if (ctx.tileCache.get(job.key)?.status === 'pending-build') {
          return { key: job.key, tileInfo: job.tileInfo };
        }
      }
      return null;
    },
    install(key, tileInfo, data) {
      const entry = ctx.tileCache.get(key);
      if (!entry || entry.status !== 'pending-build') return;
      const renderGroup = installVegetationTile(tileInfo, key, entry.group.visible, data);
      if (lastBuildFocus) refreshFinishedGroup(renderGroup, tileInfo, lastBuildFocus);
    },
    requeue(key, tileInfo) {
      if (ctx.tileCache.get(key)?.status !== 'pending-build') return;
      enqueueVegetationBuild(key, tileInfo);
    },
  });

  function drainBuildQueue(bodyPosition: Vec3): void {
    if (!ctx.assetsReady) return;
    lastBuildFocus = bodyPosition;
    if (workerPool.hasWorkers()) {
      workerPool.dispatch();
      return;
    }

    let budget = VEGETATION_BUILD_BUDGET_PER_FRAME;
    const deadlineMs = performance.now() + VEGETATION_BUILD_BUDGET_MS_PER_FRAME;
    while (budget > 0 && ctx.pendingBuildQueue.length > 0) {
      if (performance.now() >= deadlineMs) break;
      const job = ctx.pendingBuildQueue.shift()!;
      const entry = ctx.tileCache.get(job.key);
      if (!entry || entry.status !== 'pending-build') continue;
      const wasVisible = entry.group.visible;
      const renderGroup = buildAndCacheVegetation(job.tileInfo, job.key, wasVisible);
      // Queued builds finish after the tile's "newly visible" frame, so refresh
      // tree LOD here or nearby trees stay as low-poly imposters until the
      // player moves again.
      refreshFinishedGroup(renderGroup, job.tileInfo, bodyPosition);
      budget -= 1;
    }
  }

  return {
    disposeWorkers: workerPool.dispose,
    buildAndCacheVegetation,
    countReadyEntries,
    discardPendingBuild,
    drainBuildQueue,
    ensureVegetation,
    enqueueVegetationBuild,
    evictVegetation,
    isVegetationTileReady,
    prefetchAround,
    rebuildEverything,
    rebuildLandingGrove,
    releaseTileEntry,
    resolveBestAvailableVegetation,
    startVegetationDiskLoad,
  };
}
