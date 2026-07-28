import type * as THREE from 'three';
import type { Planet, TileInfo, Vec3 } from '../../../types';
import { distance } from '../../../math/vec3';
import { CUBE_FACES } from '../../../world/cube-sphere';
import {
  MAX_CACHED_TILES,
  TILE_CACHE_ACTIVE_HEADROOM,
  TILE_CACHE_STALE_FRAMES,
} from '../domain/constants';
import { makeTileInfo, tileKey } from '../domain/tile-info';
import type {
  PendingBuildJob,
  TileCacheStatsAccumulator,
  TileEntryStatus,
  TileFrameCounters,
  TileMeshEntry,
} from '../domain/types';
import { createTileBuildWorkers } from '../worker/create-worker';
import {
  createMeshCacheBuildOps,
  SYNC_TILE_BUILD_BUDGET_PER_FRAME,
  type MeshCacheBuildCtx,
  type WorkerSlot,
} from './mesh-cache-build';
import {
  createMeshCacheDiskOps,
  createMeshCacheResolveOps,
} from './mesh-cache-disk-load';

/** Focus travel that justifies re-scoring and re-sorting the pending queue. */
const RESORT_FOCUS_MOVE_METERS = 120;

export interface BuildBudget {
  remaining: number;
}

export interface TileMeshCache {
  countEntries: (status: TileEntryStatus) => number;
  dispose: () => void;
  entryCount: () => number;
  evictTileMeshes: (selectedKeys: Set<string>) => void;
  hideInactiveMeshes: (activeKeys: Set<string>, previousActiveKeys: Set<string>) => void;
  isTileReady: (key: string) => boolean;
  isWorkerEnabled: () => boolean;
  prefetchTiles: (tiles: readonly TileInfo[]) => string[];
  requestBestAvailableTile: (
    info: TileInfo,
    buildBudget: BuildBudget,
  ) => import('../domain/types').ResolvedTile;
  resetFrameCounters: () => void;
  setFocusPosition: (position: Vec3) => void;
  setFrameNumber: (frame: number) => void;
  snapshotFrameStats: () => TileFrameCounters;
  stats: () => TileCacheStatsAccumulator;
  waitUntilReady: (keys: readonly string[], timeoutMs: number) => Promise<number>;
}

interface TileMeshCacheOptions {
  material: THREE.MeshLambertMaterial;
  planet: Planet;
  seed: number;
  tileGroup: THREE.Group;
}

