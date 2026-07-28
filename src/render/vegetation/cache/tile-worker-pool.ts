import type { Planet, TileInfo, VegetationSettings } from '../../../types';
import { getActivePlanetConfig } from '../../../world/planets/runtime';
import {
  getGrassSampleCount,
  getTreeSampleCount,
  getVegetationTileDistanceMeters,
} from '../domain/constants';
import { unpackVegetationInstances } from '../domain/packed-instances';
import type { StoredVegetationTile } from '../domain/storage';
import type { InstancedAssetCatalog } from '../render/instanced-assets';
import { createVegetationBuildWorkers } from '../worker/create-worker';
import type {
  VegetationWorkerInMessage,
  VegetationWorkerOutMessage,
} from '../../../types/vegetation-worker';

const WORKER_LIVENESS_TIMEOUT_MS = 5_000;

interface WorkerSlot {
  busy: boolean;
  worker: Worker;
}

interface InFlightBuild {
  epoch: number;
  key: string;
  tileInfo: TileInfo;
}

/** The slice of vegetation runtime state a dispatched job needs to read. */
export interface VegetationWorkerPoolCtx {
  assets: InstancedAssetCatalog;
  assetsReady: boolean;
  planet: Planet;
  seed: number;
  settingsEpoch: number;
  vegetationSettings: VegetationSettings;
}

export interface VegetationWorkerPoolHandlers {
  /** Pop the next tile that still wants building, or null when none remain. */
  claimNextJob: () => { key: string; tileInfo: TileInfo } | null;
  /** Install a finished tile. Only called while the epoch still matches. */
  install: (key: string, tileInfo: TileInfo, data: StoredVegetationTile) => void;
  /** Put a job back on the queue after the pool dies mid-flight. */
  requeue: (key: string, tileInfo: TileInfo) => void;
}

export interface VegetationWorkerPool {
  /** Fill every idle slot from the pending queue. */
  dispatch: () => void;
  dispose: () => void;
  hasWorkers: () => boolean;
}

/**
 * Vegetation generation used to run inline on the main thread against a
 * millisecond budget that was only checked *between* tiles — and a lush L17
 * tile issues well over ten thousand surface probes, so one tile could blow far
 * past it. This moves generation into workers; the caller keeps its budgeted
 * sync path as the fallback for environments where module workers never start.
 */
export function createVegetationWorkerPool(
  ctx: VegetationWorkerPoolCtx,
  handlers: VegetationWorkerPoolHandlers,
): VegetationWorkerPool {
  const pool: WorkerSlot[] = createVegetationBuildWorkers().map((worker) => ({
    busy: false,
    worker,
  }));
  const inFlight = new Map<number, InFlightBuild>();
  let nextBuildId = 1;
  let alive = false;
  let livenessTimer: ReturnType<typeof setTimeout> | null = null;

  function hasWorkers(): boolean {
    return pool.length > 0;
  }

  function clearLivenessTimer(): void {
    if (livenessTimer == null) return;
    clearTimeout(livenessTimer);
    livenessTimer = null;
  }

  function terminatePool(): void {
    clearLivenessTimer();
    for (const slot of pool) slot.worker.terminate();
    pool.length = 0;
  }

  function abandon(reason: string): void {
    console.error(
      `ClaudeCitizen vegetation worker ${reason}, reverting future builds to sync.`,
    );
    const stranded = [...inFlight.values()];
    inFlight.clear();
    terminatePool();
    for (const job of stranded) {
      if (job.epoch !== ctx.settingsEpoch) continue;
      handlers.requeue(job.key, job.tileInfo);
    }
  }

  /** Plain-data probes: ctx.assets carries Three.js geometry that cannot be cloned. */
  function assetProbes(): VegetationWorkerInMessage['assets'] {
    return {
      grass: ctx.assets.grass.map((asset) => ({ baseOffsetY: asset.baseOffsetY })),
      trees: ctx.assets.trees.map((asset) => ({ baseOffsetY: asset.baseOffsetY })),
    };
  }

  function finish(data: VegetationWorkerOutMessage): void {
    if ('ready' in data) return;
    const job = inFlight.get(data.buildId);
    inFlight.delete(data.buildId);
    if (!job) return;

    if ('error' in data) {
      console.error(`ClaudeCitizen vegetation worker failed for ${job.key}:`, data.error);
      return;
    }
    // Grass/tree settings changed while this generated: the result belongs to a
    // stale recipe and rebuildEverything already dropped the cache entry.
    if (job.epoch !== ctx.settingsEpoch) return;

    handlers.install(job.key, job.tileInfo, {
      anchor: data.anchor,
      grass: unpackVegetationInstances(data.grass),
      trees: unpackVegetationInstances(data.trees),
    });
  }

  function dispatch(): void {
    if (!hasWorkers() || !ctx.assetsReady) return;
    const planetDocument = getActivePlanetConfig().document;
    if (!planetDocument?.id) return;

    for (const slot of pool) {
      if (slot.busy) continue;
      const job = handlers.claimNextJob();
      if (!job) return;

      const buildId = nextBuildId;
      nextBuildId += 1;
      inFlight.set(buildId, {
        epoch: ctx.settingsEpoch,
        key: job.key,
        tileInfo: job.tileInfo,
      });
      const message: VegetationWorkerInMessage = {
        assets: assetProbes(),
        buildId,
        density: {
          grassSampleCount: getGrassSampleCount(),
          treeSampleCount: getTreeSampleCount(),
          vegetationTileDistanceMeters: getVegetationTileDistanceMeters(),
        },
        info: job.tileInfo,
        key: job.key,
        planet: ctx.planet,
        planetDocument,
        seed: ctx.seed,
        settings: ctx.vegetationSettings,
      };
      slot.busy = true;
      slot.worker.postMessage(message);
    }
  }

  if (hasWorkers()) {
    // Same startup handshake as the terrain tile worker: some embedded browsers
    // construct workers that never run and never fire an error event.
    livenessTimer = setTimeout(() => {
      if (!alive) abandon('never responded to startup handshake');
    }, WORKER_LIVENESS_TIMEOUT_MS);

    for (const slot of pool) {
      slot.worker.onmessage = (event: MessageEvent<VegetationWorkerOutMessage>) => {
        alive = true;
        clearLivenessTimer();
        if ('ready' in event.data) return;
        slot.busy = false;
        finish(event.data);
        dispatch();
      };
      slot.worker.onerror = (event: ErrorEvent) => {
        abandon(`crashed (${event.message || 'unknown error'})`);
      };
    }
  }

  return {
    dispatch,
    dispose() {
      terminatePool();
      inFlight.clear();
    },
    hasWorkers,
  };
}
