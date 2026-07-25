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
import { saveTerrainTile } from '../../../cache/terrain-tile-cache';
import { getActivePlanetConfig } from '../../../world/planets/runtime';
import { buildTerrainTileBuffers } from '../build/terrain-buffers';
import { tileKey } from '../domain/tile-info';
import type {
  PendingBuildJob,
  TileCacheStatsAccumulator,
  TileMeshEntry,
} from '../domain/types';
import { createReadyMesh } from '../render/tile-geometry';

export const SYNC_TILE_BUILD_BUDGET_PER_FRAME = 1;
export const WORKER_LIVENESS_TIMEOUT_MS = 5_000;

export interface WorkerSlot {
  busy: boolean;
  worker: Worker;
}

export interface MeshCacheBuildCtx {
  builtThisFrame: number;
  cacheStats: TileCacheStatsAccumulator;
  completedSinceLastUpdate: number;
  confirmedDiskMisses: Set<string>;
  evictedThisFrame: number;
  focusPosition: Vec3 | null;
  frameNumber: number;
  material: THREE.MeshLambertMaterial;
  meshCache: Map<string, TileMeshEntry>;
  nextBuildId: number;
  pendingBuildQueue: PendingBuildJob[];
  planet: Planet;
  queuedThisFrame: number;
  seed: number;
  syncBuildBudgetRemaining: number;
  tileGroup: THREE.Group;
  workerAlive: boolean;
  workerLivenessTimer: ReturnType<typeof setTimeout> | null;
  workerPool: WorkerSlot[];
}

export interface MeshCacheBuildOps {
  abandonWorkerBuilds: (reason: string) => void;
  buildTileMeshSync: (info: TileInfo) => TileMeshEntry;
  clearWorkerLivenessTimer: () => void;
  discardPendingQueueForKey: (key: string, buildId?: number | null) => void;
  enqueuePendingBuild: (job: PendingBuildJob) => void;
  hasWorkers: () => boolean;
  jobPriority: (info: TileInfo) => number;
  markAsyncBuildFailed: (key: string, buildId: number, error?: string) => void;
  markWorkerAlive: () => void;
  maySyncBuild: (info: TileInfo) => boolean;
  persistTerrainBuffers: (info: TileInfo, buffers: TerrainTileBuffers) => void;
  pumpWorkerQueue: () => void;
  queueSyncTileBuild: (info: TileInfo) => TileMeshEntry;
  queueTileBuild: (info: TileInfo) => TileMeshEntry;
  releaseTileEntry: (key: string, entry: TileMeshEntry, countEviction?: boolean) => void;
  resortPendingQueue: () => void;
  setupWorkers: () => void;
  tryBuildTileMeshSync: (
    info: TileInfo,
    buildBudget: { remaining: number },
  ) => TileMeshEntry | null;
  updateCachePeak: () => void;
}

