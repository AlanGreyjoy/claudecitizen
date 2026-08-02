import * as THREE from 'three';
import type {
  SurfaceWaterBuffers,
  Planet,
  TileInfo,
  Vec3,
  WaterWorkerInMessage,
  WaterWorkerOutMessage,
} from '../../../types';
import { getActivePlanetConfig } from '../../../world/planets/runtime';
import { oceanWaterLevelMeters } from '../../../world/coastal-profile';
import { lakeWaterTableNormalized } from '../../../world/lakes';
import { getHeightPage } from '../../../world/terrain-pages';
import { rasterMayContainWater } from '../../../world/terrain-raster';
import {
  SHORE_PADDING_METERS,
  buildSurfaceWaterGeometry,
} from './build/buffers';
import {
  createSurfaceWaterMaterial,
  type SurfaceWaterMaterialFactory,
} from './render/material';
import { createSurfaceWaterBuildWorkers } from './worker/create-worker';

const MAX_WATER_CACHE_ENTRIES = 256;
const WATER_CACHE_STALE_FRAMES = 300;
const WATER_SYNC_BUILD_BUDGET_PER_FRAME = 1;
const WORKER_LIVENESS_TIMEOUT_MS = 5_000;

type WaterEntryStatus = 'empty' | 'pending' | 'ready';

interface WaterCacheEntry {
  buildId: number;
  info: TileInfo;
  key: string;
  lastUsedFrame: number;
  status: WaterEntryStatus;
  water: THREE.Mesh | null;
}

interface WaterBuildJob {
  buildId: number;
  key: string;
}

/** One worker plus the job it is currently running, or `null` when idle. */
interface WaterWorkerSlot {
  job: WaterBuildJob | null;
  worker: Worker;
}

export interface PlanetSurfaceWaterManager {
  dispose: () => void;
  setVisible: (visible: boolean) => void;
  update: (
    bodyPosition: Vec3,
    selectedTiles: TileInfo[],
    sunDirection: THREE.Vector3 | null | undefined,
    dtSeconds: number,
    skyColor: THREE.Color | null | undefined,
    sunColor?: THREE.Color | null,
  ) => void;
  shiftFocus: (bodyPosition: Vec3) => void;
}

export interface PlanetSurfaceWaterManagerOptions {
  materialFactory?: SurfaceWaterMaterialFactory;
}

function tileKey(face: TileInfo['face'], level: number, x: number, y: number): string {
  return `${face}:${level}:${x}:${y}`;
}

function toThreeVector3(vector: Vec3): THREE.Vector3 {
  return new THREE.Vector3(vector.x, vector.y, vector.z);
}

