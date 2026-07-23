import type * as THREE from 'three';
import type {
  Planet,
  TerrainTileBuffers,
  TileInfo,
  TileWorkerInMessage,
  TileWorkerOutMessage,
  Vec3,
} from '../../../types';
import { distance } from '../../../math/vec3';
import { CUBE_FACES } from '../../../world/cube_sphere';
import { loadTerrainTile, saveTerrainTile } from '../../../cache/terrain_tile_cache';
import { getActivePlanetConfig } from '../../../world/planets/runtime';
import { buildTerrainTileBuffers } from '../build/terrain_buffers';
import {
  MAX_CACHED_TILES,
  MIN_LEVEL,
  TILE_CACHE_ACTIVE_HEADROOM,
  TILE_CACHE_STALE_FRAMES,
} from '../domain/constants';
import { makeTileInfo, parentTileInfo, tileKey } from '../domain/tile_info';
import type {
  PendingBuildJob,
  ResolvedTile,
  TileCacheStatsAccumulator,
  TileEntryStatus,
  TileFrameCounters,
  TileMeshEntry,
} from '../domain/types';
import { createReadyMesh } from '../render/tile_geometry';
import { createTileBuildWorkers } from '../worker/create_worker';

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
  requestBestAvailableTile: (info: TileInfo, buildBudget: BuildBudget) => ResolvedTile;
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

interface WorkerSlot {
  busy: boolean;
  worker: Worker;
}

// How long the freshly constructed workers get to post a ready handshake
// before we give up on the pool. Generous enough for dev-server module
// compilation on a slow machine, short enough that a dead pool doesn't starve
// tile builds for long.
const WORKER_LIVENESS_TIMEOUT_MS = 5_000;
const SYNC_TILE_BUILD_BUDGET_PER_FRAME = 1;
/** Fine underfoot LODs skip waiting on IDB before the worker starts. */
const FAST_PATH_MIN_LEVEL = 15;

