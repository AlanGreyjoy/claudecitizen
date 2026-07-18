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
import { hashSurfaceSpawnCatalog } from '../../cache/cache_keys';
import { createDefaultSpawnCatalog } from '../../world/planets/schema';
import { getActivePlanetConfig } from '../../world/planets/runtime';
import {
  collectTileSurfaceSpawns,
  SURFACE_SPAWN_MIN_TILE_LEVEL,
} from '../../world/surface_spawns';
import type {
  SurfaceSpawnWorkerInMessage,
  SurfaceSpawnWorkerOutMessage,
} from '../../types/surface_spawn_worker';
import { loadSurfaceSpawnAsset, disposeSurfaceSpawnAssetCache } from './asset_cache';
import { composeSurfaceSpawnMatrix } from './instance_matrix';
import {
  loadSurfaceSpawnTile,
  saveSurfaceSpawnTile,
} from './cache/tile_cache';
import { STORED_SURFACE_SPAWN_TILE_VERSION } from './domain/storage';
import { createSurfaceSpawnBuildWorker } from './worker/create_worker';
import type { InstancedAsset } from '../vegetation/render/instanced_assets';

const BUILD_BUDGET_PER_FRAME = 4;
const BUILD_BUDGET_MS = 10;
const MAX_CACHED_TILES = 64;
/** Cap per asset batch InstancedMesh (shared by all entries using that URL). */
const MAX_INSTANCES_PER_BATCH_MESH = 4096;
/** Soft global visible instance budget across all batches. */
const MAX_VISIBLE_INSTANCES = 12_288;
const HIGH_PART_COUNT_WARN = 8;
const VISIBLE_ALTITUDE_METERS = 4_000;
/** Only stream spawn tiles within this radius (not span×k — L12 spans are km-scale). */
const ENQUEUE_RADIUS_METERS = 700;
const KEEP_RADIUS_METERS = 900;
const WORKER_READY_TIMEOUT_MS = 2_000;

interface TileEntry {
  key: string;
  tileInfo: TileInfo;
  instances: SurfaceSpawnInstance[];
  lastUsedFrame: number;
  status: 'loading-disk' | 'pending' | 'building' | 'ready';
  buildId: number;
}