export function createTileMeshCache(options: TileMeshCacheOptions): TileMeshCache {
  const { material, planet, seed, tileGroup } = options;

  const meshCache = new Map<string, TileMeshEntry>();
  const cacheStats: TileCacheStatsAccumulator = {
    buildMsAverage: 0,
    buildMsPeak: 0,
    diskHits: 0,
    diskMisses: 0,
    peakCachedTiles: 0,
    totalBuilds: 0,
    totalEvictions: 0,
    workerErrors: 0,
  };
  const diskLoadsInFlight = new Set<string>();
  const confirmedDiskMisses = new Set<string>();
  const pendingBuildQueue: PendingBuildJob[] = [];
  const workerPool: WorkerSlot[] = createTileBuildWorkers().map((worker) => ({
    busy: false,
    worker,
  }));

  const buildCtx: MeshCacheBuildCtx = {
    builtThisFrame: 0,
    cacheStats,
    completedSinceLastUpdate: 0,
    confirmedDiskMisses,
    evictedThisFrame: 0,
    focusPosition: null,
    frameNumber: 0,
    material,
    meshCache,
    nextBuildId: 1,
    pendingBuildQueue,
    planet,
    queuedThisFrame: 0,
    seed,
    syncBuildBudgetRemaining: SYNC_TILE_BUILD_BUDGET_PER_FRAME,
    tileGroup,
    workerAlive: false,
    workerLivenessTimer: null,
    workerPool,
  };

  const build = createMeshCacheBuildOps(buildCtx);
  const disk = createMeshCacheDiskOps(
    {
      cacheStats,
      confirmedDiskMisses,
      diskLoadsInFlight,
      get frameNumber() { return buildCtx.frameNumber; },
      material,
      meshCache,
      planet,
      seed,
      tileGroup,
    },
    build,
  );
  const resolve = createMeshCacheResolveOps(
    {
      get frameNumber() { return buildCtx.frameNumber; },
      meshCache,
      planet,
    },
    build,
    disk,
  );

  function countEntries(status: TileEntryStatus): number {
    let count = 0;
    for (const entry of meshCache.values()) {
      if (entry.status === status) count += 1;
    }
    return count;
  }

  function isTileReady(key: string): boolean {
    const entry = meshCache.get(key);
    return Boolean(entry?.mesh && entry.status === 'ready');
  }

  function prefetchTiles(tiles: readonly TileInfo[]): string[] {
    const keys: string[] = [];
    const softCap = Math.max(8, Math.floor(MAX_CACHED_TILES * 0.8));
    let started = 0;
    const maxStarts = 40;
    for (const info of tiles) {
      const key = tileKey(info.face, info.level, info.x, info.y);
      keys.push(key);
      if (isTileReady(key)) continue;
      const entry = meshCache.get(key);
      if (entry) {
        entry.lastUsedFrame = buildCtx.frameNumber;
        continue;
      }
      if (started >= maxStarts || meshCache.size + diskLoadsInFlight.size >= softCap) {
        continue;
      }
      disk.startTerrainDiskLoad(info);
      started += 1;
    }
    build.pumpWorkerQueue();
    return keys;
  }

  async function waitUntilReady(
    keys: readonly string[],
    timeoutMs: number,
  ): Promise<number> {
    if (keys.length === 0) return 0;
    const deadline = performance.now() + Math.max(0, timeoutMs);
    while (performance.now() < deadline) {
      let ready = 0;
      for (const key of keys) {
        if (isTileReady(key)) ready += 1;
      }
      if (ready >= keys.length) return ready;
      build.pumpWorkerQueue();
      await new Promise<void>((resolve) => {
        setTimeout(resolve, 16);
      });
    }
    let ready = 0;
    for (const key of keys) {
      if (isTileReady(key)) ready += 1;
    }
    return ready;
  }

  function evictTileMeshes(selectedKeys: Set<string>): void {
    for (const [key, entry] of meshCache) {
      if (selectedKeys.has(key) || entry.info.level === 0) continue;
      if (buildCtx.frameNumber - entry.lastUsedFrame > TILE_CACHE_STALE_FRAMES) {
        build.releaseTileEntry(key, entry);
      }
    }

    const effectiveCacheLimit = Math.max(
      MAX_CACHED_TILES,
      selectedKeys.size + TILE_CACHE_ACTIVE_HEADROOM,
    );
    if (meshCache.size <= effectiveCacheLimit) return;

    const inactiveEntries: [string, TileMeshEntry][] = [];
    for (const [key, entry] of meshCache) {
      if (selectedKeys.has(key) || entry.info.level === 0) continue;
      inactiveEntries.push([key, entry]);
    }
    inactiveEntries.sort((a, b) => a[1].lastUsedFrame - b[1].lastUsedFrame);

    for (const [key, entry] of inactiveEntries) {
      if (meshCache.size <= effectiveCacheLimit) break;
      build.releaseTileEntry(key, entry);
    }
  }

  function hideInactiveMeshes(activeKeys: Set<string>, previousActiveKeys: Set<string>): void {
    for (const key of previousActiveKeys) {
      if (activeKeys.has(key)) continue;
      const entry = meshCache.get(key);
      if (entry?.mesh) entry.mesh.visible = false;
    }
  }

  for (const face of CUBE_FACES) {
    build.buildTileMeshSync(makeTileInfo(face, 0, 0, 0, planet));
  }

  build.setupWorkers();

  return {
    countEntries,
    dispose() {
      build.clearWorkerLivenessTimer();
      for (const slot of workerPool) {
        slot.worker.terminate();
      }
      workerPool.length = 0;

      pendingBuildQueue.length = 0;
      diskLoadsInFlight.clear();
      confirmedDiskMisses.clear();
      for (const [key, entry] of meshCache) {
        build.releaseTileEntry(key, entry, false);
      }
    },
    entryCount: () => meshCache.size,
    evictTileMeshes,
    hideInactiveMeshes,
    isTileReady,
    isWorkerEnabled: () => build.hasWorkers(),
    prefetchTiles,
    requestBestAvailableTile: resolve.requestBestAvailableTile,
    resetFrameCounters() {
      buildCtx.builtThisFrame = buildCtx.completedSinceLastUpdate;
      buildCtx.completedSinceLastUpdate = 0;
      buildCtx.evictedThisFrame = 0;
      buildCtx.queuedThisFrame = 0;
      buildCtx.syncBuildBudgetRemaining = SYNC_TILE_BUILD_BUDGET_PER_FRAME;
    },
    setFocusPosition(position) {
      const previous = buildCtx.focusPosition;
      buildCtx.focusPosition = position;
      if (pendingBuildQueue.length <= 1) return;
      // Re-prioritising is a full re-score plus a sort, and it ran every frame
      // while flying — exactly when the queue is longest. Priority is distance
      // based, so a sub-tile move cannot meaningfully reorder it.
      if (previous && distance(previous, position) < RESORT_FOCUS_MOVE_METERS) return;
      build.resortPendingQueue();
    },
    setFrameNumber(frame) {
      buildCtx.frameNumber = frame;
    },
    snapshotFrameStats() {
      return {
        builtThisFrame: buildCtx.builtThisFrame,
        completedSinceLastUpdate: buildCtx.completedSinceLastUpdate,
        evictedThisFrame: buildCtx.evictedThisFrame,
        queuedThisFrame: buildCtx.queuedThisFrame,
      };
    },
    stats: () => cacheStats,
    waitUntilReady,
  };
}
