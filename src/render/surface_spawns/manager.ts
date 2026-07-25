import * as THREE from 'three';
import type {
  Planet,
  PlanetSpawnCatalog,
  PlanetSpawnLayer,
  SurfaceSpawnInstance,
  SurfaceSpawnMeshCollision,
  TileInfo,
  Vec3,
} from '../../types';
import { distance } from '../../math/vec3';
import { hashSurfaceSpawnCatalog } from '../../cache/cache-keys';
import { createDefaultSpawnCatalog } from '../../world/planets/schema';
import type { SurfaceSpawnWorkerOutMessage } from '../../types/surface-spawn-worker';
import { disposeSurfaceSpawnAssetCache } from './asset-cache';
import { createSurfaceSpawnBuildWorker } from './worker/create-worker';
import {
  createSurfaceSpawnBatch,
  type AssetBatchState,
  type TileEntry,
} from './surface-spawn-batch';
import { createSurfaceSpawnTiles } from './surface-spawn-tiles';

const VISIBLE_ALTITUDE_METERS = 4_000;
const KEEP_RADIUS_METERS = 900;
const WORKER_READY_TIMEOUT_MS = 2_000;

function tileKey(tile: TileInfo): string {
  return `${tile.face}:${tile.level}:${tile.x}:${tile.y}`;
}

export interface SurfaceSpawnDebugStats {
  layerCount: number;
  enabledLayers: number;
  entryCount: number;
  uniqueAssets: number;
  batchMeshes: number;
  estimatedDrawCalls: number;
  cachedTiles: number;
  readyTiles: number;
  pendingTiles: number;
  totalInstances: number;
  loadedAssets: number;
  failedAssets: number;
  meshCounts: number[];
  rootVisible: boolean;
  rootInScene: boolean;
  sampleRenderPos: { x: number; y: number; z: number } | null;
  rootPos: { x: number; y: number; z: number };
  rootScale: number;
}

export interface SurfaceSpawnManager {
  dispose: () => void;
  setCatalog: (catalog: PlanetSpawnCatalog) => void;
  /** Compat: wraps entries in a default catalog (samplesPerTile=96, density=1). */
  setLayers: (layers: readonly PlanetSpawnLayer[]) => void;
  setVisible: (visible: boolean) => void;
  /** Nearby instances for planet physics (world meters). */
  getNearbyInstances: (
    focus: Vec3,
    radiusMeters: number,
  ) => SurfaceSpawnInstance[];
  getLayers: () => readonly PlanetSpawnLayer[];
  getCatalog: () => PlanetSpawnCatalog;
  /**
   * Mesh AABB colliders keyed by assetUrl (populated as GLBs finish loading).
   * Physics prefers these over tiny authored halfExtents.
   */
  getMeshCollisions: () => ReadonlyMap<string, SurfaceSpawnMeshCollision>;
  getDebugStats: () => SurfaceSpawnDebugStats;
  update: (
    bodyPosition: Vec3,
    selectedTiles: TileInfo[],
    altitudeMeters: number,
  ) => void;
}

