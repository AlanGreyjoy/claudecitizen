import * as THREE from 'three';
import type { Planet, PlanetSpawnLayer, SurfaceSpawnInstance, SurfaceSpawnMeshCollision, TileInfo, Vec3 } from '../../types';
import { distance } from '../../math/vec3';
import { loadSurfaceSpawnAsset } from './asset-cache';
import { composeSurfaceSpawnMatrix } from './instance-matrix';
import type { InstancedAsset } from '../vegetation/render/instanced-assets';
import { createAnchorFromTile } from '../vegetation/domain/surface-anchor';
import {
  getSurfaceSpawnDistanceMeters,
  SURFACE_SPAWN_REFOCUS_METERS,
} from './domain/constants';

const MAX_INSTANCES_PER_BATCH_MESH = 4096;
const MAX_VISIBLE_INSTANCES = 12_288;
const HIGH_PART_COUNT_WARN = 8;
/** Slack added to a tile's instance bounds so props never pop at frustum edges. */
const TILE_BOUNDS_MARGIN_METERS = 24;
/** Smallest InstancedMesh allocation — avoids realloc churn on sparse tiles. */
const MIN_MESH_CAPACITY = 32;

export interface TileEntry {
  key: string;
  tileInfo: TileInfo;
  instances: SurfaceSpawnInstance[];
  lastUsedFrame: number;
  status: 'loading-disk' | 'pending' | 'building' | 'ready';
  buildId: number;
  renderGroup?: THREE.Group;
  renderAnchor?: Vec3;
  renderMeshes?: Map<string, THREE.InstancedMesh[]>;
  /** Instance lists already composed into GPU buffers, keyed by assetUrl. */
  writtenPacked?: Map<string, SurfaceSpawnInstance[]>;
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
  planet: Planet;
  root: THREE.Group;
  seed: number;
  tileCache: Map<string, TileEntry>;
}

