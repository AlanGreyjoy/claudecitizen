import * as THREE from 'three';
import type { PlanetSpawnLayer, SurfaceSpawnInstance, SurfaceSpawnMeshCollision, TileInfo, Vec3 } from '../../types';
import { distance } from '../../math/vec3';
import { loadSurfaceSpawnAsset } from './asset-cache';
import { composeSurfaceSpawnMatrix } from './instance-matrix';
import type { InstancedAsset } from '../vegetation/render/instanced-assets';

const MAX_INSTANCES_PER_BATCH_MESH = 4096;
const MAX_VISIBLE_INSTANCES = 12_288;
const HIGH_PART_COUNT_WARN = 8;
const FOCUS_REPACK_METERS = 1e-4;
const CAPPED_SELECTION_REFOCUS_METERS = 25;

export interface TileEntry {
  key: string;
  tileInfo: TileInfo;
  instances: SurfaceSpawnInstance[];
  lastUsedFrame: number;
  status: 'loading-disk' | 'pending' | 'building' | 'ready';
  buildId: number;
}

export interface AssetBatchState {
  assetUrl: string;
  asset: InstancedAsset | null;
  loading: boolean;
  meshes: THREE.InstancedMesh[];
  scratch: THREE.Matrix4;
  warnedParts: boolean;
}

export interface SurfaceSpawnBatchCtx {
  batchStates: Map<string, AssetBatchState>;
  entryAssetUrl: Map<string, string>;
  getLastFocus: () => Vec3;
  getLayers: () => readonly PlanetSpawnLayer[];
  getVisible: () => boolean;
  meshCollisions: Map<string, SurfaceSpawnMeshCollision>;
  root: THREE.Group;
  tileCache: Map<string, TileEntry>;
}

