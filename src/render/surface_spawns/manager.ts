import * as THREE from 'three';
import type {
  Planet,
  PlanetSpawnLayer,
  SurfaceSpawnInstance,
  TileInfo,
  Vec3,
} from '../../types';
import { distance } from '../../math/vec3';
import { hashSurfaceSpawnLayers } from '../../cache/cache_keys';
import {
  collectTileSurfaceSpawns,
  SURFACE_SPAWN_MIN_TILE_LEVEL,
} from '../../world/surface_spawns';
import { loadSurfaceSpawnAsset, disposeSurfaceSpawnAssetCache } from './asset_cache';
import { composeSurfaceSpawnMatrix } from './instance_matrix';
import type { InstancedAsset } from '../vegetation/render/instanced_assets';

const BUILD_BUDGET_PER_FRAME = 4;
const BUILD_BUDGET_MS = 10;
const MAX_CACHED_TILES = 64;
const MAX_INSTANCES_PER_LAYER_MESH = 4096;
const VISIBLE_ALTITUDE_METERS = 4_000;
/** Only stream spawn tiles within this radius (not span×k — L12 spans are km-scale). */
const ENQUEUE_RADIUS_METERS = 700;
const KEEP_RADIUS_METERS = 900;

interface TileEntry {
  key: string;
  tileInfo: TileInfo;
  instances: SurfaceSpawnInstance[];
  lastUsedFrame: number;
  status: 'pending' | 'ready';
}

interface LayerRenderState {
  layer: PlanetSpawnLayer;
  asset: InstancedAsset | null;
  loading: boolean;
  meshes: THREE.InstancedMesh[];
  scratch: THREE.Matrix4;
}

function tileKey(tile: TileInfo): string {
  return `${tile.face}:${tile.level}:${tile.x}:${tile.y}`;
}