interface PackedSpawnRecord {
  entry: TileEntry;
  instance: SurfaceSpawnInstance;
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

function squaredDistanceTo(instance: SurfaceSpawnInstance, focus: Vec3): number {
  const dx = instance.position.x - focus.x;
  const dy = instance.position.y - focus.y;
  const dz = instance.position.z - focus.z;
  return dx * dx + dy * dy + dz * dz;
}

/** Same instance objects in the same slots — nothing to recompose. */
function sameInstanceList(
  a: SurfaceSpawnInstance[] | undefined,
  b: SurfaceSpawnInstance[],
): boolean {
  if (!a || a.length !== b.length) return false;
  for (let i = 0; i < a.length; i += 1) {
    if (a[i] !== b[i]) return false;
  }
  return true;
}

function selectInstancesForBatch(
  records: PackedSpawnRecord[],
  capacity: number,
  focus: Vec3,
): { selected: PackedSpawnRecord[]; capped: boolean } {
  if (records.length <= capacity) {
    // Stable order — never reshuffle by player distance (that reassigns GPU
    // slots and makes rocks appear to spin/tumble while walking).
    return {
      selected: records
        .slice()
        .sort((a, b) => compareInstancesStable(a.instance, b.instance)),
      capped: false,
    };
  }
  const nearest = records
    .slice()
    .sort(
      (a, b) =>
        squaredDistanceTo(a.instance, focus) -
        squaredDistanceTo(b.instance, focus),
    );
  const kept = nearest
    .slice(0, capacity)
    .sort((a, b) => compareInstancesStable(a.instance, b.instance));
  return { selected: kept, capped: true };
}

/** Tiles are up to ~300 m across near the player; reject them whole first. */
function tileOutsideDrawDistance(
  entry: TileEntry,
  focus: Vec3,
  drawDistanceMeters: number,
): boolean {
  return (
    distance(focus, entry.tileInfo.centerPosition) >
    drawDistanceMeters + entry.tileInfo.spanMeters
  );
}

interface UncappedPackState {
  packedByTile: Map<string, Map<string, SurfaceSpawnInstance[]>>;
  perAsset: Map<string, number>;
  total: number;
}

/** False once a cap trips — the whole pack then falls back to ranked selection. */
function packTileUncapped(
  ctx: SurfaceSpawnBatchCtx,
  entry: TileEntry,
  focus: Vec3,
  drawDistanceSq: number,
  state: UncappedPackState,
): boolean {
  let tileAssets: Map<string, SurfaceSpawnInstance[]> | undefined;
  for (const instance of entry.instances) {
    if (squaredDistanceTo(instance, focus) > drawDistanceSq) continue;
    const assetUrl = ctx.entryAssetUrl.get(instance.layerId);
    if (!assetUrl || !ctx.batchStates.has(assetUrl)) continue;
    state.total += 1;
    const used = (state.perAsset.get(assetUrl) ?? 0) + 1;
    if (
      state.total > MAX_VISIBLE_INSTANCES ||
      used > MAX_INSTANCES_PER_BATCH_MESH
    ) {
      return false;
    }
    state.perAsset.set(assetUrl, used);
    if (!tileAssets) {
      tileAssets = new Map();
      state.packedByTile.set(entry.key, tileAssets);
    }
    const list = tileAssets.get(assetUrl);
    if (list) list.push(instance);
    else tileAssets.set(assetUrl, [instance]);
  }
  return true;
}

/**
 * Common case: nothing is over budget, so the pack is one pass over the tiles
 * with no per-instance record objects and no sorting. Each tile's own order is
 * already stable, which is all the GPU slots need. Returns null when a cap is
 * hit so the caller falls back to the distance-ranked path.
 */
function buildUncappedSelection(
  ctx: SurfaceSpawnBatchCtx,
  focus: Vec3,
  drawDistanceMeters: number,
): Map<string, Map<string, SurfaceSpawnInstance[]>> | null {
  const state: UncappedPackState = {
    packedByTile: new Map(),
    perAsset: new Map(),
    total: 0,
  };
  const drawDistanceSq = drawDistanceMeters * drawDistanceMeters;
  for (const entry of ctx.tileCache.values()) {
    if (entry.status !== 'ready') continue;
    if (tileOutsideDrawDistance(entry, focus, drawDistanceMeters)) continue;
    if (!packTileUncapped(ctx, entry, focus, drawDistanceSq, state)) return null;
  }
  return state.packedByTile;
}

function meshCapacityFor(required: number): number {
  let capacity = MIN_MESH_CAPACITY;
  while (capacity < required) capacity *= 2;
  return Math.min(capacity, MAX_INSTANCES_PER_BATCH_MESH);
}

/**
 * Tile-local sphere covering every instance the tile can show. Fixed for the
 * tile's lifetime, so frustum culling stays valid across repacks (Three would
 * otherwise recompute per-frame bounds from the live instance matrices).
 */
function computeTileBounds(entry: TileEntry, anchor: Vec3): THREE.Sphere {
  const sphere = new THREE.Sphere();
  const box = new THREE.Box3();
  const point = new THREE.Vector3();
  for (const instance of entry.instances) {
    point.set(
      instance.position.x - anchor.x,
      instance.position.y - anchor.y,
      instance.position.z - anchor.z,
    );
    box.expandByPoint(point);
  }
  if (box.isEmpty()) {
    return sphere.set(new THREE.Vector3(), entry.tileInfo.spanMeters);
  }
  box.getBoundingSphere(sphere);
  sphere.radius += TILE_BOUNDS_MARGIN_METERS;
  return sphere;
}

/**
 * InstancedMesh owns a GPU buffer for its instance matrices; dropping the
 * reference without dispose() leaks it for the session.
 */
function releaseTileMeshes(
  group: THREE.Object3D | undefined,
  meshes: readonly THREE.InstancedMesh[],
): void {
  for (const mesh of meshes) {
    group?.remove(mesh);
    // Geometry/materials are owned by the asset cache — only the instance
    // buffers belong to this mesh.
    mesh.dispose();
  }
}

function releaseGroupMeshes(group: THREE.Object3D): void {
  group.traverse((object) => {
    if (object instanceof THREE.InstancedMesh) object.dispose();
  });
  group.clear();
}

export function createSurfaceSpawnBatch(ctx: SurfaceSpawnBatchCtx) {

  let packedSelectionDirty = true;
  let lastPackedByTile = new Map<string, Map<string, SurfaceSpawnInstance[]>>();
  let lastSelectionFocus: Vec3 | null = null;
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
    for (const entry of ctx.tileCache.values()) {
      const meshes = entry.renderMeshes?.get(state.assetUrl);
      if (!meshes) continue;
      releaseTileMeshes(entry.renderGroup, meshes);
      entry.renderMeshes?.delete(state.assetUrl);
      entry.writtenPacked?.delete(state.assetUrl);
    }
    state.meshes = [];
  }