/** One GPU batch per unique asset URL (not per catalog entry). */
interface AssetBatchState {
  assetUrl: string;
  asset: InstancedAsset | null;
  loading: boolean;
  meshes: THREE.InstancedMesh[];
  scratch: THREE.Matrix4;
  warnedParts: boolean;
}

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
  // Scale only — floating origin is baked into instance translations so float32
  // matrices stay near the camera (absolute planet meters spin/jitter in WebGL).
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
  /** Entry id → assetUrl for enabled entries with assets. */
  let entryAssetUrl = new Map<string, string>();
  let catalogHash = hashSurfaceSpawnCatalog(catalog);
  let catalogEpoch = 0;
  let frameNumber = 0;
  let visible = true;
  let nextBuildId = 1;

  const tileCache = new Map<string, TileEntry>();
  const pendingKeys: string[] = [];
  const diskLoadsInFlight = new Set<string>();
  const batchStates = new Map<string, AssetBatchState>();
  /** assetUrl → mesh AABB collider (filled when GLB load completes). */
  const meshCollisions = new Map<string, SurfaceSpawnMeshCollision>();
  let lastFocus: Vec3 = { x: 0, y: 0, z: 0 };

  let worker: Worker | null = createSurfaceSpawnBuildWorker();
  let workerReady = false;
  let workerAlive = worker !== null;
  let workerReadyTimer: ReturnType<typeof setTimeout> | null = null;
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
        // Worker failed — fall back to sync for this tile.
        finishTileBuild(entry, null, true);
        return;
      }
      if ('instances' in message) {
        const entry = tileCache.get(message.key);
        if (!entry || entry.buildId !== message.buildId) return;
        finishTileBuild(entry, message.instances, false);
      }
    };
    worker.onerror = () => {
      abandonWorker('crashed');
    };
  }

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
    // Re-queue tiles stuck in building.
    for (const entry of tileCache.values()) {
      if (entry.status === 'building') {
        entry.status = 'pending';
        if (!pendingKeys.includes(entry.key)) pendingKeys.push(entry.key);
      }
    }
  }
  /**
   * Cached GPU instance selection. Rebuilt only when tile contents change (or
   * when a capped nearest-N set needs a focus refresh) — never every frame.
   */
  let packedSelectionDirty = true;
  let lastPackedByAsset = new Map<string, SurfaceSpawnInstance[]>();
  let lastPackedFocus: Vec3 | null = null;
  /** Focus used for the last nearest-N trim (only when over the mesh cap). */
  let lastSelectionFocus: Vec3 | null = null;
  let selectionWasCapped = false;
  /** Any focus move must rewrite translations (match camera floating origin). */
  const FOCUS_REPACK_METERS = 1e-4;
  /** When over the per-mesh cap, re-trim nearest instances this often. */
  const CAPPED_SELECTION_REFOCUS_METERS = 25;
  const matrixScratch = new Float32Array(16);
  const relativeScratch = { x: 0, y: 0, z: 0 };

  function rebuildEntryMaps(): void {
    entryAssetUrl = new Map();
    for (const entry of layers) {
      if (entry.enabled && entry.assetUrl) {
        entryAssetUrl.set(entry.id, entry.assetUrl);
      }
    }
  }

  function compareInstancesStable(
    a: SurfaceSpawnInstance,
    b: SurfaceSpawnInstance,
  ): number {
    if (a.layerId !== b.layerId) return a.layerId < b.layerId ? -1 : 1;
    if (a.position.x !== b.position.x) return a.position.x - b.position.x;
    if (a.position.y !== b.position.y) return a.position.y - b.position.y;
    if (a.position.z !== b.position.z) return a.position.z - b.position.z;
    if (a.yawRadians !== b.yawRadians) return a.yawRadians - b.yawRadians;
    return a.scale - b.scale;
  }

  function markPackedSelectionDirty(): void {
    packedSelectionDirty = true;
  }

  function rememberMeshCollision(assetUrl: string, asset: InstancedAsset): void {
    if (asset.boundsHalfExtents && asset.collisionCenter) {
      meshCollisions.set(assetUrl, {
        halfExtents: asset.boundsHalfExtents,
        center: asset.collisionCenter,
      });
    }
  }

  function ensureBatchState(assetUrl: string): AssetBatchState {
    let state = batchStates.get(assetUrl);
    if (state) {
      if (state.asset) rememberMeshCollision(assetUrl, state.asset);
      return state;
    }
    state = {
      assetUrl,
      asset: null,
      loading: false,
      meshes: [],
      scratch: new THREE.Matrix4(),
      warnedParts: false,
    };
    batchStates.set(assetUrl, state);
    state.loading = true;
    void loadSurfaceSpawnAsset(assetUrl).then((asset) => {
      const current = batchStates.get(assetUrl);
      if (!current || current.assetUrl !== assetUrl) return;
      current.asset = asset;
      current.loading = false;
        if (asset) {
        if (
          !current.warnedParts &&
          asset.parts.length > HIGH_PART_COUNT_WARN
        ) {
          current.warnedParts = true;
          console.warn(
            `ClaudeCitizen surface spawn asset has ${asset.parts.length} mesh parts ` +
              `(>${HIGH_PART_COUNT_WARN}): ${assetUrl} — prefer fewer materials/parts for draw calls.`,
          );
        }
        rememberMeshCollision(assetUrl, asset);
        rebuildBatchMeshes(current);
        // New InstancedMesh buffers need a full compose, not a translation patch.
        refreshInstanceMeshes(true);
      } else {
        console.warn(
          `ClaudeCitizen surface spawn asset failed to load: ${assetUrl}`,
        );
      }
    });
    return state;
  }

  function clearBatchMeshes(state: AssetBatchState): void {
    for (const mesh of state.meshes) {
      root.remove(mesh);
      // Geometry/materials are owned by the asset cache — do not dispose.
    }
    state.meshes = [];
  }

  function rebuildBatchMeshes(state: AssetBatchState): void {
    clearBatchMeshes(state);
    const asset = state.asset;
    if (!asset) return;
    for (const part of asset.parts) {
      const mesh = new THREE.InstancedMesh(
        part.geometry,
        part.material,
        MAX_INSTANCES_PER_BATCH_MESH,
      );
      mesh.instanceMatrix.setUsage(THREE.DynamicDrawUsage);
      mesh.count = 0;
      // Focus-relative meters; auto BS culling is unreliable across rebuilds.
      mesh.frustumCulled = false;
      mesh.castShadow = false;
      mesh.receiveShadow = true;
      root.add(mesh);
      state.meshes.push(mesh);
    }
  }

  function rebuildAllBatchStates(): void {
    for (const state of batchStates.values()) {
      clearBatchMeshes(state);
    }
    batchStates.clear();
    meshCollisions.clear();
    rebuildEntryMaps();
    const urls = new Set(entryAssetUrl.values());
    for (const assetUrl of urls) {
      ensureBatchState(assetUrl);
    }
  }

  function collectActiveInstances(): SurfaceSpawnInstance[] {
    const out: SurfaceSpawnInstance[] = [];
    for (const entry of tileCache.values()) {
      if (entry.status !== 'ready') continue;
      out.push(...entry.instances);
    }
    return out;
  }

  function selectInstancesForBatch(
    instances: SurfaceSpawnInstance[],
    capacity: number,
  ): { selected: SurfaceSpawnInstance[]; capped: boolean } {
    if (instances.length <= capacity) {
      // Stable order — never reshuffle by player distance (that reassigns GPU
      // slots and makes rocks appear to spin/tumble while walking).
      return {
        selected: instances.slice().sort(compareInstancesStable),
        capped: false,
      };
    }
    const nearest = instances.slice().sort((a, b) => {
      const da =
        (a.position.x - lastFocus.x) ** 2 +
        (a.position.y - lastFocus.y) ** 2 +
        (a.position.z - lastFocus.z) ** 2;
      const db =
        (b.position.x - lastFocus.x) ** 2 +
        (b.position.y - lastFocus.y) ** 2 +
        (b.position.z - lastFocus.z) ** 2;
      return da - db;
    });
    const kept = nearest
      .slice(0, capacity)
      .sort(compareInstancesStable);
    return { selected: kept, capped: true };
  }

  function rebuildPackedSelection(): void {
    const byAsset = new Map<string, SurfaceSpawnInstance[]>();
    for (const instance of collectActiveInstances()) {
      const assetUrl = entryAssetUrl.get(instance.layerId);
      if (!assetUrl) continue;
      const list = byAsset.get(assetUrl);
      if (list) list.push(instance);
      else byAsset.set(assetUrl, [instance]);
    }

    // Global nearest-N trim when total exceeds budget, then per-batch caps.
    const allForBudget: SurfaceSpawnInstance[] = [];
    for (const list of byAsset.values()) allForBudget.push(...list);
    let globalCapped = false;
    if (allForBudget.length > MAX_VISIBLE_INSTANCES) {
      globalCapped = true;
      const keepSet = new Set(
        allForBudget
          .slice()
          .sort((a, b) => {
            const da =
              (a.position.x - lastFocus.x) ** 2 +
              (a.position.y - lastFocus.y) ** 2 +
              (a.position.z - lastFocus.z) ** 2;
            const db =
              (b.position.x - lastFocus.x) ** 2 +
              (b.position.y - lastFocus.y) ** 2 +
              (b.position.z - lastFocus.z) ** 2;
            return da - db;
          })
          .slice(0, MAX_VISIBLE_INSTANCES),
      );
      for (const [assetUrl, list] of byAsset) {
        byAsset.set(
          assetUrl,
          list.filter((inst) => keepSet.has(inst)),
        );
      }
    }

    let capped = globalCapped;
    const packed = new Map<string, SurfaceSpawnInstance[]>();
    for (const assetUrl of batchStates.keys()) {
      const list = byAsset.get(assetUrl) ?? [];
      const result = selectInstancesForBatch(list, MAX_INSTANCES_PER_BATCH_MESH);
      packed.set(assetUrl, result.selected);
      if (result.capped) capped = true;
    }
    lastPackedByAsset = packed;
    selectionWasCapped = capped;
    lastSelectionFocus = { x: lastFocus.x, y: lastFocus.y, z: lastFocus.z };
    packedSelectionDirty = false;
  }

  function writePackedMatrices(): void {
    for (const [assetUrl, state] of batchStates) {
      const instances = lastPackedByAsset.get(assetUrl) ?? [];
      const count = instances.length;
      const meshes = state.meshes;
      if (meshes.length === 0) continue;

      // Compose once per instance, then copy into every mesh part.
      for (let i = 0; i < count; i += 1) {
        const inst = instances[i]!;
        // Focus-relative meters (veg uses tile-anchor relative for the same
        // reason): absolute ~planet-radius translations in float32 make the
        // rotation basis jitter/spin as the camera moves.
        relativeScratch.x = inst.position.x - lastFocus.x;
        relativeScratch.y = inst.position.y - lastFocus.y;
        relativeScratch.z = inst.position.z - lastFocus.z;
        composeSurfaceSpawnMatrix(
          relativeScratch,
          inst.normal,
          inst.yawRadians,
          inst.scale,
          matrixScratch,
        );
        state.scratch.fromArray(matrixScratch);
        if (state.asset && state.asset.baseOffsetY !== 0) {
          const lift = state.asset.baseOffsetY * inst.scale;
          state.scratch.elements[12] += inst.normal.x * lift;
          state.scratch.elements[13] += inst.normal.y * lift;
          state.scratch.elements[14] += inst.normal.z * lift;
        }
        for (const mesh of meshes) {
          mesh.setMatrixAt(i, state.scratch);
        }
      }
      for (const mesh of meshes) {
        mesh.count = count;
        mesh.instanceMatrix.needsUpdate = true;
        mesh.visible = visible && count > 0;
      }
    }
    lastPackedFocus = { x: lastFocus.x, y: lastFocus.y, z: lastFocus.z };
  }

  /** Walking path: only translations change with floating-origin focus. */
  function writePackedTranslations(): void {
    for (const [assetUrl, state] of batchStates) {
      const instances = lastPackedByAsset.get(assetUrl) ?? [];
      const count = instances.length;
      const meshes = state.meshes;
      if (meshes.length === 0 || count === 0) continue;

      const primary = meshes[0]!;
      for (let i = 0; i < count; i += 1) {
        const inst = instances[i]!;
        primary.getMatrixAt(i, state.scratch);
        let tx = inst.position.x - lastFocus.x;
        let ty = inst.position.y - lastFocus.y;
        let tz = inst.position.z - lastFocus.z;
        if (state.asset && state.asset.baseOffsetY !== 0) {
          const lift = state.asset.baseOffsetY * inst.scale;
          tx += inst.normal.x * lift;
          ty += inst.normal.y * lift;
          tz += inst.normal.z * lift;
        }
        state.scratch.elements[12] = tx;
        state.scratch.elements[13] = ty;
        state.scratch.elements[14] = tz;
        for (const mesh of meshes) {
          mesh.setMatrixAt(i, state.scratch);
        }
      }
      for (const mesh of meshes) {
        mesh.instanceMatrix.needsUpdate = true;
      }
    }
    lastPackedFocus = { x: lastFocus.x, y: lastFocus.y, z: lastFocus.z };
  }

  function refreshInstanceMeshes(force = false): void {
    if (force) packedSelectionDirty = true;
    if (
      selectionWasCapped &&
      lastSelectionFocus &&
      distance(lastFocus, lastSelectionFocus) >= CAPPED_SELECTION_REFOCUS_METERS
    ) {
      packedSelectionDirty = true;
    }

    const focusMoved =
      !lastPackedFocus ||
      distance(lastFocus, lastPackedFocus) >= FOCUS_REPACK_METERS;
    if (!packedSelectionDirty && !focusMoved) return;

    if (packedSelectionDirty) {
      rebuildPackedSelection();
      writePackedMatrices();
      return;
    }
    writePackedTranslations();
  }

  function finishTileBuild(
    entry: TileEntry,
    instances: SurfaceSpawnInstance[] | null,
    forceSync: boolean,
  ): void {
    const epoch = catalogEpoch;
    const resolved =
      instances ??
      (forceSync
        ? collectTileSurfaceSpawns(entry.tileInfo, planet, seed, catalog)
        : null);
    if (resolved == null) {
      entry.status = 'pending';
      if (!pendingKeys.includes(entry.key)) pendingKeys.push(entry.key);
      return;
    }
    if (epoch !== catalogEpoch) return;
    entry.instances = resolved;
    entry.status = 'ready';
    entry.lastUsedFrame = frameNumber;
    saveSurfaceSpawnTile(
      planet,
      seed,
      catalog,
      entry.tileInfo.face,
      entry.tileInfo.level,
      entry.tileInfo.x,
      entry.tileInfo.y,
      { version: STORED_SURFACE_SPAWN_TILE_VERSION, instances: resolved },
    );
    markPackedSelectionDirty();
  }

  function startDiskLoad(tile: TileInfo): void {
    const key = tileKey(tile);
    if (tileCache.has(key) || diskLoadsInFlight.has(key)) return;
    const entry: TileEntry = {
      key,
      tileInfo: tile,
      instances: [],
      lastUsedFrame: frameNumber,
      status: 'loading-disk',
      buildId: 0,
    };
    tileCache.set(key, entry);
    diskLoadsInFlight.add(key);
    const epoch = catalogEpoch;
    const catalogForLoad = catalog;
    void loadSurfaceSpawnTile(
      planet,
      seed,
      catalogForLoad,
      tile.face,
      tile.level,
      tile.x,
      tile.y,
    )
      .then((stored) => {
        diskLoadsInFlight.delete(key);
        const current = tileCache.get(key);
        if (!current || current.status !== 'loading-disk') return;
        if (epoch !== catalogEpoch) {
          tileCache.delete(key);
          return;
        }
        if (stored) {
          current.instances = stored.instances;
          current.status = 'ready';
          current.lastUsedFrame = frameNumber;
          markPackedSelectionDirty();
          return;
        }
        current.status = 'pending';
        if (!pendingKeys.includes(key)) pendingKeys.push(key);
      })
      .catch(() => {
        diskLoadsInFlight.delete(key);
        const current = tileCache.get(key);
        if (!current || current.status !== 'loading-disk') return;
        if (epoch !== catalogEpoch) {
          tileCache.delete(key);
          return;
        }
        current.status = 'pending';
        if (!pendingKeys.includes(key)) pendingKeys.push(key);
      });
  }

  function enqueueTile(tile: TileInfo, focus: Vec3): void {
    if (tile.level < SURFACE_SPAWN_MIN_TILE_LEVEL) return;
    if (distance(focus, tile.centerPosition) > ENQUEUE_RADIUS_METERS) return;
    const key = tileKey(tile);
    const existing = tileCache.get(key);
    if (existing) {
      existing.lastUsedFrame = frameNumber;
      return;
    }
    startDiskLoad(tile);
  }

  function postWorkerBuild(entry: TileEntry): boolean {
    if (!worker || !workerAlive || !workerReady) return false;
    const buildId = nextBuildId++;
    entry.buildId = buildId;
    entry.status = 'building';
    const planetDocument = getActivePlanetConfig().document;
    const message: SurfaceSpawnWorkerInMessage = {
      buildId,
      key: entry.key,
      info: entry.tileInfo,
      planet,
      planetDocument,
      seed,
      catalog,
    };
    try {
      worker.postMessage(message);
      return true;
    } catch {
      abandonWorker('postMessage failed');
      entry.status = 'pending';
      return false;
    }
  }

  function processBuildBudget(focus: Vec3): void {
    if (layers.length === 0) return;
    // Prefer nearer, finer tiles so underfoot props appear before distant L12s.
    pendingKeys.sort((a, b) => {
      const ea = tileCache.get(a);
      const eb = tileCache.get(b);
      if (!ea || !eb) return 0;
      const da = distance(focus, ea.tileInfo.centerPosition);
      const db = distance(focus, eb.tileInfo.centerPosition);
      if (da !== db) return da - db;
      return eb.tileInfo.level - ea.tileInfo.level;
    });

    const start = performance.now();
    let started = 0;
    let syncReady = 0;
    while (
      pendingKeys.length > 0 &&
      started < BUILD_BUDGET_PER_FRAME &&
      performance.now() - start < BUILD_BUDGET_MS
    ) {
      const key = pendingKeys.shift()!;
      const entry = tileCache.get(key);
      if (!entry || entry.status !== 'pending') continue;

      if (postWorkerBuild(entry)) {
        started += 1;
        continue;
      }

      // Sync fallback within the same frame budget.
      entry.instances = collectTileSurfaceSpawns(
        entry.tileInfo,
        planet,
        seed,
        catalog,
      );
      entry.status = 'ready';
      entry.lastUsedFrame = frameNumber;
      saveSurfaceSpawnTile(
        planet,
        seed,
        catalog,
        entry.tileInfo.face,
        entry.tileInfo.level,
        entry.tileInfo.x,
        entry.tileInfo.y,
        {
          version: STORED_SURFACE_SPAWN_TILE_VERSION,
          instances: entry.instances,
        },
      );
      started += 1;
      syncReady += 1;
    }
    if (syncReady > 0) markPackedSelectionDirty();
  }

  function evictStaleTiles(focus: Vec3): void {
    // Drop far tiles first so the budget stays on the player's neighborhood.
    let removed = false;
    for (const [key, entry] of [...tileCache]) {
      if (distance(focus, entry.tileInfo.centerPosition) > KEEP_RADIUS_METERS) {
        tileCache.delete(key);
        removed = true;
      }
    }
    if (tileCache.size > MAX_CACHED_TILES) {
      const ranked = [...tileCache.values()].sort((a, b) => {
        const da = distance(focus, a.tileInfo.centerPosition);
        const db = distance(focus, b.tileInfo.centerPosition);
        if (da !== db) return db - da; // farthest first
        return a.lastUsedFrame - b.lastUsedFrame;
      });
      while (tileCache.size > MAX_CACHED_TILES && ranked.length > 0) {
        const victim = ranked.shift()!;
        tileCache.delete(victim.key);
        removed = true;
      }
    }
    if (removed) {
      for (let i = pendingKeys.length - 1; i >= 0; i -= 1) {
        if (!tileCache.has(pendingKeys[i]!)) pendingKeys.splice(i, 1);
      }
      markPackedSelectionDirty();
    }
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
      rebuildEntryMaps();
      return;
    }
    catalog = next;
    layers = catalog.entries;
    catalogHash = nextHash;
    catalogEpoch += 1;
    tileCache.clear();
    pendingKeys.length = 0;
    diskLoadsInFlight.clear();
    lastPackedFocus = null;
    lastSelectionFocus = null;
    lastPackedByAsset = new Map();
    selectionWasCapped = false;
    rebuildAllBatchStates();
    refreshInstanceMeshes(true);
    console.info(
      `ClaudeCitizen surface spawn manager: ${layers.filter((l) => l.enabled && l.assetUrl).length}/${layers.length} enabled entr(y/ies)` +
        ` uniqueAssets=${batchStates.size}` +
        ` samplesPerTile=${catalog.samplesPerTile} density=${catalog.density}`,
    );
  }

  rebuildAllBatchStates();

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
      for (const state of batchStates.values()) clearBatchMeshes(state);
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
          pendingTiles += 1; // loading-disk | pending | building
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
      for (const instance of collectActiveInstances()) {
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
        enqueueTile(tile, bodyPosition);
      }

      for (const entry of tileCache.values()) {
        if (distance(bodyPosition, entry.tileInfo.centerPosition) < KEEP_RADIUS_METERS) {
          entry.lastUsedFrame = frameNumber;
        }
      }

      processBuildBudget(bodyPosition);
      evictStaleTiles(bodyPosition);
      // Repack focus-relative translations as the player moves.
      refreshInstanceMeshes();
    },
  };
}