export function createSurfaceSpawnBatch(ctx: SurfaceSpawnBatchCtx) {

  let packedSelectionDirty = true;
  let lastPackedByAsset = new Map<string, SurfaceSpawnInstance[]>();
  let lastPackedFocus: Vec3 | null = null;
  let lastSelectionFocus: Vec3 | null = null;
  let selectionWasCapped = false;
  const matrixScratch = new Float32Array(16);
  const relativeScratch = { x: 0, y: 0, z: 0 };
  function rebuildEntryMaps(): void {
    ctx.entryAssetUrl.clear();
    for (const entry of ctx.getLayers()) {
      if (entry.enabled && entry.assetUrl) {
        ctx.entryAssetUrl.set(entry.id, entry.assetUrl);
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
      ctx.meshCollisions.set(assetUrl, {
        halfExtents: asset.boundsHalfExtents,
        center: asset.collisionCenter,
      });
    }
  }

  function ensureBatchState(assetUrl: string): AssetBatchState {
    let state = ctx.batchStates.get(assetUrl);
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
    ctx.batchStates.set(assetUrl, state);
    state.loading = true;
    void loadSurfaceSpawnAsset(assetUrl).then((asset) => {
      const current = ctx.batchStates.get(assetUrl);
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
      ctx.root.remove(mesh);
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
      ctx.root.add(mesh);
      state.meshes.push(mesh);
    }
  }

  function rebuildAllBatchStates(): void {
    for (const state of ctx.batchStates.values()) {
      clearBatchMeshes(state);
    }
    ctx.batchStates.clear();
    ctx.meshCollisions.clear();
    rebuildEntryMaps();
    const urls = new Set(ctx.entryAssetUrl.values());
    for (const assetUrl of urls) {
      ensureBatchState(assetUrl);
    }
  }

  function collectActiveInstances(): SurfaceSpawnInstance[] {
    const out: SurfaceSpawnInstance[] = [];
    for (const entry of ctx.tileCache.values()) {
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
        (a.position.x - ctx.getLastFocus().x) ** 2 +
        (a.position.y - ctx.getLastFocus().y) ** 2 +
        (a.position.z - ctx.getLastFocus().z) ** 2;
      const db =
        (b.position.x - ctx.getLastFocus().x) ** 2 +
        (b.position.y - ctx.getLastFocus().y) ** 2 +
        (b.position.z - ctx.getLastFocus().z) ** 2;
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
      const assetUrl = ctx.entryAssetUrl.get(instance.layerId);
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
              (a.position.x - ctx.getLastFocus().x) ** 2 +
              (a.position.y - ctx.getLastFocus().y) ** 2 +
              (a.position.z - ctx.getLastFocus().z) ** 2;
            const db =
              (b.position.x - ctx.getLastFocus().x) ** 2 +
              (b.position.y - ctx.getLastFocus().y) ** 2 +
              (b.position.z - ctx.getLastFocus().z) ** 2;
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
    for (const assetUrl of ctx.batchStates.keys()) {
      const list = byAsset.get(assetUrl) ?? [];
      const result = selectInstancesForBatch(list, MAX_INSTANCES_PER_BATCH_MESH);
      packed.set(assetUrl, result.selected);
      if (result.capped) capped = true;
    }
    lastPackedByAsset = packed;
    selectionWasCapped = capped;
    lastSelectionFocus = { x: ctx.getLastFocus().x, y: ctx.getLastFocus().y, z: ctx.getLastFocus().z };
    packedSelectionDirty = false;
  }

  function writePackedMatrices(): void {
    for (const [assetUrl, state] of ctx.batchStates) {
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
        relativeScratch.x = inst.position.x - ctx.getLastFocus().x;
        relativeScratch.y = inst.position.y - ctx.getLastFocus().y;
        relativeScratch.z = inst.position.z - ctx.getLastFocus().z;
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
        mesh.visible = ctx.getVisible() && count > 0;
      }
    }
    lastPackedFocus = { x: ctx.getLastFocus().x, y: ctx.getLastFocus().y, z: ctx.getLastFocus().z };
  }

  /** Walking path: only translations change with floating-origin focus. */
  function writePackedTranslations(): void {
    for (const [assetUrl, state] of ctx.batchStates) {
      const instances = lastPackedByAsset.get(assetUrl) ?? [];
      const count = instances.length;
      const meshes = state.meshes;
      if (meshes.length === 0 || count === 0) continue;

      const primary = meshes[0]!;
      for (let i = 0; i < count; i += 1) {
        const inst = instances[i]!;
        primary.getMatrixAt(i, state.scratch);
        let tx = inst.position.x - ctx.getLastFocus().x;
        let ty = inst.position.y - ctx.getLastFocus().y;
        let tz = inst.position.z - ctx.getLastFocus().z;
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
    lastPackedFocus = { x: ctx.getLastFocus().x, y: ctx.getLastFocus().y, z: ctx.getLastFocus().z };
  }

  function refreshInstanceMeshes(force = false): void {
    if (force) packedSelectionDirty = true;
    if (
      selectionWasCapped &&
      lastSelectionFocus &&
      distance(ctx.getLastFocus(), lastSelectionFocus) >= CAPPED_SELECTION_REFOCUS_METERS
    ) {
      packedSelectionDirty = true;
    }

    const focusMoved =
      !lastPackedFocus ||
      distance(ctx.getLastFocus(), lastPackedFocus) >= FOCUS_REPACK_METERS;
    if (!packedSelectionDirty && !focusMoved) return;

    if (packedSelectionDirty) {
      rebuildPackedSelection();
      writePackedMatrices();
      return;
    }
    writePackedTranslations();
  }
  return {
    clearAllBatchMeshes: () => {
      for (const state of ctx.batchStates.values()) clearBatchMeshes(state);
    },
    collectActiveInstances,
    markPackedSelectionDirty,
    rebuildAllBatchStates,
    rebuildEntryMaps,
    refreshInstanceMeshes,
    resetPackedSelection: () => {
      lastPackedFocus = null;
      lastSelectionFocus = null;
      lastPackedByAsset = new Map();
      selectionWasCapped = false;
      packedSelectionDirty = true;
    },
  };
}