  function rebuildBatchMeshes(state: AssetBatchState): void {
    clearBatchMeshes(state);
    // Tile-local InstancedMeshes are created when the tile is packed. The
    // asset load only invalidates the pack; it must not create a planet-wide
    // batch whose transform has a different origin contract than trees.
    if (state.asset) packedSelectionDirty = true;
  }

  function clearTileRenderGroups(): void {
    for (const child of [...ctx.root.children]) {
      if (child.userData.surfaceSpawnTileKey === undefined) continue;
      ctx.root.remove(child);
      releaseGroupMeshes(child);
    }
    for (const entry of ctx.tileCache.values()) {
      entry.renderGroup = undefined;
      entry.renderAnchor = undefined;
      entry.renderMeshes = undefined;
      entry.writtenPacked = undefined;
    }
    for (const state of ctx.batchStates.values()) state.meshes = [];
  }

  function rebuildAllBatchStates(): void {
    clearTileRenderGroups();
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

  function ensureTileRenderGroup(entry: TileEntry): THREE.Group {
    if (entry.renderGroup && entry.renderMeshes && entry.renderAnchor) {
      return entry.renderGroup;
    }
    const anchor = createAnchorFromTile(entry.tileInfo, ctx.planet, ctx.seed).position;
    const group = new THREE.Group();
    group.name = `surface-spawn-tile:${entry.key}`;
    group.userData.surfaceSpawnTileKey = entry.key;
    group.position.set(anchor.x, anchor.y, anchor.z);
    ctx.root.add(group);
    entry.renderAnchor = { x: anchor.x, y: anchor.y, z: anchor.z };
    entry.renderGroup = group;
    entry.renderMeshes = new Map();
    return group;
  }

  function ensureTileAssetMeshes(
    entry: TileEntry,
    assetUrl: string,
    state: AssetBatchState,
    capacity: number,
  ): THREE.InstancedMesh[] {
    const group = ensureTileRenderGroup(entry);
    const existing = entry.renderMeshes?.get(assetUrl);
    // Packed counts grow as the global budget frees slots for this tile; a mesh
    // that is too small would silently drop matrix writes and then draw the
    // uninitialized tail.
    if (existing && (existing[0]?.instanceMatrix.count ?? 0) >= capacity) {
      return existing;
    }
    if (existing) {
      releaseTileMeshes(group, existing);
      entry.renderMeshes?.delete(assetUrl);
      entry.writtenPacked?.delete(assetUrl);
    }
    const asset = state.asset;
    if (!asset?.parts.length || capacity <= 0) return [];
    const bounds = computeTileBounds(entry, entry.renderAnchor!);
    const meshes = asset.parts.map((part) => {
      const mesh = new THREE.InstancedMesh(
        part.geometry,
        part.material,
        meshCapacityFor(capacity),
      );
      mesh.instanceMatrix.setUsage(THREE.DynamicDrawUsage);
      // One fixed tile-local sphere keeps culling valid across repacks, so
      // off-screen tiles cost nothing instead of being submitted every frame.
      mesh.boundingSphere = bounds.clone();
      mesh.castShadow = false;
      mesh.receiveShadow = true;
      group.add(mesh);
      return mesh;
    });
    entry.renderMeshes?.set(assetUrl, meshes);
    return meshes;
  }

  function collectRecordsByAsset(
    focus: Vec3,
    drawDistanceMeters: number,
  ): Map<string, PackedSpawnRecord[]> {
    const byAsset = new Map<string, PackedSpawnRecord[]>();
    const drawDistanceSq = drawDistanceMeters * drawDistanceMeters;
    for (const entry of ctx.tileCache.values()) {
      if (entry.status !== 'ready') continue;
      if (tileOutsideDrawDistance(entry, focus, drawDistanceMeters)) continue;
      for (const instance of entry.instances) {
        if (squaredDistanceTo(instance, focus) > drawDistanceSq) continue;
        const assetUrl = ctx.entryAssetUrl.get(instance.layerId);
        if (!assetUrl) continue;
        const list = byAsset.get(assetUrl);
        const record = { entry, instance };
        if (list) list.push(record);
        else byAsset.set(assetUrl, [record]);
      }
    }
    return byAsset;
  }

  function trimGlobalSelection(
    byAsset: Map<string, PackedSpawnRecord[]>,
  ): boolean {
    // push(...list) spreads every record as a call argument and blows the stack
    // once a busy neighborhood exceeds the engine's argument limit.
    const allForBudget: PackedSpawnRecord[] = [];
    for (const list of byAsset.values()) {
      for (const record of list) allForBudget.push(record);
    }
    if (allForBudget.length <= MAX_VISIBLE_INSTANCES) return false;

    const focus = ctx.getLastFocus();
    const keepSet = new Set(
      allForBudget
        .slice()
        .sort(
          (a, b) =>
            squaredDistanceTo(a.instance, focus) -
            squaredDistanceTo(b.instance, focus),
        )
        .slice(0, MAX_VISIBLE_INSTANCES),
    );
    for (const [assetUrl, list] of byAsset) {
      byAsset.set(
        assetUrl,
        list.filter((record) => keepSet.has(record)),
      );
    }
    return true;
  }

  function buildTilePackedSelection(
    byAsset: Map<string, PackedSpawnRecord[]>,
  ): { packed: Map<string, Map<string, SurfaceSpawnInstance[]>>; capped: boolean } {
    let capped = false;
    // Hoisted: the comparators run O(n log n) times and the focus cannot move
    // inside one selection pass.
    const focus = ctx.getLastFocus();
    const packedByAsset = new Map<string, PackedSpawnRecord[]>();
    for (const assetUrl of ctx.batchStates.keys()) {
      const list = byAsset.get(assetUrl) ?? [];
      const result = selectInstancesForBatch(
        list,
        MAX_INSTANCES_PER_BATCH_MESH,
        focus,
      );
      packedByAsset.set(assetUrl, result.selected);
      if (result.capped) capped = true;
    }

    const packedByTile = new Map<string, Map<string, SurfaceSpawnInstance[]>>();
    for (const [assetUrl, records] of packedByAsset) {
      for (const { entry, instance } of records) {
        let tileAssets = packedByTile.get(entry.key);
        if (!tileAssets) {
          tileAssets = new Map();
          packedByTile.set(entry.key, tileAssets);
        }
        const tileInstances = tileAssets.get(assetUrl);
        if (tileInstances) tileInstances.push(instance);
        else tileAssets.set(assetUrl, [instance]);
      }
    }
    return { packed: packedByTile, capped };
  }

  function rebuildPackedSelection(): void {
    const focus = ctx.getLastFocus();
    const drawDistance = getSurfaceSpawnDistanceMeters();
    const uncapped = buildUncappedSelection(ctx, focus, drawDistance);
    if (uncapped) {
      lastPackedByTile = uncapped;
    } else {
      const byAsset = collectRecordsByAsset(focus, drawDistance);
      trimGlobalSelection(byAsset);
      lastPackedByTile = buildTilePackedSelection(byAsset).packed;
    }
    lastSelectionFocus = { x: focus.x, y: focus.y, z: focus.z };
    packedSelectionDirty = false;
  }

  function hideTileMeshes(entry: TileEntry): void {
    for (const meshes of entry.renderMeshes?.values() ?? []) {
      for (const mesh of meshes) {
        mesh.count = 0;
        mesh.visible = false;
      }
    }
    // Zeroed counts must be re-composed if the same list is packed again.
    entry.writtenPacked = undefined;
  }

  function writeTileAssetMatrices(
    entry: TileEntry,
    assetUrl: string,
    instances: SurfaceSpawnInstance[],
    state: AssetBatchState,
  ): void {
    if (!state.asset) return;
    const meshes = ensureTileAssetMeshes(entry, assetUrl, state, instances.length);
    if (meshes.length === 0) return;
    // A tile arriving anywhere marks the whole selection dirty; without this,
    // every repack re-composes every visible instance (trig per matrix).
    if (sameInstanceList(entry.writtenPacked?.get(assetUrl), instances)) {
      for (const mesh of meshes) {
        mesh.visible = ctx.getVisible() && instances.length > 0;
        state.meshes.push(mesh);
      }
      return;
    }
    const anchor = entry.renderAnchor!;
    // Never write or draw past the allocated buffer, whatever the caps say.
    const writable = Math.min(instances.length, meshes[0]!.instanceMatrix.count);
    for (let i = 0; i < writable; i += 1) {
      const inst = instances[i]!;
      relativeScratch.x = inst.position.x - anchor.x;
      relativeScratch.y = inst.position.y - anchor.y;
      relativeScratch.z = inst.position.z - anchor.z;
      composeSurfaceSpawnMatrix(
        relativeScratch,
        inst.normal,
        inst.yawRadians,
        inst.scale,
        matrixScratch,
      );
      state.scratch.fromArray(matrixScratch);
      if (state.asset.baseOffsetY !== 0) {
        const lift = state.asset.baseOffsetY * inst.scale;
        state.scratch.elements[12] += inst.normal.x * lift;
        state.scratch.elements[13] += inst.normal.y * lift;
        state.scratch.elements[14] += inst.normal.z * lift;
      }
      for (const mesh of meshes) mesh.setMatrixAt(i, state.scratch);
    }
    for (const mesh of meshes) {
      mesh.count = writable;
      mesh.instanceMatrix.needsUpdate = true;
      mesh.visible = ctx.getVisible() && writable > 0;
      state.meshes.push(mesh);
    }
    if (!entry.writtenPacked) entry.writtenPacked = new Map();
    entry.writtenPacked.set(assetUrl, instances);
  }

  function hideUnpackedTileAssets(
    entry: TileEntry,
    tileAssets: Map<string, SurfaceSpawnInstance[]>,
  ): void {
    for (const [assetUrl, meshes] of entry.renderMeshes ?? []) {
      if (tileAssets.has(assetUrl)) continue;
      for (const mesh of meshes) {
        mesh.count = 0;
        mesh.visible = false;
      }
      entry.writtenPacked?.delete(assetUrl);
    }
  }

  function writePackedMatrices(): void {
    // Match vegetation exactly: the root is the moving floating origin, each
    // tile group is fixed at its surface anchor, and instance matrices are
    // permanently local to that tile. No matrix contains player position.
    const focus = ctx.getLastFocus();
    updateFloatingOrigin(focus);

    for (const state of ctx.batchStates.values()) state.meshes = [];
    for (const entry of ctx.tileCache.values()) {
      const tileAssets = lastPackedByTile.get(entry.key);
      if (entry.status !== 'ready' || !tileAssets || tileAssets.size === 0) {
        hideTileMeshes(entry);
        continue;
      }

      const group = ensureTileRenderGroup(entry);
      for (const [assetUrl, instances] of tileAssets) {
        const state = ctx.batchStates.get(assetUrl);
        if (!state?.asset) continue;
        writeTileAssetMatrices(entry, assetUrl, instances, state);
      }

      // Hide an asset's old tile meshes if this repack no longer selected it.
      hideUnpackedTileAssets(entry, tileAssets);
      group.visible = ctx.getVisible();
    }

    // Eviction removes entries from tileCache before the batch is refreshed.
    // Remove their tile groups now so stale props cannot remain at an old
    // world position.
    for (const child of [...ctx.root.children]) {
      const key = child.userData.surfaceSpawnTileKey;
      if (typeof key === 'string' && !ctx.tileCache.has(key)) {
        ctx.root.remove(child);
        releaseGroupMeshes(child);
      }
    }
  }

  function updateFloatingOrigin(focus: Vec3): void {
    const scale = ctx.root.scale.x;
    ctx.root.position.set(
      -focus.x * scale,
      -focus.y * scale,
      -focus.z * scale,
    );
  }

  function refreshInstanceMeshes(force = false): void {
    if (force) packedSelectionDirty = true;
    // The pack is radial now, so walking changes it even when nothing streamed.
    if (
      lastSelectionFocus &&
      distance(ctx.getLastFocus(), lastSelectionFocus) >= SURFACE_SPAWN_REFOCUS_METERS
    ) {
      packedSelectionDirty = true;
    }

    if (!packedSelectionDirty) return;

    rebuildPackedSelection();
    writePackedMatrices();
  }
  return {
    clearAllBatchMeshes: () => {
      clearTileRenderGroups();
      for (const state of ctx.batchStates.values()) clearBatchMeshes(state);
    },
    hideAllTiles: () => {
      for (const entry of ctx.tileCache.values()) hideTileMeshes(entry);
      for (const state of ctx.batchStates.values()) state.meshes = [];
      packedSelectionDirty = true;
    },
    markPackedSelectionDirty,
    rebuildAllBatchStates,
    rebuildEntryMaps,
    refreshInstanceMeshes,
    updateFloatingOrigin,
    resetPackedSelection: () => {
      clearTileRenderGroups();
      lastSelectionFocus = null;
      lastPackedByTile = new Map();
      packedSelectionDirty = true;
      ctx.root.position.set(0, 0, 0);
    },
  };
}