export function createPlanetSurfaceWaterManager(
  scene: THREE.Scene,
  planet: Planet,
  seed: number,
  renderScale: number,
  options: PlanetSurfaceWaterManagerOptions = {},
): PlanetSurfaceWaterManager {
  const waterGroup = new THREE.Group();
  waterGroup.scale.setScalar(renderScale);
  scene.add(waterGroup);

  const sharedMaterial = (
    options.materialFactory ?? createSurfaceWaterMaterial
  )({
    planetRadiusMeters: planet.radiusMeters,
  });
  const cache = new Map<string, WaterCacheEntry>();
  const activeKeys = new Set<string>();
  const pendingBuilds: WaterBuildJob[] = [];
  const workerSlots: WaterWorkerSlot[] = createSurfaceWaterBuildWorkers().map(
    (worker) => ({ job: null, worker }),
  );
  let workerAlive = false;
  let workerLivenessTimer: ReturnType<typeof setTimeout> | null = null;
  let disposed = false;
  let elapsedSeconds = 0;
  let frameNumber = 0;
  let nextBuildId = 1;
  let syncBuildBudgetRemaining = WATER_SYNC_BUILD_BUDGET_PER_FRAME;

  function createWaterMesh(info: TileInfo, buffers: SurfaceWaterBuffers): THREE.Mesh {
    const geometry = new THREE.BufferGeometry();
    geometry.setAttribute('position', new THREE.BufferAttribute(buffers.positions, 3));
    // itemSize 4 throughout: WebGPU has no 3-wide or 1-wide 8-bit vertex
    // format, and arrayStride must be a multiple of 4. See SurfaceWaterBuffers.
    geometry.setAttribute(
      'barycentric',
      new THREE.BufferAttribute(buffers.barycentrics, 4, true),
    );
    geometry.setAttribute('color', new THREE.BufferAttribute(buffers.colors, 4, true));
    geometry.setAttribute(
      'waterFactor',
      new THREE.BufferAttribute(buffers.waterFactors, 4, true),
    );
    geometry.setAttribute(
      'radialDirection',
      new THREE.BufferAttribute(buffers.radialDirections, 3),
    );
    // The shader derives its faceted normal per-fragment from screen-space
    // derivatives, so the mesh never needed a normal attribute under WebGL. The
    // WebGPU scene pass writes an MRT normal target for GTAO, and `normalView`
    // reads this attribute — without it three warns "Vertex attribute 'normal'
    // not found on geometry" and the normal target is garbage. The outward
    // radial direction is the water surface normal before wave displacement.
    geometry.setAttribute(
      'normal',
      new THREE.BufferAttribute(buffers.radialDirections, 3),
    );
    geometry.setAttribute('waterDepth', new THREE.BufferAttribute(buffers.waterDepths, 1));
    geometry.computeBoundingSphere();

    const mesh = new THREE.Mesh(geometry, sharedMaterial.material);
    mesh.renderOrder = 2;
    mesh.position.copy(toThreeVector3(info.centerPosition));
    mesh.visible = false;
    waterGroup.add(mesh);
    return mesh;
  }

  function disposeWaterMesh(mesh: THREE.Mesh): void {
    waterGroup.remove(mesh);
    mesh.geometry.dispose();
  }

  function discardPendingBuild(key: string, buildId: number | null = null): void {
    for (let i = pendingBuilds.length - 1; i >= 0; i -= 1) {
      const job = pendingBuilds[i];
      if (job.key !== key) continue;
      if (buildId != null && job.buildId !== buildId) continue;
      pendingBuilds.splice(i, 1);
    }
  }

  function releaseEntry(key: string, entry: WaterCacheEntry): void {
    discardPendingBuild(key, entry.buildId);
    if (entry.water) disposeWaterMesh(entry.water);
    cache.delete(key);
  }

  function applyBuffers(entry: WaterCacheEntry, buffers: SurfaceWaterBuffers | null): void {
    if (entry.water) {
      disposeWaterMesh(entry.water);
      entry.water = null;
    }

    if (!buffers) {
      entry.status = 'empty';
      return;
    }

    entry.water = createWaterMesh(entry.info, buffers);
    entry.water.visible = activeKeys.has(entry.key);
    entry.status = 'ready';
  }

  function buildEntrySync(entry: WaterCacheEntry): void {
    try {
      applyBuffers(entry, buildSurfaceWaterGeometry(entry.info, planet, seed));
    } catch (error) {
      console.error(`ClaudeCitizen water build failed for ${entry.key}:`, error);
      applyBuffers(entry, null);
    }
  }

  function queueBuild(entry: WaterCacheEntry, atFront = false): void {
    discardPendingBuild(entry.key, entry.buildId);
    entry.status = 'pending';
    const job = { buildId: entry.buildId, key: entry.key };
    if (atFront) pendingBuilds.unshift(job);
    else pendingBuilds.push(job);
  }

  function nextPendingJob(): WaterBuildJob | null {
    while (pendingBuilds.length > 0) {
      let jobIndex = pendingBuilds.findIndex((job) => activeKeys.has(job.key));
      if (jobIndex < 0) jobIndex = 0;
      const [job] = pendingBuilds.splice(jobIndex, 1);
      const entry = cache.get(job.key);
      if (!entry || entry.buildId !== job.buildId || entry.status !== 'pending') continue;
      return job;
    }
    return null;
  }

  function postWorkerBuild(
    slot: WaterWorkerSlot,
    job: WaterBuildJob,
    entry: WaterCacheEntry,
  ): void {
    const message: WaterWorkerInMessage = {
      buildId: job.buildId,
      info: entry.info,
      key: job.key,
      planet,
      planetDocument: getActivePlanetConfig().document,
      seed,
    };
    slot.job = job;
    try {
      slot.worker.postMessage(message);
    } catch (error) {
      // Requeues the job and drops the slot. Deliberately does not pump again
      // from here: `pumpBuildQueue` is the only caller and is mid-iteration.
      abandonWorker(
        slot,
        `rejected a build request (${error instanceof Error ? error.message : String(error)})`,
      );
    }
  }

  function pumpBuildQueue(): void {
    if (disposed) return;

    // Fill every idle slot rather than dispatching one job per pump: a coastline
    // arriving queues tens of wet tiles at once, and draining them one at a time
    // was the whole reason water filled in visibly.
    //
    // Iterated over a snapshot because a rejected `postMessage` removes its slot
    // from `workerSlots` from inside this loop.
    for (const slot of [...workerSlots]) {
      if (slot.job || !workerSlots.includes(slot)) continue;
      const job = nextPendingJob();
      if (!job) return;
      postWorkerBuild(slot, job, cache.get(job.key)!);
    }
    // Only a pool that lost every worker falls through to budgeted sync builds.
    if (workerSlots.length > 0) return;

    while (syncBuildBudgetRemaining > 0) {
      const job = nextPendingJob();
      if (!job) return;
      const entry = cache.get(job.key);
      if (!entry || entry.buildId !== job.buildId || entry.status !== 'pending') continue;
      buildEntrySync(entry);
      syncBuildBudgetRemaining -= 1;
    }
  }

  function clearWorkerLivenessTimer(): void {
    if (workerLivenessTimer == null) return;
    clearTimeout(workerLivenessTimer);
    workerLivenessTimer = null;
  }

  /**
   * Drops one dead worker, requeueing whatever it was building.
   *
   * Only the last slot leaving takes the manager back to budgeted sync builds —
   * one crashed worker in a pool must not cost the others.
   */
  function abandonWorker(slot: WaterWorkerSlot, reason: string): void {
    const slotIndex = workerSlots.indexOf(slot);
    if (slotIndex < 0) return;
    workerSlots.splice(slotIndex, 1);
    slot.worker.terminate();

    if (workerSlots.length === 0) {
      clearWorkerLivenessTimer();
      console.error(
        `ClaudeCitizen water worker ${reason}, reverting future builds to sync.`,
      );
    } else {
      console.error(
        `ClaudeCitizen water worker ${reason}; ${workerSlots.length} remaining.`,
      );
    }

    const interruptedJob = slot.job;
    slot.job = null;
    if (interruptedJob) {
      const entry = cache.get(interruptedJob.key);
      if (
        entry &&
        entry.buildId === interruptedJob.buildId &&
        entry.status === 'pending'
      ) {
        queueBuild(entry, true);
      }
    }
  }

  /** Higher of the two planet-wide standing-water planes, in metres. */
  function highestStandingWaterLevelMeters(): number {
    return Math.max(
      oceanWaterLevelMeters(),
      lakeWaterTableNormalized() * planet.terrainAmplitudeMeters,
    );
  }

  function requestTile(info: TileInfo): WaterCacheEntry {
    const key = tileKey(info.face, info.level, info.x, info.y);
    const existing = cache.get(key);
    if (existing) {
      existing.info = info;
      existing.lastUsedFrame = frameNumber;
      return existing;
    }

    const entry: WaterCacheEntry = {
      buildId: nextBuildId,
      info,
      key,
      lastUsedFrame: frameNumber,
      status: 'pending',
      water: null,
    };
    nextBuildId += 1;
    cache.set(key, entry);

    // Every selected tile used to be queued, and each build pays a full
    // grid of surface samples through a single serialised worker — even for
    // tiles nowhere near a water level, which is most of a continent. The
    // terrain page already carries the height envelope and the lake/river
    // channels, so when it is resident it can rule the tile out for free.
    // Tiles requested before their terrain page arrives fall through and build,
    // exactly as before.
    const page = getHeightPage(info.face, info.level, info.x, info.y);
    if (page && !rasterMayContainWater(page, highestStandingWaterLevelMeters(), SHORE_PADDING_METERS)) {
      entry.status = 'empty';
      return entry;
    }

    queueBuild(entry);
    return entry;
  }

  function evictWaterEntries(): void {
    for (const [key, entry] of cache) {
      if (activeKeys.has(key)) continue;
      if (frameNumber - entry.lastUsedFrame > WATER_CACHE_STALE_FRAMES) {
        releaseEntry(key, entry);
      }
    }

    if (cache.size <= MAX_WATER_CACHE_ENTRIES) return;
    const inactiveEntries = [...cache.entries()]
      .filter(([key]) => !activeKeys.has(key))
      .sort((a, b) => a[1].lastUsedFrame - b[1].lastUsedFrame);

    for (const [key, entry] of inactiveEntries) {
      if (cache.size <= MAX_WATER_CACHE_ENTRIES) break;
      releaseEntry(key, entry);
    }
  }

  function attachWorkerSlot(slot: WaterWorkerSlot): void {
    slot.worker.onmessage = (event: MessageEvent<WaterWorkerOutMessage>) => {
      workerAlive = true;
      clearWorkerLivenessTimer();
      if ('ready' in event.data) {
        pumpBuildQueue();
        return;
      }

      slot.job = null;
      const { buildId, key } = event.data;
      const entry = cache.get(key);

      if ('error' in event.data) {
        console.error(`ClaudeCitizen water worker failed for ${key}:`, event.data.error);
        if (entry && entry.buildId === buildId && entry.status === 'pending') {
          applyBuffers(entry, null);
        }
        pumpBuildQueue();
        return;
      }

      if (entry && entry.buildId === buildId && entry.status === 'pending') {
        applyBuffers(entry, event.data.buffers);
      }
      pumpBuildQueue();
    };

    slot.worker.onerror = (event: ErrorEvent) => {
      abandonWorker(slot, `crashed (${event.message || 'unknown error'})`);
    };
  }

  if (workerSlots.length > 0) {
    // One timer for the pool: any worker answering proves the module loaded, so
    // a slow machine does not get its whole pool torn down slot by slot.
    workerLivenessTimer = setTimeout(() => {
      if (workerAlive) return;
      for (const slot of [...workerSlots]) {
        abandonWorker(slot, 'never responded to startup handshake');
      }
    }, WORKER_LIVENESS_TIMEOUT_MS);

    for (const slot of workerSlots) attachWorkerSlot(slot);
  }

  function update(
    bodyPosition: Vec3,
    selectedTiles: TileInfo[],
    sunDirection: THREE.Vector3 | null | undefined,
    dtSeconds: number,
    skyColor: THREE.Color | null | undefined,
    sunColor?: THREE.Color | null,
  ): void {
    frameNumber += 1;
    elapsedSeconds += dtSeconds;
    syncBuildBudgetRemaining = WATER_SYNC_BUILD_BUDGET_PER_FRAME;
    sharedMaterial.setTime(elapsedSeconds);

    if (sunDirection) {
      sharedMaterial.setSunDirection(sunDirection);
    }
    if (skyColor) {
      sharedMaterial.setSkyColor(skyColor);
    }
    if (sunColor) {
      sharedMaterial.setSunColor(sunColor);
    }

    const nextActiveKeys = new Set<string>();
    for (const info of selectedTiles) {
      const key = tileKey(info.face, info.level, info.x, info.y);
      nextActiveKeys.add(key);
      const entry = requestTile(info);
      if (entry.water) entry.water.visible = true;
    }

    for (const key of activeKeys) {
      if (nextActiveKeys.has(key)) continue;
      const entry = cache.get(key);
      if (entry?.water) entry.water.visible = false;
    }
    activeKeys.clear();
    for (const key of nextActiveKeys) activeKeys.add(key);

    pumpBuildQueue();
    evictWaterEntries();

    waterGroup.position.set(
      -bodyPosition.x * renderScale,
      -bodyPosition.y * renderScale,
      -bodyPosition.z * renderScale,
    );
  }

  function shiftFocus(bodyPosition: Vec3): void {
    waterGroup.position.set(
      -bodyPosition.x * renderScale,
      -bodyPosition.y * renderScale,
      -bodyPosition.z * renderScale,
    );
  }

  function dispose(): void {
    disposed = true;
    clearWorkerLivenessTimer();
    for (const slot of workerSlots) {
      slot.job = null;
      slot.worker.terminate();
    }
    workerSlots.length = 0;
    pendingBuilds.length = 0;
    for (const [key, entry] of cache) releaseEntry(key, entry);
    sharedMaterial.dispose();
    scene.remove(waterGroup);
  }

  return {
    dispose,
    setVisible(visible) {
      waterGroup.visible = visible;
    },
    shiftFocus,
    update,
  };
}
