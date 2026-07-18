import * as THREE from 'three';
import type {
  LakeWaterBuffers,
  Planet,
  TileInfo,
  Vec3,
  WaterWorkerInMessage,
  WaterWorkerOutMessage,
} from '../../../types';
import { getActivePlanetConfig } from '../../../world/planets/runtime';
import { buildLakeWaterGeometry } from './build/buffers';
import { createLakeWaterMaterial } from './render/material';
import { createLakeWaterBuildWorker } from './worker/create_worker';

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

export interface PlanetLakeWaterManager {
  dispose: () => void;
  setVisible: (visible: boolean) => void;
  update: (
    bodyPosition: Vec3,
    selectedTiles: TileInfo[],
    sunDirection: THREE.Vector3 | null | undefined,
    dtSeconds: number,
    skyColor: THREE.Color | null | undefined,
  ) => void;
  shiftFocus: (bodyPosition: Vec3) => void;
}

function tileKey(face: TileInfo['face'], level: number, x: number, y: number): string {
  return `${face}:${level}:${x}:${y}`;
}

function toThreeVector3(vector: Vec3): THREE.Vector3 {
  return new THREE.Vector3(vector.x, vector.y, vector.z);
}

export function createPlanetLakeWaterManager(
  scene: THREE.Scene,
  planet: Planet,
  seed: number,
  renderScale: number,
): PlanetLakeWaterManager {
  const waterGroup = new THREE.Group();
  waterGroup.scale.setScalar(renderScale);
  scene.add(waterGroup);

  const sharedMaterial = createLakeWaterMaterial();
  const cache = new Map<string, WaterCacheEntry>();
  const activeKeys = new Set<string>();
  const pendingBuilds: WaterBuildJob[] = [];
  let waterBuildWorker = createLakeWaterBuildWorker();
  let activeWorkerJob: WaterBuildJob | null = null;
  let workerBusy = false;
  let workerAlive = false;
  let workerLivenessTimer: ReturnType<typeof setTimeout> | null = null;
  let disposed = false;
  let elapsedSeconds = 0;
  let frameNumber = 0;
  let nextBuildId = 1;
  let syncBuildBudgetRemaining = WATER_SYNC_BUILD_BUDGET_PER_FRAME;

  function createWaterMesh(info: TileInfo, buffers: LakeWaterBuffers): THREE.Mesh {
    const geometry = new THREE.BufferGeometry();
    geometry.setAttribute('position', new THREE.BufferAttribute(buffers.positions, 3));
    geometry.setAttribute(
      'barycentric',
      new THREE.BufferAttribute(buffers.barycentrics, 3, true),
    );
    geometry.setAttribute('color', new THREE.BufferAttribute(buffers.colors, 3, true));
    geometry.setAttribute(
      'effectDetail',
      new THREE.BufferAttribute(buffers.effectDetails, 1, true),
    );
    geometry.setAttribute('normal', new THREE.BufferAttribute(buffers.normals, 3, true));
    geometry.setAttribute('shore', new THREE.BufferAttribute(buffers.shores, 1, true));
    geometry.setAttribute('waterDepth', new THREE.BufferAttribute(buffers.waterDepths, 1));
    geometry.computeBoundingSphere();

    const mesh = new THREE.Mesh(geometry, sharedMaterial);
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

  function applyBuffers(entry: WaterCacheEntry, buffers: LakeWaterBuffers | null): void {
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
      applyBuffers(entry, buildLakeWaterGeometry(entry.info, planet, seed));
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

  function postWorkerBuild(job: WaterBuildJob, entry: WaterCacheEntry): void {
    const message: WaterWorkerInMessage = {
      buildId: job.buildId,
      info: entry.info,
      key: job.key,
      planet,
      planetDocument: getActivePlanetConfig().document,
      seed,
    };
    activeWorkerJob = job;
    workerBusy = true;
    try {
      waterBuildWorker!.postMessage(message);
    } catch (error) {
      abandonWorker(
        `rejected a build request (${error instanceof Error ? error.message : String(error)})`,
      );
      pumpBuildQueue();
    }
  }

  function pumpBuildQueue(): void {
    if (disposed) return;

    if (waterBuildWorker) {
      if (workerBusy) return;
      const job = nextPendingJob();
      if (!job) return;
      const entry = cache.get(job.key)!;
      postWorkerBuild(job, entry);
      return;
    }

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

  function abandonWorker(reason: string): void {
    console.error(`ClaudeCitizen water worker ${reason}, reverting future builds to sync.`);
    clearWorkerLivenessTimer();
    if (waterBuildWorker) {
      waterBuildWorker.terminate();
      waterBuildWorker = null;
    }

    const interruptedJob = activeWorkerJob;
    activeWorkerJob = null;
    workerBusy = false;
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

  if (waterBuildWorker) {
    workerLivenessTimer = setTimeout(() => {
      if (!workerAlive) abandonWorker('never responded to startup handshake');
    }, WORKER_LIVENESS_TIMEOUT_MS);

    waterBuildWorker.onmessage = (event: MessageEvent<WaterWorkerOutMessage>) => {
      workerAlive = true;
      clearWorkerLivenessTimer();
      if ('ready' in event.data) {
        pumpBuildQueue();
        return;
      }

      workerBusy = false;
      activeWorkerJob = null;
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

    waterBuildWorker.onerror = (event: ErrorEvent) => {
      abandonWorker(`crashed (${event.message || 'unknown error'})`);
    };
  }

  function update(
    bodyPosition: Vec3,
    selectedTiles: TileInfo[],
    sunDirection: THREE.Vector3 | null | undefined,
    dtSeconds: number,
    skyColor: THREE.Color | null | undefined,
  ): void {
    frameNumber += 1;
    elapsedSeconds += dtSeconds;
    syncBuildBudgetRemaining = WATER_SYNC_BUILD_BUDGET_PER_FRAME;
    sharedMaterial.uniforms.time.value = elapsedSeconds;

    if (sunDirection) {
      sharedMaterial.uniforms.sunDirection.value.copy(sunDirection).normalize();
    }
    if (skyColor) {
      sharedMaterial.uniforms.skyColor.value.copy(skyColor);
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
    if (waterBuildWorker) {
      waterBuildWorker.terminate();
      waterBuildWorker = null;
    }
    activeWorkerJob = null;
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