export function createMeshCacheBuildOps(ctx: MeshCacheBuildCtx): MeshCacheBuildOps {
  function hasWorkers(): boolean {
    return ctx.workerPool.length > 0;
  }

  function maySyncBuild(info: TileInfo): boolean {
    return !hasWorkers() || info.level === 0;
  }

  function jobPriority(info: TileInfo): number {
    if (!ctx.focusPosition) return 1_000_000 - info.level;
    return distance(info.centerPosition, ctx.focusPosition) - info.level * 80;
  }

  function updateCachePeak(): void {
    ctx.cacheStats.peakCachedTiles = Math.max(ctx.cacheStats.peakCachedTiles, ctx.meshCache.size);
  }

  function persistTerrainBuffers(info: TileInfo, buffers: TerrainTileBuffers): void {
    const key = tileKey(info.face, info.level, info.x, info.y);
    ctx.confirmedDiskMisses.delete(key);
    saveTerrainTile(ctx.planet, ctx.seed, info.face, info.level, info.x, info.y, buffers);
  }

  function discardPendingQueueForKey(key: string, buildId: number | null = null): void {
    for (let i = ctx.pendingBuildQueue.length - 1; i >= 0; i -= 1) {
      const job = ctx.pendingBuildQueue[i];
      if (job.key !== key) continue;
      if (buildId != null && job.buildId !== buildId) continue;
      ctx.pendingBuildQueue.splice(i, 1);
    }
  }

  function releaseTileEntry(key: string, entry: TileMeshEntry, countEviction = true): void {
    if (entry.mesh) {
      ctx.tileGroup.remove(entry.mesh);
      entry.mesh.geometry.dispose();
    } else {
      discardPendingQueueForKey(key, entry.buildId ?? null);
    }

    ctx.meshCache.delete(key);
    if (!countEviction) return;
    ctx.cacheStats.totalEvictions += 1;
    ctx.evictedThisFrame += 1;
  }

  function markAsyncBuildFailed(key: string, buildId: number, error: string | undefined): void {
    ctx.cacheStats.workerErrors += 1;
    if (error) console.error(`ClaudeCitizen terrain worker failed for ${key}:`, error);
    const entry = ctx.meshCache.get(key);
    if (!entry || entry.buildId !== buildId || entry.status !== 'pending') return;
    ctx.meshCache.delete(key);
  }

  function clearWorkerLivenessTimer(): void {
    if (ctx.workerLivenessTimer == null) return;
    clearTimeout(ctx.workerLivenessTimer);
    ctx.workerLivenessTimer = null;
  }

  function markWorkerAlive(): void {
    ctx.workerAlive = true;
    clearWorkerLivenessTimer();
  }

  function abandonWorkerBuilds(reason: string): void {
    ctx.cacheStats.workerErrors += 1;
    console.error(`ClaudeCitizen terrain worker ${reason}, reverting future builds to sync.`);
    clearWorkerLivenessTimer();
    for (const slot of ctx.workerPool) {
      slot.worker.terminate();
    }
    ctx.workerPool.length = 0;
    ctx.pendingBuildQueue.length = 0;
    for (const entry of ctx.meshCache.values()) {
      if (entry.status !== 'pending' || entry.mesh) continue;
      entry.buildId = null;
    }
  }

  function enqueuePendingBuild(job: PendingBuildJob): void {
    let insertAt = ctx.pendingBuildQueue.length;
    for (let i = 0; i < ctx.pendingBuildQueue.length; i += 1) {
      if (ctx.pendingBuildQueue[i].priority > job.priority) {
        insertAt = i;
        break;
      }
    }
    ctx.pendingBuildQueue.splice(insertAt, 0, job);
  }

  function resortPendingQueue(): void {
    for (const job of ctx.pendingBuildQueue) {
      job.priority = jobPriority(job.info);
    }
    ctx.pendingBuildQueue.sort((a, b) => a.priority - b.priority);
  }

  function pumpWorkerQueue(): void {
    if (!hasWorkers()) return;

    for (const slot of ctx.workerPool) {
      if (slot.busy) continue;

      while (ctx.pendingBuildQueue.length > 0) {
        const job = ctx.pendingBuildQueue.shift()!;
        const entry = ctx.meshCache.get(job.key);
        if (!entry || entry.buildId !== job.buildId || entry.status !== 'pending') {
          continue;
        }

        const planetDocument = getActivePlanetConfig().document;
        if (!planetDocument?.id) {
          markAsyncBuildFailed(job.key, job.buildId, 'active planetDocument missing id');
          continue;
        }

        slot.busy = true;
        const message: TileWorkerInMessage = {
          buildId: job.buildId,
          info: job.info,
          key: job.key,
          planet: ctx.planet,
          planetDocument,
          seed: ctx.seed,
        };
        slot.worker.postMessage(message);
        break;
      }
    }
  }

  function buildTileMeshSync(info: TileInfo): TileMeshEntry {
    const key = tileKey(info.face, info.level, info.x, info.y);
    let entry = ctx.meshCache.get(key);
    if (entry?.mesh) {
      entry.lastUsedFrame = ctx.frameNumber;
      return entry;
    }

    const buffers = buildTerrainTileBuffers(info, ctx.planet, ctx.seed);
    const mesh = createReadyMesh(info, buffers, ctx.material, ctx.tileGroup);
    entry = {
      buildId: null,
      info,
      lastUsedFrame: ctx.frameNumber,
      mesh,
      status: 'ready',
    };
    ctx.meshCache.set(key, entry);
    ctx.cacheStats.totalBuilds += 1;
    ctx.builtThisFrame += 1;
    persistTerrainBuffers(info, buffers);
    updateCachePeak();
    return entry;
  }

  function queueSyncTileBuild(info: TileInfo): TileMeshEntry {
    const key = tileKey(info.face, info.level, info.x, info.y);
    let entry = ctx.meshCache.get(key);
    if (entry) {
      entry.lastUsedFrame = ctx.frameNumber;
      return entry;
    }

    entry = {
      buildId: null,
      info,
      lastUsedFrame: ctx.frameNumber,
      mesh: null,
      status: 'pending',
    };
    ctx.meshCache.set(key, entry);
    updateCachePeak();
    return entry;
  }

  function tryBuildTileMeshSync(
    info: TileInfo,
    buildBudget: { remaining: number },
  ): TileMeshEntry | null {
    if (!maySyncBuild(info)) return null;
    if (buildBudget.remaining <= 0 || ctx.syncBuildBudgetRemaining <= 0) return null;
    buildBudget.remaining -= 1;
    ctx.syncBuildBudgetRemaining -= 1;
    return buildTileMeshSync(info);
  }

  function queueTileBuild(info: TileInfo): TileMeshEntry {
    const key = tileKey(info.face, info.level, info.x, info.y);
    let entry = ctx.meshCache.get(key);
    if (entry) {
      entry.lastUsedFrame = ctx.frameNumber;
      return entry;
    }

    entry = {
      buildId: ctx.nextBuildId,
      info,
      lastUsedFrame: ctx.frameNumber,
      mesh: null,
      status: 'pending',
    };
    ctx.nextBuildId += 1;
    ctx.meshCache.set(key, entry);
    enqueuePendingBuild({
      buildId: entry.buildId!,
      info,
      key,
      priority: jobPriority(info),
    });
    ctx.queuedThisFrame += 1;
    updateCachePeak();
    pumpWorkerQueue();
    return entry;
  }

  function setupWorkers(): void {
    if (!hasWorkers()) return;

    ctx.workerLivenessTimer = setTimeout(() => {
      if (!ctx.workerAlive) abandonWorkerBuilds('never responded to startup handshake');
    }, WORKER_LIVENESS_TIMEOUT_MS);

    for (const slot of ctx.workerPool) {
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
        const entry = ctx.meshCache.get(key);
        if (entry && entry.buildId === buildId && entry.status === 'pending') {
          const buffers = { colors, normals, positions };
          entry.mesh = createReadyMesh(entry.info, buffers, ctx.material, ctx.tileGroup);
          entry.status = 'ready';
          ctx.cacheStats.totalBuilds += 1;
          ctx.completedSinceLastUpdate += 1;
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
    abandonWorkerBuilds,
    buildTileMeshSync,
    clearWorkerLivenessTimer,
    discardPendingQueueForKey,
    enqueuePendingBuild,
    hasWorkers,
    jobPriority,
    markAsyncBuildFailed,
    markWorkerAlive,
    maySyncBuild,
    persistTerrainBuffers,
    pumpWorkerQueue,
    queueSyncTileBuild,
    queueTileBuild,
    releaseTileEntry,
    resortPendingQueue,
    setupWorkers,
    tryBuildTileMeshSync,
    updateCachePeak,
  };
}
