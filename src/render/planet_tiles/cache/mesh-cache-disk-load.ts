import type { Planet, TileInfo } from '../../../types';
import {
  loadTerrainTile,
  type LoadedTerrainTile,
} from '../../../cache/terrain-tile-cache';
import { installHeightPage } from '../../../world/terrain-pages';
import type { TerrainGridRenderer } from '../render/terrain-grid-renderer';
import { MIN_LEVEL } from '../domain/constants';
import { parentTileInfo, tileKey } from '../domain/tile-info';
import type { ResolvedTile, TileMeshEntry } from '../domain/types';
import type { MeshCacheBuildOps } from './mesh-cache-build';

/** Fine underfoot LODs skip waiting on IDB before the worker starts. */
export const FAST_PATH_MIN_LEVEL = 15;

export interface MeshCacheDiskCtx {
  cacheStats: { diskHits: number; diskMisses: number };
  confirmedDiskMisses: Set<string>;
  diskLoadsInFlight: Set<string>;
  frameNumber: number;
  gridRenderer: TerrainGridRenderer;
  meshCache: Map<string, TileMeshEntry>;
  planet: Planet;
  seed: number;
}

export interface MeshCacheDiskOps {
  beginBudgetedSelectedTileLoad: (
    info: TileInfo,
    buildBudget: { remaining: number },
  ) => TileMeshEntry | undefined;
  beginSelectedTileLoad: (info: TileInfo) => void;
  completeTerrainDiskLoad: (
    key: string,
    info: TileInfo,
    loaded: LoadedTerrainTile | null,
  ) => void;
  peekTerrainDiskUpgrade: (info: TileInfo) => void;
  retainUnresolvedTile: (info: TileInfo, key: string) => void;
  startTerrainDiskLoad: (info: TileInfo) => void;
}