export function createSurfaceSpawnManager(
  scene: THREE.Scene,
  planet: Planet,
  seed: number,
  renderScale: number,
  initialCatalog: PlanetSpawnCatalog | readonly PlanetSpawnLayer[] = [],
): SurfaceSpawnManager {
  const root = new THREE.Group();
  root.name = 'surface-spawns';
  root.scale.setScalar(renderScale);
  root.position.set(0, 0, 0);
  scene.add(root);

  let catalog: PlanetSpawnCatalog = (() => {
    if (Array.isArray(initialCatalog)) {
      return createDefaultSpawnCatalog(
        (initialCatalog as readonly PlanetSpawnLayer[]).map((layer) =>
          structuredClone(layer),
        ),
      );
    }
    const source = initialCatalog as PlanetSpawnCatalog;
    return {
      samplesPerTile: source.samplesPerTile,
      density: source.density,
      entries: source.entries.map((entry) => structuredClone(entry)),
    };
  })();
  let layers: PlanetSpawnLayer[] = catalog.entries;
  const entryAssetUrl = new Map<string, string>();
  let catalogHash = hashSurfaceSpawnCatalog(catalog);
  let catalogEpoch = 0;
  let frameNumber = 0;
  let visible = true;
  let nextBuildId = 1;

  const tileCache = new Map<string, TileEntry>();
  const pendingKeys: string[] = [];
  const diskLoadsInFlight = new Set<string>();
  const batchStates = new Map<string, AssetBatchState>();
  const meshCollisions = new Map<string, SurfaceSpawnMeshCollision>();
  let lastFocus: Vec3 = { x: 0, y: 0, z: 0 };

  let worker: Worker | null = createSurfaceSpawnBuildWorker();
  let workerReady = false;
  let workerAlive = worker !== null;
  let workerReadyTimer: ReturnType<typeof setTimeout> | null = null;

  const batch = createSurfaceSpawnBatch({
    batchStates,
    entryAssetUrl,
    getLastFocus: () => lastFocus,
    getLayers: () => layers,
    getVisible: () => visible,
    meshCollisions,
    root,
    tileCache,
  });

  function abandonWorker(reason: string): void {
    if (!workerAlive) return;
    workerAlive = false;
    workerReady = false;
    if (workerReadyTimer) {
      clearTimeout(workerReadyTimer);
      workerReadyTimer = null;
    }
    try {
      worker?.terminate();
    } catch {
      /* ignore */
    }
    worker = null;
    console.warn(
      `ClaudeCitizen surface spawn worker unavailable (${reason}); using budgeted sync builds.`,
    );
    for (const entry of tileCache.values()) {
      if (entry.status === 'building') {
        entry.status = 'pending';
        if (!pendingKeys.includes(entry.key)) pendingKeys.push(entry.key);
      }
    }
  }

  const tiles = createSurfaceSpawnTiles({
    abandonWorker,
    diskLoadsInFlight,
    getCatalog: () => catalog,
    getCatalogEpoch: () => catalogEpoch,
    getFrameNumber: () => frameNumber,
    getLayers: () => layers,
    getNextBuildId: () => nextBuildId,
    getWorker: () => worker,
    getWorkerAlive: () => workerAlive,
    getWorkerReady: () => workerReady,
    markPackedSelectionDirty: batch.markPackedSelectionDirty,
    pendingKeys,
    planet,
    seed,
    setNextBuildId: (value) => {
      nextBuildId = value;
    },
    tileCache,
    tileKey,
  });

  if (worker) {
    workerReadyTimer = setTimeout(() => {
      if (!workerReady) {
        abandonWorker('never responded to startup handshake');
      }
    }, WORKER_READY_TIMEOUT_MS);
    worker.onmessage = (event: MessageEvent<SurfaceSpawnWorkerOutMessage>) => {
      const message = event.data;
      if ('ready' in message && message.ready) {
        workerReady = true;
        if (workerReadyTimer) {
          clearTimeout(workerReadyTimer);
          workerReadyTimer = null;
        }
        return;
      }
      if ('error' in message && message.error) {
        const entry = tileCache.get(message.key);
        if (!entry || entry.buildId !== message.buildId) return;
        tiles.finishTileBuild(entry, null, true);
        return;
      }
      if ('instances' in message) {
        const entry = tileCache.get(message.key);
        if (!entry || entry.buildId !== message.buildId) return;
        tiles.finishTileBuild(entry, message.instances, false);
      }
    };
    worker.onerror = () => {
      abandonWorker('crashed');
    };
  }

  function applyCatalog(nextCatalog: PlanetSpawnCatalog): void {
    const next: PlanetSpawnCatalog = {
      samplesPerTile: nextCatalog.samplesPerTile,
      density: nextCatalog.density,
      entries: nextCatalog.entries.map((entry) => structuredClone(entry)),
    };
    const nextHash = hashSurfaceSpawnCatalog(next);
    if (nextHash === catalogHash) {
      catalog = next;
      layers = catalog.entries;
      batch.rebuildEntryMaps();
      return;
    }
    catalog = next;
    layers = catalog.entries;
    catalogHash = nextHash;
    catalogEpoch += 1;
    tileCache.clear();
    pendingKeys.length = 0;
    diskLoadsInFlight.clear();
    batch.resetPackedSelection();
    batch.rebuildAllBatchStates();
    batch.refreshInstanceMeshes(true);
    console.info(
      `ClaudeCitizen surface spawn manager: ${layers.filter((l) => l.enabled && l.assetUrl).length}/${layers.length} enabled entr(y/ies)` +
        ` uniqueAssets=${batchStates.size}` +
        ` samplesPerTile=${catalog.samplesPerTile} density=${catalog.density}`,
    );
  }

  batch.rebuildAllBatchStates();

  return {
    dispose() {
      catalogEpoch += 1;
      if (workerReadyTimer) {
        clearTimeout(workerReadyTimer);
        workerReadyTimer = null;
      }
      try {
        worker?.terminate();
      } catch {
        /* ignore */
      }
      worker = null;
      workerAlive = false;
      workerReady = false;
      batch.clearAllBatchMeshes();
      batchStates.clear();
      meshCollisions.clear();
      tileCache.clear();
      pendingKeys.length = 0;
      diskLoadsInFlight.clear();
      scene.remove(root);
      disposeSurfaceSpawnAssetCache();
    },
    setCatalog(nextCatalog) {
      applyCatalog(nextCatalog);
    },
    setLayers(nextLayers) {
      applyCatalog(
        createDefaultSpawnCatalog(
          nextLayers.map((layer) => structuredClone(layer)),
        ),
      );
    },
    setVisible(next) {
      visible = next;
      root.visible = next;
    },
    getLayers() {
      return layers;
    },
    getCatalog() {
      return catalog;
    },
    getMeshCollisions() {
      return meshCollisions;
    },
    getDebugStats() {
      let readyTiles = 0;
      let pendingTiles = 0;
      let totalInstances = 0;
      let loadedAssets = 0;
      let failedAssets = 0;
      let batchMeshes = 0;
      for (const entry of tileCache.values()) {
        if (entry.status === 'ready') {
          readyTiles += 1;
          totalInstances += entry.instances.length;
        } else {
          pendingTiles += 1;
        }
      }
      for (const state of batchStates.values()) {
        batchMeshes += state.meshes.length;
        if (state.asset) loadedAssets += 1;
        else if (!state.loading && state.assetUrl) failedAssets += 1;
      }
      const meshCounts: number[] = [];
      let sampleRenderPos: { x: number; y: number; z: number } | null = null;
      let estimatedDrawCalls = 0;
      for (const state of batchStates.values()) {
        for (const mesh of state.meshes) {
          meshCounts.push(mesh.count);
          if (mesh.count > 0) estimatedDrawCalls += 1;
          if (sampleRenderPos || mesh.count <= 0) continue;
          const m = new THREE.Matrix4();
          mesh.getMatrixAt(0, m);
          const pos = new THREE.Vector3().setFromMatrixPosition(m);
          root.updateMatrixWorld(true);
          pos.applyMatrix4(root.matrixWorld);
          sampleRenderPos = { x: pos.x, y: pos.y, z: pos.z };
        }
      }
      const enabledLayers = layers.filter(
        (layer) => layer.enabled && layer.assetUrl,
      ).length;
      return {
        layerCount: layers.length,
        enabledLayers,
        entryCount: layers.length,
        uniqueAssets: batchStates.size,
        batchMeshes,
        estimatedDrawCalls,
        cachedTiles: tileCache.size,
        readyTiles,
        pendingTiles,
        totalInstances,
        loadedAssets,
        failedAssets,
        meshCounts,
        rootVisible: root.visible,
        rootInScene: root.parent === scene,
        sampleRenderPos,
        rootPos: { x: root.position.x, y: root.position.y, z: root.position.z },
        rootScale: root.scale.x,
      };
    },
    getNearbyInstances(focus, radiusMeters) {
      const radiusSq = radiusMeters * radiusMeters;
      const nearby: SurfaceSpawnInstance[] = [];
      for (const instance of batch.collectActiveInstances()) {
        const dx = instance.position.x - focus.x;
        const dy = instance.position.y - focus.y;
        const dz = instance.position.z - focus.z;
        if (dx * dx + dy * dy + dz * dz <= radiusSq) nearby.push(instance);
      }
      return nearby;
    },
    update(bodyPosition, selectedTiles, altitudeMeters) {
      frameNumber += 1;
      lastFocus = bodyPosition;
      root.visible = visible && altitudeMeters < VISIBLE_ALTITUDE_METERS;
      if (!root.visible || layers.length === 0) {
        for (const state of batchStates.values()) {
          for (const mesh of state.meshes) mesh.count = 0;
        }
        return;
      }

      for (const tile of selectedTiles) {
        tiles.enqueueTile(tile, bodyPosition);
      }

      for (const entry of tileCache.values()) {
        if (distance(bodyPosition, entry.tileInfo.centerPosition) < KEEP_RADIUS_METERS) {
          entry.lastUsedFrame = frameNumber;
        }
      }

      tiles.processBuildBudget(bodyPosition);
      tiles.evictStaleTiles(bodyPosition);
      batch.refreshInstanceMeshes();
    },
  };
}