export function createTileMeshCache(options: TileMeshCacheOptions): TileMeshCache {
  const { material, planet, seed, tileGroup } = options;

  const meshCache = new Map<string, TileMeshEntry>();
  const cacheStats: TileCacheStatsAccumulator = {
    diskHits: 0,
    diskMisses: 0,
    peakCachedTiles: 0,
    totalBuilds: 0,
    totalEvictions: 0,
    workerErrors: 0,
  };
  const diskLoadsInFlight = new Set<string>();
  // Session-local negative cache: after an IndexedDB miss with no build path
  // (dead worker + fine LOD), do not re-query IDB every frame while standing.
  const confirmedDiskMisses = new Set<string>();
  const pendingBuildQueue: PendingBuildJob[] = [];
  const workerPool: WorkerSlot[] = createTileBuildWorkers().map((worker) => ({
    busy: false,
    worker,
  }));
  let workerAlive = false;
  let workerLivenessTimer: ReturnType<typeof setTimeout> | null = null;
  let frameNumber = 0;
  let nextBuildId = 1;
  let builtThisFrame = 0;
  let completedSinceLastUpdate = 0;
  let evictedThisFrame = 0;
  let queuedThisFrame = 0;
  let syncBuildBudgetRemaining = SYNC_TILE_BUILD_BUDGET_PER_FRAME;
  let focusPosition: Vec3 | null = null;

  function hasWorkers(): boolean {
    return workerPool.length > 0;
  }

  /**
   * Sync-build only when the worker pool is gone (or for L0 roots). Fine LODs
   * must stay off the main thread while workers are healthy — but a dead pool
   * must not leave permanent pending stubs with no escape hatch.
   */
  function maySyncBuild(info: TileInfo): boolean {
    return !hasWorkers() || info.level === 0;
  }

  /** Keep a mesh-less stub so selection can fall back to parents without re-hitting IDB. */
  function retainUnresolvedTile(info: TileInfo, key: string): void {
    const existing = meshCache.get(key);
    if (existing) {
      existing.info = info;
      existing.lastUsedFrame = frameNumber;
      existing.mesh = null;
      existing.buildId = null;
      existing.status = 'pending';
      return;
    }
    meshCache.set(key, {
      buildId: null,
      info,
      lastUsedFrame: frameNumber,
      mesh: null,
      status: 'pending',
    });
    updateCachePeak();
  }

  function jobPriority(info: TileInfo): number {
    // Lower sorts first. Prefer nearer tiles, then finer LODs underfoot.
    if (!focusPosition) return 1_000_000 - info.level;
    return distance(info.centerPosition, focusPosition) - info.level * 80;
  }

  function enqueuePendingBuild(job: PendingBuildJob): void {
    let insertAt = pendingBuildQueue.length;
    for (let i = 0; i < pendingBuildQueue.length; i += 1) {
      if (pendingBuildQueue[i].priority > job.priority) {
        insertAt = i;
        break;
      }
    }
    pendingBuildQueue.splice(insertAt, 0, job);
  }

  function resortPendingQueue(): void {
    for (const job of pendingBuildQueue) {
      job.priority = jobPriority(job.info);
    }
    pendingBuildQueue.sort((a, b) => a.priority - b.priority);
  }

  function countEntries(status: TileEntryStatus): number {
    let count = 0;
    for (const entry of meshCache.values()) {
      if (entry.status === status) count += 1;
    }
    return count;
  }

  function updateCachePeak(): void {
    cacheStats.peakCachedTiles = Math.max(cacheStats.peakCachedTiles, meshCache.size);
  }

  function persistTerrainBuffers(info: TileInfo, buffers: TerrainTileBuffers): void {
    const key = tileKey(info.face, info.level, info.x, info.y);
    confirmedDiskMisses.delete(key);
    saveTerrainTile(planet, seed, info.face, info.level, info.x, info.y, buffers);
  }

  function discardPendingQueueForKey(key: string, buildId: number | null = null): void {
    for (let i = pendingBuildQueue.length - 1; i >= 0; i -= 1) {
      const job = pendingBuildQueue[i];
      if (job.key !== key) continue;
      if (buildId != null && job.buildId !== buildId) continue;
      pendingBuildQueue.splice(i, 1);
    }
  }

  function releaseTileEntry(key: string, entry: TileMeshEntry, countEviction = true): void {
    if (entry.mesh) {
      tileGroup.remove(entry.mesh);
      entry.mesh.geometry.dispose();
    } else {
      discardPendingQueueForKey(key, entry.buildId ?? null);
    }

    meshCache.delete(key);
    if (!countEviction) return;
    cacheStats.totalEvictions += 1;
    evictedThisFrame += 1;
  }

  function markAsyncBuildFailed(key: string, buildId: number, error: string | undefined): void {
    cacheStats.workerErrors += 1;
    if (error) console.error(`ClaudeCitizen terrain worker failed for ${key}:`, error);
    const entry = meshCache.get(key);
    if (!entry || entry.buildId !== buildId || entry.status !== 'pending') return;
    meshCache.delete(key);
  }

  function clearWorkerLivenessTimer(): void {
    if (workerLivenessTimer == null) return;
    clearTimeout(workerLivenessTimer);
    workerLivenessTimer = null;
  }

  function markWorkerAlive(): void {
    workerAlive = true;
    clearWorkerLivenessTimer();
  }

  // Drop the pool and clear worker job ids so the next request can sync-build
  // (budgeted) instead of waiting forever on a dead queue.
  function abandonWorkerBuilds(reason: string): void {
    cacheStats.workerErrors += 1;
    console.error(`ClaudeCitizen terrain worker ${reason}, reverting future builds to sync.`);
    clearWorkerLivenessTimer();
    for (const slot of workerPool) {
      slot.worker.terminate();
    }
    workerPool.length = 0;
    pendingBuildQueue.length = 0;
    for (const entry of meshCache.values()) {
      if (entry.status !== 'pending' || entry.mesh) continue;
      entry.buildId = null;
    }
  }

  function pumpWorkerQueue(): void {
    if (!hasWorkers()) return;

    for (const slot of workerPool) {
      if (slot.busy) continue;

      while (pendingBuildQueue.length > 0) {
        const job = pendingBuildQueue.shift()!;
        const entry = meshCache.get(job.key);
        if (!entry || entry.buildId !== job.buildId || entry.status !== 'pending') {
          continue;
        }

        const planetDocument = getActivePlanetConfig().document;
        if (!planetDocument?.id) {
          // Without a document the worker cannot activate the terrain recipe and
          // would error-loop into abandonWorkerBuilds → sync L17 stalls.
          markAsyncBuildFailed(
            job.key,
            job.buildId,
            'active planetDocument missing id',
          );
          continue;
        }

        slot.busy = true;
        const message: TileWorkerInMessage = {
          buildId: job.buildId,
          info: job.info,
          key: job.key,
          planet,
          planetDocument,
          seed,
        };
        slot.worker.postMessage(message);
        break;
      }
    }
  }

  function completeTerrainDiskLoad(
    key: string,
    info: TileInfo,
    buffers: TerrainTileBuffers | null,
  ): void {
    const entry = meshCache.get(key);
    if (!entry || entry.status !== 'loading-disk') return;

    if (buffers) {
      confirmedDiskMisses.delete(key);
      entry.mesh = createReadyMesh(info, buffers, material, tileGroup);
      entry.status = 'ready';
      cacheStats.diskHits += 1;
      updateCachePeak();
      return;
    }

    cacheStats.diskMisses += 1;
    if (hasWorkers() && info.level > 0) {
      meshCache.delete(key);
      queueTileBuild(info);
      return;
    }
    // No worker: remember the miss and leave a pending stub for budgeted sync.
    confirmedDiskMisses.add(key);
    entry.status = 'pending';
    entry.buildId = null;
    entry.mesh = null;
    entry.lastUsedFrame = frameNumber;
  }

  function startTerrainDiskLoad(info: TileInfo): void {
    const key = tileKey(info.face, info.level, info.x, info.y);
    if (meshCache.has(key) || diskLoadsInFlight.has(key)) return;

    if (confirmedDiskMisses.has(key)) {
      // Already know IDB is empty for this key. Promote to a build if we can;
      // otherwise keep a stub and rely on parent coverage.
      if (hasWorkers() && info.level > 0) {
        queueTileBuild(info);
      } else if (maySyncBuild(info)) {
        queueSyncTileBuild(info);
      } else {
        retainUnresolvedTile(info, key);
      }
      return;
    }

    meshCache.set(key, {
      buildId: null,
      info,
      lastUsedFrame: frameNumber,
      mesh: null,
      status: 'loading-disk',
    });
    diskLoadsInFlight.add(key);
    updateCachePeak();

    void loadTerrainTile(planet, seed, info.face, info.level, info.x, info.y)
      .then((stored) => {
        diskLoadsInFlight.delete(key);
        completeTerrainDiskLoad(key, info, stored);
      })
      .catch(() => {
        diskLoadsInFlight.delete(key);
        completeTerrainDiskLoad(key, info, null);
      });
  }

  function buildTileMeshSync(info: TileInfo): TileMeshEntry {
    const key = tileKey(info.face, info.level, info.x, info.y);
    let entry = meshCache.get(key);
    if (entry?.mesh) {
      entry.lastUsedFrame = frameNumber;
      return entry;
    }

    const buffers = buildTerrainTileBuffers(info, planet, seed);
    const mesh = createReadyMesh(info, buffers, material, tileGroup);
    entry = {
      buildId: null,
      info,
      lastUsedFrame: frameNumber,
      mesh,
      status: 'ready',
    };
    meshCache.set(key, entry);
    cacheStats.totalBuilds += 1;
    builtThisFrame += 1;
    persistTerrainBuffers(info, buffers);
    updateCachePeak();
    return entry;
  }

  function queueSyncTileBuild(info: TileInfo): TileMeshEntry {
    const key = tileKey(info.face, info.level, info.x, info.y);
    let entry = meshCache.get(key);
    if (entry) {
      entry.lastUsedFrame = frameNumber;
      return entry;
    }

    entry = {
      buildId: null,
      info,
      lastUsedFrame: frameNumber,
      mesh: null,
      status: 'pending',
    };
    meshCache.set(key, entry);
    updateCachePeak();
    return entry;
  }

  function tryBuildTileMeshSync(
    info: TileInfo,
    buildBudget: BuildBudget,
  ): TileMeshEntry | null {
    if (!maySyncBuild(info)) return null;
    if (buildBudget.remaining <= 0 || syncBuildBudgetRemaining <= 0) return null;
    buildBudget.remaining -= 1;
    syncBuildBudgetRemaining -= 1;
    return buildTileMeshSync(info);
  }

  function queueTileBuild(info: TileInfo): TileMeshEntry {
    const key = tileKey(info.face, info.level, info.x, info.y);
    let entry = meshCache.get(key);
    if (entry) {
      entry.lastUsedFrame = frameNumber;
      return entry;
    }

    entry = {
      buildId: nextBuildId,
      info,
      lastUsedFrame: frameNumber,
      mesh: null,
      status: 'pending',
    };
    nextBuildId += 1;
    meshCache.set(key, entry);
    enqueuePendingBuild({
      buildId: entry.buildId!,
      info,
      key,
      priority: jobPriority(info),
    });
    queuedThisFrame += 1;
    updateCachePeak();
    pumpWorkerQueue();
    return entry;
  }

  function isTileReady(key: string): boolean {
    const entry = meshCache.get(key);
    return Boolean(entry?.mesh && entry.status === 'ready');
  }

  /**
   * Warm-cache short-circuit for fine LODs that already started a worker build:
   * if IndexedDB hits first, apply the mesh and drop the queued/in-flight job.
   */
  function peekTerrainDiskUpgrade(info: TileInfo): void {
    const key = tileKey(info.face, info.level, info.x, info.y);
    if (confirmedDiskMisses.has(key) || diskLoadsInFlight.has(key)) return;
    diskLoadsInFlight.add(key);
    void loadTerrainTile(planet, seed, info.face, info.level, info.x, info.y)
      .then((stored) => {
        diskLoadsInFlight.delete(key);
        const entry = meshCache.get(key);
        if (!entry || entry.mesh) {
          if (stored) cacheStats.diskHits += 1;
          else cacheStats.diskMisses += 1;
          return;
        }
        if (!stored) {
          confirmedDiskMisses.add(key);
          cacheStats.diskMisses += 1;
          return;
        }
        confirmedDiskMisses.delete(key);
        discardPendingQueueForKey(key, entry.buildId ?? null);
        entry.buildId = null;
        entry.mesh = createReadyMesh(info, stored, material, tileGroup);
        entry.status = 'ready';
        entry.lastUsedFrame = frameNumber;
        cacheStats.diskHits += 1;
        updateCachePeak();
      })
      .catch(() => {
        diskLoadsInFlight.delete(key);
        confirmedDiskMisses.add(key);
        cacheStats.diskMisses += 1;
      });
  }

  function beginSelectedTileLoad(info: TileInfo): void {
    const key = tileKey(info.face, info.level, info.x, info.y);
    if (meshCache.has(key) || diskLoadsInFlight.has(key)) return;

    // Fine underfoot tiles: start the worker immediately and race IndexedDB so
    // a cold cache does not serialize every LOD behind a disk round-trip.
    if (hasWorkers() && info.level >= FAST_PATH_MIN_LEVEL) {
      if (confirmedDiskMisses.has(key)) {
        queueTileBuild(info);
        return;
      }
      queueTileBuild(info);
      peekTerrainDiskUpgrade(info);
      return;
    }

    startTerrainDiskLoad(info);
  }

  function beginBudgetedSelectedTileLoad(
    info: TileInfo,
    buildBudget: BuildBudget,
  ): TileMeshEntry | undefined {
    const key = tileKey(info.face, info.level, info.x, info.y);
    const existing = meshCache.get(key);
    if (existing) {
      existing.lastUsedFrame = frameNumber;
      if (
        !existing.mesh &&
        existing.status !== 'loading-disk' &&
        maySyncBuild(info)
      ) {
        return tryBuildTileMeshSync(info, buildBudget) ?? existing;
      }
      return existing;
    }
    if (buildBudget.remaining <= 0) return undefined;

    buildBudget.remaining -= 1;
    beginSelectedTileLoad(info);
    return meshCache.get(key);
  }

  function prefetchTiles(tiles: readonly TileInfo[]): string[] {
    const keys: string[] = [];
    // Leave headroom for underfoot selection; never let prefetch fill the cache.
    const softCap = Math.max(8, Math.floor(MAX_CACHED_TILES * 0.8));
    let started = 0;
    const maxStarts = 40;
    for (const info of tiles) {
      const key = tileKey(info.face, info.level, info.x, info.y);
      keys.push(key);
      if (isTileReady(key)) continue;
      const entry = meshCache.get(key);
      if (entry) {
        entry.lastUsedFrame = frameNumber;
        continue;
      }
      if (started >= maxStarts || meshCache.size + diskLoadsInFlight.size >= softCap) {
        continue;
      }
      startTerrainDiskLoad(info);
      started += 1;
    }
    pumpWorkerQueue();
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
      pumpWorkerQueue();
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

  function buildTileSearchChain(info: TileInfo): TileInfo[] {
    const searchChain: TileInfo[] = [];
    let current: TileInfo | null = info;
    while (current) {
      searchChain.push(current);
      current = parentTileInfo(current, planet);
    }
    return searchChain;
  }

  function resolvedTile(info: TileInfo, key: string, mesh: THREE.Mesh | null): ResolvedTile {
    return { info, key, mesh };
  }

  function tryResolveTargetTile(
    target: TileInfo,
    targetKey: string,
    targetEntry: TileMeshEntry | undefined,
    buildBudget: BuildBudget,
  ): ResolvedTile | null {
    if (!targetEntry || targetEntry.status === 'loading-disk' || targetEntry.mesh) {
      return targetEntry?.mesh ? resolvedTile(target, targetKey, targetEntry.mesh) : null;
    }
    if (!maySyncBuild(target)) {
      if (hasWorkers() && target.level > 0 && !targetEntry.buildId) {
        meshCache.delete(targetKey);
        if (buildBudget.remaining > 0) {
          buildBudget.remaining -= 1;
          queueTileBuild(target);
        }
      }
      return null;
    }
    const builtEntry = tryBuildTileMeshSync(target, buildBudget);
    return builtEntry?.mesh ? resolvedTile(target, targetKey, builtEntry.mesh) : null;
  }

  function findAncestorMesh(candidates: TileInfo[]): ResolvedTile | null {
    for (const candidate of candidates) {
      const key = tileKey(candidate.face, candidate.level, candidate.x, candidate.y);
      const entry = meshCache.get(key);
      if (!entry?.mesh) continue;
      entry.lastUsedFrame = frameNumber;
      return resolvedTile(candidate, key, entry.mesh);
    }
    return null;
  }

  function resolveFallbackTile(
    searchChain: TileInfo[],
    buildBudget: BuildBudget,
  ): ResolvedTile {
    const fallbackInfo = searchChain.find((candidate) => candidate.level <= MIN_LEVEL)
      ?? searchChain[searchChain.length - 1];
    const fallbackKey = tileKey(
      fallbackInfo.face,
      fallbackInfo.level,
      fallbackInfo.x,
      fallbackInfo.y,
    );
    const fallbackEntry = meshCache.get(fallbackKey);
    if (fallbackEntry?.mesh) {
      fallbackEntry.lastUsedFrame = frameNumber;
      return resolvedTile(fallbackInfo, fallbackKey, fallbackEntry.mesh);
    }

    const fallbackQueuedInWorker =
      hasWorkers() &&
      fallbackEntry?.status === 'pending' &&
      fallbackEntry.buildId != null;
    const builtFallbackEntry =
      fallbackQueuedInWorker || !maySyncBuild(fallbackInfo)
        ? null
        : tryBuildTileMeshSync(fallbackInfo, buildBudget);
    if (builtFallbackEntry?.mesh) {
      return resolvedTile(fallbackInfo, fallbackKey, builtFallbackEntry.mesh);
    }

    startTerrainDiskLoad(fallbackInfo);
    return resolvedTile(fallbackInfo, fallbackKey, null);
  }

  function requestBestAvailableTile(info: TileInfo, buildBudget: BuildBudget): ResolvedTile {
    const searchChain = buildTileSearchChain(info);
    const target = searchChain[0];
    const targetKey = tileKey(target.face, target.level, target.x, target.y);
    let targetEntry = meshCache.get(targetKey);

    if (!targetEntry) {
      targetEntry = beginBudgetedSelectedTileLoad(target, buildBudget);
    }
    const immediateParent = searchChain[1];
    if (!targetEntry?.mesh && immediateParent) {
      beginBudgetedSelectedTileLoad(immediateParent, buildBudget);
    }
    if (targetEntry) targetEntry.lastUsedFrame = frameNumber;

    const targetResolved = tryResolveTargetTile(target, targetKey, targetEntry, buildBudget);
    if (targetResolved) return targetResolved;

    const ancestorResolved = findAncestorMesh(searchChain.slice(1));
    if (ancestorResolved) return ancestorResolved;

    return resolveFallbackTile(searchChain, buildBudget);
  }

  function evictTileMeshes(selectedKeys: Set<string>): void {
    for (const [key, entry] of meshCache) {
      // L0 roots are the final, synchronously-built coverage guarantee for a
      // cold cache, worker failure, teleport, or exhausted frame budget.
      if (selectedKeys.has(key) || entry.info.level === 0) continue;
      if (frameNumber - entry.lastUsedFrame > TILE_CACHE_STALE_FRAMES) {
        releaseTileEntry(key, entry);
      }
    }

    // Cube-face seams can legitimately require more than the nominal cache
    // size at ground LOD. Keep a small ring around that protected working set;
    // otherwise every meter of travel evicts the tiles needed a meter later.
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
      releaseTileEntry(key, entry);
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
    buildTileMeshSync(makeTileInfo(face, 0, 0, 0, planet));
  }

  if (hasWorkers()) {
    // Constructing a Worker can "succeed" in environments where the script
    // never actually executes and no error event ever fires (seen in embedded
    // browser tabs). Without this handshake timeout the build queue would
    // starve forever while everything waits on a dead pool.
    workerLivenessTimer = setTimeout(() => {
      if (!workerAlive) abandonWorkerBuilds('never responded to startup handshake');
    }, WORKER_LIVENESS_TIMEOUT_MS);

    for (const slot of workerPool) {
      slot.worker.onmessage = (event: MessageEvent<TileWorkerOutMessage>) => {
        markWorkerAlive();
        if ('ready' in event.data) return;

        slot.busy = false;
        const { buildId, key } = event.data;

        if ('error' in event.data) {
          markAsyncBuildFailed(key, buildId, event.data.error);
          pumpWorkerQueue();
          return;
        }

        const { colors, normals, positions } = event.data;
        const entry = meshCache.get(key);
        if (entry && entry.buildId === buildId && entry.status === 'pending') {
          const buffers = { colors, normals, positions };
          entry.mesh = createReadyMesh(entry.info, buffers, material, tileGroup);
          entry.status = 'ready';
          cacheStats.totalBuilds += 1;
          completedSinceLastUpdate += 1;
          persistTerrainBuffers(entry.info, buffers);
        }

        pumpWorkerQueue();
      };

      slot.worker.onerror = (event: ErrorEvent) => {
        abandonWorkerBuilds(`crashed (${event.message || 'unknown error'})`);
      };
    }
  }

  return {
    countEntries,
    dispose() {
      clearWorkerLivenessTimer();
      for (const slot of workerPool) {
        slot.worker.terminate();
      }
      workerPool.length = 0;

      pendingBuildQueue.length = 0;
      diskLoadsInFlight.clear();
      confirmedDiskMisses.clear();
      for (const [key, entry] of meshCache) {
        releaseTileEntry(key, entry, false);
      }
    },
    entryCount: () => meshCache.size,
    evictTileMeshes,
    hideInactiveMeshes,
    isTileReady,
    isWorkerEnabled: () => hasWorkers(),
    prefetchTiles,
    requestBestAvailableTile,
    resetFrameCounters() {
      builtThisFrame = completedSinceLastUpdate;
      completedSinceLastUpdate = 0;
      evictedThisFrame = 0;
      queuedThisFrame = 0;
      syncBuildBudgetRemaining = SYNC_TILE_BUILD_BUDGET_PER_FRAME;
    },
    setFocusPosition(position) {
      focusPosition = position;
      if (pendingBuildQueue.length > 1) resortPendingQueue();
    },
    setFrameNumber(frame) {
      frameNumber = frame;
    },
    snapshotFrameStats() {
      return {
        builtThisFrame,
        completedSinceLastUpdate,
        evictedThisFrame,
        queuedThisFrame,
      };
    },
    stats: () => cacheStats,
    waitUntilReady,
  };
}