export function createMeshCacheDiskOps(
  ctx: MeshCacheDiskCtx,
  build: MeshCacheBuildOps,
): MeshCacheDiskOps {
  function updateCachePeak(): void {
    build.updateCachePeak();
  }

  function retainUnresolvedTile(info: TileInfo, key: string): void {
    const existing = ctx.meshCache.get(key);
    if (existing) {
      existing.info = info;
      existing.lastUsedFrame = ctx.frameNumber;
      existing.buildId = null;
      existing.status = 'pending';
      return;
    }
    ctx.meshCache.set(key, {
      buildId: null,
      info,
      lastUsedFrame: ctx.frameNumber,
      status: 'pending',
    });
    updateCachePeak();
  }

  function completeTerrainDiskLoad(
    key: string,
    info: TileInfo,
    loaded: LoadedTerrainTile | null,
  ): void {
    const entry = ctx.meshCache.get(key);
    if (!entry || entry.status !== 'loading-disk') return;

    if (loaded) {
      ctx.confirmedDiskMisses.delete(key);
      installHeightPage(loaded.raster);
      ctx.gridRenderer.installTile(info, loaded.raster, loaded.gridColors);
      entry.status = 'ready';
      ctx.cacheStats.diskHits += 1;
      updateCachePeak();
      return;
    }

    ctx.cacheStats.diskMisses += 1;
    if (build.hasWorkers() && info.level > 0) {
      ctx.meshCache.delete(key);
      build.queueTileBuild(info);
      return;
    }
    ctx.confirmedDiskMisses.add(key);
    entry.status = 'pending';
    entry.buildId = null;
    entry.lastUsedFrame = ctx.frameNumber;
  }

  function startTerrainDiskLoad(info: TileInfo): void {
    const key = tileKey(info.face, info.level, info.x, info.y);
    if (ctx.meshCache.has(key) || ctx.diskLoadsInFlight.has(key)) return;

    if (ctx.confirmedDiskMisses.has(key)) {
      if (build.hasWorkers() && info.level > 0) {
        build.queueTileBuild(info);
      } else if (build.maySyncBuild(info)) {
        build.queueSyncTileBuild(info);
      } else {
        retainUnresolvedTile(info, key);
      }
      return;
    }

    ctx.meshCache.set(key, {
      buildId: null,
      info,
      lastUsedFrame: ctx.frameNumber,
      status: 'loading-disk',
    });
    ctx.diskLoadsInFlight.add(key);
    updateCachePeak();

    void loadTerrainTile(ctx.planet, ctx.seed, info.face, info.level, info.x, info.y)
      .then((stored) => {
        ctx.diskLoadsInFlight.delete(key);
        completeTerrainDiskLoad(key, info, stored);
      })
      .catch(() => {
        ctx.diskLoadsInFlight.delete(key);
        completeTerrainDiskLoad(key, info, null);
      });
  }

  function peekTerrainDiskUpgrade(info: TileInfo): void {
    const key = tileKey(info.face, info.level, info.x, info.y);
    if (ctx.confirmedDiskMisses.has(key) || ctx.diskLoadsInFlight.has(key)) return;
    ctx.diskLoadsInFlight.add(key);
    void loadTerrainTile(ctx.planet, ctx.seed, info.face, info.level, info.x, info.y)
      .then((stored) => {
        ctx.diskLoadsInFlight.delete(key);
        const entry = ctx.meshCache.get(key);
        if (!entry || entry.status === 'ready') {
          if (stored) ctx.cacheStats.diskHits += 1;
          else ctx.cacheStats.diskMisses += 1;
          return;
        }
        if (!stored) {
          ctx.confirmedDiskMisses.add(key);
          ctx.cacheStats.diskMisses += 1;
          return;
        }
        ctx.confirmedDiskMisses.delete(key);
        build.discardPendingQueueForKey(key, entry.buildId ?? null);
        entry.buildId = null;
        installHeightPage(stored.raster);
        ctx.gridRenderer.installTile(info, stored.raster, stored.gridColors);
        entry.status = 'ready';
        entry.lastUsedFrame = ctx.frameNumber;
        ctx.cacheStats.diskHits += 1;
        updateCachePeak();
      })
      .catch(() => {
        ctx.diskLoadsInFlight.delete(key);
        ctx.confirmedDiskMisses.add(key);
        ctx.cacheStats.diskMisses += 1;
      });
  }

  function beginSelectedTileLoad(info: TileInfo): void {
    const key = tileKey(info.face, info.level, info.x, info.y);
    if (ctx.meshCache.has(key) || ctx.diskLoadsInFlight.has(key)) return;

    if (build.hasWorkers() && info.level >= FAST_PATH_MIN_LEVEL) {
      if (ctx.confirmedDiskMisses.has(key)) {
        build.queueTileBuild(info);
        return;
      }
      build.queueTileBuild(info);
      peekTerrainDiskUpgrade(info);
      return;
    }

    startTerrainDiskLoad(info);
  }

  function beginBudgetedSelectedTileLoad(
    info: TileInfo,
    buildBudget: { remaining: number },
  ): TileMeshEntry | undefined {
    const key = tileKey(info.face, info.level, info.x, info.y);
    const existing = ctx.meshCache.get(key);
    if (existing) {
      existing.lastUsedFrame = ctx.frameNumber;
      if (
        existing.status !== 'ready' &&
        existing.status !== 'loading-disk' &&
        build.maySyncBuild(info)
      ) {
        return build.tryBuildTileMeshSync(info, buildBudget) ?? existing;
      }
      return existing;
    }
    if (buildBudget.remaining <= 0) return undefined;

    buildBudget.remaining -= 1;
    beginSelectedTileLoad(info);
    return ctx.meshCache.get(key);
  }

  return {
    beginBudgetedSelectedTileLoad,
    beginSelectedTileLoad,
    completeTerrainDiskLoad,
    peekTerrainDiskUpgrade,
    retainUnresolvedTile,
    startTerrainDiskLoad,
  };
}

export interface MeshCacheResolveCtx {
  frameNumber: number;
  meshCache: Map<string, TileMeshEntry>;
  planet: Planet;
}

export interface MeshCacheResolveOps {
  requestBestAvailableTile: (
    info: TileInfo,
    buildBudget: { remaining: number },
  ) => ResolvedTile;
}

