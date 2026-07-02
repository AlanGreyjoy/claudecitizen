import * as THREE from 'three';
import type { Planet, TerrainTileBuffers, TileInfo, TileWorkerInMessage, TileWorkerOutMessage } from '../../../types';
import { CUBE_FACES } from '../../../world/cube_sphere';
import { loadTerrainTile, saveTerrainTile } from '../../../cache/terrain_tile_cache';
import { buildTerrainTileBuffers } from '../build/terrain_buffers';
import {
  MAX_CACHED_TILES,
  MIN_LEVEL,
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
import { createTileBuildWorker } from '../worker/create_worker';

export interface BuildBudget {
  remaining: number;
}

export interface TileMeshCache {
  countEntries: (status: TileEntryStatus) => number;
  dispose: () => void;
  evictTileMeshes: (selectedKeys: Set<string>) => void;
  hideInactiveMeshes: (activeKeys: Set<string>, previousActiveKeys: Set<string>) => void;
  isWorkerEnabled: () => boolean;
  requestBestAvailableTile: (info: TileInfo, buildBudget: BuildBudget) => ResolvedTile;
  resetFrameCounters: () => void;
  setFrameNumber: (frame: number) => void;
  snapshotFrameStats: () => TileFrameCounters;
  stats: () => TileCacheStatsAccumulator;
}

interface TileMeshCacheOptions {
  material: THREE.MeshStandardMaterial;
  planet: Planet;
  seed: number;
  tileGroup: THREE.Group;
}

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
  const pendingBuildQueue: PendingBuildJob[] = [];
  let tileBuildWorker = createTileBuildWorker();
  let workerBusy = false;
  let frameNumber = 0;
  let nextBuildId = 1;
  let builtThisFrame = 0;
  let completedSinceLastUpdate = 0;
  let evictedThisFrame = 0;
  let queuedThisFrame = 0;

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

  function pumpWorkerQueue(): void {
    if (!tileBuildWorker || workerBusy) return;

    while (pendingBuildQueue.length > 0) {
      const job = pendingBuildQueue.shift()!;
      const entry = meshCache.get(job.key);
      if (!entry || entry.buildId !== job.buildId || entry.status !== 'pending') continue;

      workerBusy = true;
      const message: TileWorkerInMessage = {
        buildId: job.buildId,
        info: job.info,
        key: job.key,
        planet,
        seed,
      };
      tileBuildWorker.postMessage(message);
      return;
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
      entry.mesh = createReadyMesh(info, buffers, material, tileGroup);
      entry.status = 'ready';
      cacheStats.diskHits += 1;
      updateCachePeak();
      return;
    }

    cacheStats.diskMisses += 1;
    meshCache.delete(key);
    if (tileBuildWorker && info.level > MIN_LEVEL) {
      queueTileBuild(info);
      return;
    }
    buildTileMeshSync(info);
  }

  function startTerrainDiskLoad(info: TileInfo): void {
    const key = tileKey(info.face, info.level, info.x, info.y);
    if (meshCache.has(key) || diskLoadsInFlight.has(key)) return;

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
    pendingBuildQueue.push({
      buildId: entry.buildId!,
      info,
      key,
    });
    queuedThisFrame += 1;
    updateCachePeak();
    pumpWorkerQueue();
    return entry;
  }

  function requestBestAvailableTile(info: TileInfo, buildBudget: BuildBudget): ResolvedTile {
    const searchChain: TileInfo[] = [];
    let current: TileInfo | null = info;
    while (current) {
      searchChain.push(current);
      current = parentTileInfo(current, planet);
    }

    const target = searchChain[0];
    const targetKey = tileKey(target.face, target.level, target.x, target.y);
    let targetEntry = meshCache.get(targetKey);

    if (!targetEntry) {
      startTerrainDiskLoad(target);
      targetEntry = meshCache.get(targetKey);
    }

    if (
      targetEntry &&
      targetEntry.status !== 'loading-disk' &&
      !targetEntry.mesh &&
      buildBudget.remaining > 0
    ) {
      buildBudget.remaining -= 1;
      if (tileBuildWorker && target.level > MIN_LEVEL) {
        queueTileBuild(target);
      } else {
        return {
          info: target,
          key: targetKey,
          mesh: buildTileMeshSync(target).mesh!,
        };
      }
    } else if (!targetEntry && buildBudget.remaining > 0) {
      buildBudget.remaining -= 1;
      if (tileBuildWorker && target.level > MIN_LEVEL) {
        queueTileBuild(target);
      } else {
        return {
          info: target,
          key: targetKey,
          mesh: buildTileMeshSync(target).mesh!,
        };
      }
    } else if (targetEntry) {
      targetEntry.lastUsedFrame = frameNumber;
      if (targetEntry.mesh) {
        return {
          info: target,
          key: targetKey,
          mesh: targetEntry.mesh,
        };
      }
    }

    for (const candidate of searchChain.slice(1)) {
      const key = tileKey(candidate.face, candidate.level, candidate.x, candidate.y);
      const entry = meshCache.get(key);
      if (!entry) continue;
      entry.lastUsedFrame = frameNumber;
      if (!entry.mesh) continue;
      return {
        info: candidate,
        key,
        mesh: entry.mesh,
      };
    }

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
      return {
        info: fallbackInfo,
        key: fallbackKey,
        mesh: fallbackEntry.mesh,
      };
    }

    if (buildBudget.remaining > 0) {
      buildBudget.remaining -= 1;
      return {
        info: fallbackInfo,
        key: fallbackKey,
        mesh: buildTileMeshSync(fallbackInfo).mesh,
      };
    }

    // No mesh available and no budget left: report a hole for this frame rather
    // than reusing an unrelated mesh, which leaves ghost terrain visible with no
    // owner in the active-key bookkeeping.
    startTerrainDiskLoad(fallbackInfo);
    return {
      info: fallbackInfo,
      key: fallbackKey,
      mesh: null,
    };
  }

  function evictTileMeshes(selectedKeys: Set<string>): void {
    for (const [key, entry] of meshCache) {
      if (selectedKeys.has(key)) continue;
      if (frameNumber - entry.lastUsedFrame > TILE_CACHE_STALE_FRAMES) {
        releaseTileEntry(key, entry);
      }
    }

    if (meshCache.size <= MAX_CACHED_TILES) return;

    const inactiveEntries: [string, TileMeshEntry][] = [];
    for (const [key, entry] of meshCache) {
      if (selectedKeys.has(key)) continue;
      inactiveEntries.push([key, entry]);
    }
    inactiveEntries.sort((a, b) => a[1].lastUsedFrame - b[1].lastUsedFrame);

    for (const [key, entry] of inactiveEntries) {
      if (meshCache.size <= MAX_CACHED_TILES) break;
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

  if (tileBuildWorker) {
    tileBuildWorker.onmessage = (event: MessageEvent<TileWorkerOutMessage>) => {
      workerBusy = false;
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

    tileBuildWorker.onerror = (event: ErrorEvent) => {
      workerBusy = false;
      cacheStats.workerErrors += 1;
      console.error('ClaudeCitizen terrain worker crashed, reverting future builds to sync.', event);
      tileBuildWorker!.terminate();
      tileBuildWorker = null;
      pendingBuildQueue.length = 0;
      for (const [key, entry] of meshCache) {
        if (entry.status === 'pending') meshCache.delete(key);
      }
    };
  }

  return {
    countEntries,
    dispose() {
      if (tileBuildWorker) {
        tileBuildWorker.terminate();
        tileBuildWorker = null;
      }

      pendingBuildQueue.length = 0;
      for (const [key, entry] of meshCache) {
        releaseTileEntry(key, entry, false);
      }
    },
    evictTileMeshes,
    hideInactiveMeshes,
    isWorkerEnabled: () => Boolean(tileBuildWorker),
    requestBestAvailableTile,
    resetFrameCounters() {
      builtThisFrame = completedSinceLastUpdate;
      completedSinceLastUpdate = 0;
      evictedThisFrame = 0;
      queuedThisFrame = 0;
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
  };
}