export interface SurfaceSpawnDebugStats {
  layerCount: number;
  enabledLayers: number;
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
  setLayers: (layers: readonly PlanetSpawnLayer[]) => void;
  setVisible: (visible: boolean) => void;
  /** Nearby instances for planet physics (world meters). */
  getNearbyInstances: (
    focus: Vec3,
    radiusMeters: number,
  ) => SurfaceSpawnInstance[];
  getLayers: () => readonly PlanetSpawnLayer[];
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
  initialLayers: readonly PlanetSpawnLayer[] = [],
): SurfaceSpawnManager {
  const root = new THREE.Group();
  root.name = 'surface-spawns';
  // Scale only — floating origin is baked into instance translations so float32
  // matrices stay near the camera (absolute planet meters spin/jitter in WebGL).
  root.scale.setScalar(renderScale);
  root.position.set(0, 0, 0);
  scene.add(root);

  let layers: PlanetSpawnLayer[] = initialLayers.map((layer) =>
    structuredClone(layer),
  );
  let layersHash = hashSurfaceSpawnLayers(layers);
  let frameNumber = 0;
  let visible = true;

  const tileCache = new Map<string, TileEntry>();
  const pendingKeys: string[] = [];
  const layerStates = new Map<string, LayerRenderState>();
  let lastFocus: Vec3 = { x: 0, y: 0, z: 0 };
  /**
   * Cached GPU instance selection. Rebuilt only when tile contents change (or
   * when a capped nearest-N set needs a focus refresh) — never every frame.
   */
  let packedSelectionDirty = true;
  let lastPackedByLayer = new Map<string, SurfaceSpawnInstance[]>();
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

  function ensureLayerState(layer: PlanetSpawnLayer): LayerRenderState {
    let state = layerStates.get(layer.id);
    if (state) {
      state.layer = layer;
      return state;
    }
    state = {
      layer,
      asset: null,
      loading: false,
      meshes: [],
      scratch: new THREE.Matrix4(),
    };
    layerStates.set(layer.id, state);
    if (layer.assetUrl) {
      state.loading = true;
      void loadSurfaceSpawnAsset(layer.assetUrl).then((asset) => {
        const current = layerStates.get(layer.id);
        if (!current || current.layer.assetUrl !== layer.assetUrl) return;
        current.asset = asset;
        current.loading = false;
        if (asset) {
          rebuildLayerMeshes(current);
          // New InstancedMesh buffers need a full compose, not a translation patch.
          refreshInstanceMeshes(true);
        } else {
          console.warn(
            `ClaudeCitizen surface spawn layer "${layer.id}" failed to load asset: ${layer.assetUrl}`,
          );
        }
      });
    }
    return state;
  }

  function clearLayerMeshes(state: LayerRenderState): void {
    for (const mesh of state.meshes) {
      root.remove(mesh);
      // Geometry/materials are owned by the asset cache — do not dispose.
    }
    state.meshes = [];
  }

  function rebuildLayerMeshes(state: LayerRenderState): void {
    clearLayerMeshes(state);
    const asset = state.asset;
    if (!asset) return;
    for (const part of asset.parts) {
      const mesh = new THREE.InstancedMesh(
        part.geometry,
        part.material,
        MAX_INSTANCES_PER_LAYER_MESH,
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

  function rebuildAllLayerStates(): void {
    for (const state of layerStates.values()) {
      clearLayerMeshes(state);
    }
    layerStates.clear();
    for (const layer of layers) {
      if (layer.enabled && layer.assetUrl) ensureLayerState(layer);
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

  function selectInstancesForLayer(
    instances: SurfaceSpawnInstance[],
  ): { selected: SurfaceSpawnInstance[]; capped: boolean } {
    if (instances.length <= MAX_INSTANCES_PER_LAYER_MESH) {
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
      .slice(0, MAX_INSTANCES_PER_LAYER_MESH)
      .sort(compareInstancesStable);
    return { selected: kept, capped: true };
  }

  function rebuildPackedSelection(): void {
    const byLayer = new Map<string, SurfaceSpawnInstance[]>();
    for (const instance of collectActiveInstances()) {
      const list = byLayer.get(instance.layerId);
      if (list) list.push(instance);
      else byLayer.set(instance.layerId, [instance]);
    }

    let capped = false;
    const packed = new Map<string, SurfaceSpawnInstance[]>();
    for (const layerId of layerStates.keys()) {
      const list = byLayer.get(layerId) ?? [];
      const result = selectInstancesForLayer(list);
      packed.set(layerId, result.selected);
      if (result.capped) capped = true;
    }
    lastPackedByLayer = packed;
    selectionWasCapped = capped;
    lastSelectionFocus = { x: lastFocus.x, y: lastFocus.y, z: lastFocus.z };
    packedSelectionDirty = false;
  }

  function writePackedMatrices(): void {
    for (const [layerId, state] of layerStates) {
      const instances = lastPackedByLayer.get(layerId) ?? [];
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
    for (const [layerId, state] of layerStates) {
      const instances = lastPackedByLayer.get(layerId) ?? [];
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

  function enqueueTile(tile: TileInfo, focus: Vec3): void {
    if (tile.level < SURFACE_SPAWN_MIN_TILE_LEVEL) return;
    if (distance(focus, tile.centerPosition) > ENQUEUE_RADIUS_METERS) return;
    const key = tileKey(tile);
    const existing = tileCache.get(key);
    if (existing) {
      existing.lastUsedFrame = frameNumber;
      return;
    }
    tileCache.set(key, {
      key,
      tileInfo: tile,
      instances: [],
      lastUsedFrame: frameNumber,
      status: 'pending',
    });
    pendingKeys.push(key);
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
    let built = 0;
    while (
      pendingKeys.length > 0 &&
      built < BUILD_BUDGET_PER_FRAME &&
      performance.now() - start < BUILD_BUDGET_MS
    ) {
      const key = pendingKeys.shift()!;
      const entry = tileCache.get(key);
      if (!entry || entry.status === 'ready') continue;
      entry.instances = collectTileSurfaceSpawns(
        entry.tileInfo,
        planet,
        seed,
        layers,
      );
      entry.status = 'ready';
      entry.lastUsedFrame = frameNumber;
      built += 1;
    }
    if (built > 0) markPackedSelectionDirty();
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

  rebuildAllLayerStates();

  return {
    dispose() {
      for (const state of layerStates.values()) clearLayerMeshes(state);
      layerStates.clear();
      tileCache.clear();
      pendingKeys.length = 0;
      scene.remove(root);
      disposeSurfaceSpawnAssetCache();
    },
    setLayers(nextLayers) {
      const next = nextLayers.map((layer) => structuredClone(layer));
      const nextHash = hashSurfaceSpawnLayers(next);
      if (nextHash === layersHash) {
        layers = next;
        return;
      }
      layers = next;
      layersHash = nextHash;
      tileCache.clear();
      pendingKeys.length = 0;
      lastPackedFocus = null;
      lastSelectionFocus = null;
      lastPackedByLayer = new Map();
      selectionWasCapped = false;
      rebuildAllLayerStates();
      refreshInstanceMeshes(true);
      console.info(
        `ClaudeCitizen surface spawn manager: ${layers.filter((l) => l.enabled && l.assetUrl).length}/${layers.length} enabled layer(s)`,
      );
    },
    setVisible(next) {
      visible = next;
      root.visible = next;
    },
    getLayers() {
      return layers;
    },
    getDebugStats() {
      let readyTiles = 0;
      let pendingTiles = 0;
      let totalInstances = 0;
      let loadedAssets = 0;
      let failedAssets = 0;
      for (const entry of tileCache.values()) {
        if (entry.status === 'ready') {
          readyTiles += 1;
          totalInstances += entry.instances.length;
        } else {
          pendingTiles += 1;
        }
      }
      for (const state of layerStates.values()) {
        if (state.asset) loadedAssets += 1;
        else if (!state.loading && state.layer.assetUrl) failedAssets += 1;
      }
      const meshCounts: number[] = [];
      let sampleRenderPos: { x: number; y: number; z: number } | null = null;
      for (const state of layerStates.values()) {
        for (const mesh of state.meshes) {
          meshCounts.push(mesh.count);
          if (sampleRenderPos || mesh.count <= 0) continue;
          const m = new THREE.Matrix4();
          mesh.getMatrixAt(0, m);
          const pos = new THREE.Vector3().setFromMatrixPosition(m);
          root.updateMatrixWorld(true);
          pos.applyMatrix4(root.matrixWorld);
          sampleRenderPos = { x: pos.x, y: pos.y, z: pos.z };
        }
      }
      return {
        layerCount: layers.length,
        enabledLayers: layers.filter((layer) => layer.enabled && layer.assetUrl).length,
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
        for (const state of layerStates.values()) {
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