export function createMeshCacheResolveOps(
  ctx: MeshCacheResolveCtx,
  build: MeshCacheBuildOps,
  disk: MeshCacheDiskOps,
): MeshCacheResolveOps {
  function buildTileSearchChain(info: TileInfo): TileInfo[] {
    const searchChain: TileInfo[] = [];
    let current: TileInfo | null = info;
    while (current) {
      searchChain.push(current);
      current = parentTileInfo(current, ctx.planet);
    }
    return searchChain;
  }

  function resolvedTile(info: TileInfo, key: string, ready: boolean): ResolvedTile {
    return { info, key, ready };
  }

  function tryResolveTargetTile(
    target: TileInfo,
    targetKey: string,
    targetEntry: TileMeshEntry | undefined,
    buildBudget: { remaining: number },
  ): ResolvedTile | null {
    const targetReady = targetEntry?.status === 'ready';
    if (!targetEntry || targetEntry.status === 'loading-disk' || targetReady) {
      return targetReady ? resolvedTile(target, targetKey, true) : null;
    }
    if (!build.maySyncBuild(target)) {
      if (build.hasWorkers() && target.level > 0 && !targetEntry.buildId) {
        ctx.meshCache.delete(targetKey);
        if (buildBudget.remaining > 0) {
          buildBudget.remaining -= 1;
          build.queueTileBuild(target);
        }
      }
      return null;
    }
    const builtEntry = build.tryBuildTileMeshSync(target, buildBudget);
    return builtEntry?.status === 'ready'
      ? resolvedTile(target, targetKey, true)
      : null;
  }

  function findReadyAncestor(candidates: TileInfo[]): ResolvedTile | null {
    for (const candidate of candidates) {
      const key = tileKey(candidate.face, candidate.level, candidate.x, candidate.y);
      const entry = ctx.meshCache.get(key);
      if (entry?.status !== 'ready') continue;
      entry.lastUsedFrame = ctx.frameNumber;
      return resolvedTile(candidate, key, true);
    }
    return null;
  }

  function resolveFallbackTile(
    searchChain: TileInfo[],
    buildBudget: { remaining: number },
  ): ResolvedTile {
    const fallbackInfo = searchChain.find((candidate) => candidate.level <= MIN_LEVEL)
      ?? searchChain[searchChain.length - 1];
    const fallbackKey = tileKey(
      fallbackInfo.face,
      fallbackInfo.level,
      fallbackInfo.x,
      fallbackInfo.y,
    );
    const fallbackEntry = ctx.meshCache.get(fallbackKey);
    if (fallbackEntry?.status === 'ready') {
      fallbackEntry.lastUsedFrame = ctx.frameNumber;
      return resolvedTile(fallbackInfo, fallbackKey, true);
    }

    const fallbackQueuedInWorker =
      build.hasWorkers() &&
      fallbackEntry?.status === 'pending' &&
      fallbackEntry.buildId != null;
    const builtFallbackEntry =
      fallbackQueuedInWorker || !build.maySyncBuild(fallbackInfo)
        ? null
        : build.tryBuildTileMeshSync(fallbackInfo, buildBudget);
    if (builtFallbackEntry?.status === 'ready') {
      return resolvedTile(fallbackInfo, fallbackKey, true);
    }

    disk.startTerrainDiskLoad(fallbackInfo);
    return resolvedTile(fallbackInfo, fallbackKey, false);
  }

  function requestBestAvailableTile(
    info: TileInfo,
    buildBudget: { remaining: number },
  ): ResolvedTile {
    const searchChain = buildTileSearchChain(info);
    const target = searchChain[0];
    const targetKey = tileKey(target.face, target.level, target.x, target.y);
    let targetEntry = ctx.meshCache.get(targetKey);

    if (!targetEntry) {
      targetEntry = disk.beginBudgetedSelectedTileLoad(target, buildBudget);
    }
    const immediateParent = searchChain[1];
    if (targetEntry?.status !== 'ready' && immediateParent) {
      disk.beginBudgetedSelectedTileLoad(immediateParent, buildBudget);
    }
    if (targetEntry) targetEntry.lastUsedFrame = ctx.frameNumber;

    const targetResolved = tryResolveTargetTile(target, targetKey, targetEntry, buildBudget);
    if (targetResolved) return targetResolved;

    const ancestorResolved = findReadyAncestor(searchChain.slice(1));
    if (ancestorResolved) return ancestorResolved;

    return resolveFallbackTile(searchChain, buildBudget);
  }

  return { requestBestAvailableTile };
}
