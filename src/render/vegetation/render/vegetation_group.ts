import * as THREE from 'three';
import type { Vec3 } from '../../../types';
import { getGrassDistanceMeters } from '../domain/constants';
import type { StoredVegetationInstance, StoredVegetationTile } from '../domain/storage';
import type { InstancedAsset } from './instanced_assets';
import {
  createTreeLodState,
  hasTreeNearFocus,
  initializeTreeLodAllLow,
  type TreeLodMeshes,
  updateTreeLodMeshes,
} from './tree_lod_update';

export interface VegetationRenderGroup {
  group: THREE.Group;
  anchor: Vec3;
  updateTreeLod: (focusWorldPosition: Vec3) => void;
  hasTreeNearFocus: (focusWorldPosition: Vec3, radiusMeters: number) => boolean;
  setGrassVisible: (visible: boolean) => void;
  setTreesVisible: (visible: boolean) => void;
  /** Pack grass instances inside the player radius (meters). */
  updateGrassRadius: (focusWorldPosition: Vec3, radiusMeters?: number) => void;
}

// LOD meshes swap instances (and counts) every update, so instead of
// recomputing per-frame bounds we give every LOD mesh one fixed sphere that
// covers all tree positions in the tile. Culling stays valid no matter which
// instances are currently high or low detail.
const TREE_BOUNDS_MARGIN_METERS = 40;

function computeInstanceBoundingSphere(
  instances: StoredVegetationInstance[],
): THREE.Sphere {
  const box = new THREE.Box3();
  const point = new THREE.Vector3();
  for (const instance of instances) {
    point.set(instance.matrix[12], instance.matrix[13], instance.matrix[14]);
    box.expandByPoint(point);
  }
  const sphere = new THREE.Sphere();
  box.getBoundingSphere(sphere);
  sphere.radius += TREE_BOUNDS_MARGIN_METERS;
  return sphere;
}

function createEmptyInstancedMeshes(
  group: THREE.Group,
  asset: InstancedAsset | null | undefined,
  capacity: number,
  options: { castShadow: boolean; receiveShadow: boolean },
  boundingSphere: THREE.Sphere | null = null,
): THREE.InstancedMesh[] {
  if (!asset?.parts?.length || capacity === 0) return [];

  const meshes: THREE.InstancedMesh[] = [];
  for (const part of asset.parts) {
    const mesh = new THREE.InstancedMesh(
      part.geometry,
      part.material,
      capacity,
    );
    if (boundingSphere) {
      mesh.boundingSphere = boundingSphere.clone();
    } else {
      mesh.computeBoundingSphere();
      if (mesh.boundingSphere) {
        mesh.boundingSphere.radius = Math.max(mesh.boundingSphere.radius, 4) + 2;
      }
    }
    mesh.castShadow = options.castShadow;
    mesh.receiveShadow = options.receiveShadow;
    mesh.count = 0;
    group.add(mesh);
    meshes.push(mesh);
  }
  return meshes;
}

function packStoredMatricesByVariant(
  instances: StoredVegetationInstance[],
  assetCount: number,
): Float32Array[] {
  const counts = countInstancesPerVariant(instances, assetCount);
  const packed = counts.map((count) => new Float32Array(count * 16));
  const offsets = new Array<number>(assetCount).fill(0);
  if (assetCount === 0) return packed;

  for (const instance of instances) {
    const index = Math.max(0, Math.min(assetCount - 1, instance.variantIndex));
    packed[index].set(instance.matrix, offsets[index]);
    offsets[index] += 16;
  }
  return packed;
}

function countInstancesPerVariant(
  instances: StoredVegetationInstance[],
  assetCount: number,
): number[] {
  const counts = new Array<number>(assetCount).fill(0);
  if (assetCount === 0) return counts;

  for (const instance of instances) {
    const index = Math.max(0, Math.min(assetCount - 1, instance.variantIndex));
    counts[index] += 1;
  }
  return counts;
}

function buildTreeLodMeshes(
  group: THREE.Group,
  anchor: Vec3,
  instances: StoredVegetationInstance[],
  treeAssets: InstancedAsset[],
  treeLodAsset: InstancedAsset | null,
): TreeLodMeshes | null {
  if (
    instances.length === 0 ||
    treeAssets.length === 0 ||
    !treeLodAsset?.parts?.length
  ) {
    return null;
  }

  const counts = countInstancesPerVariant(instances, treeAssets.length);
  const tileBounds = computeInstanceBoundingSphere(instances);
  const highMeshes: THREE.InstancedMesh[][] = [];

  treeAssets.forEach((asset, variantIndex) => {
    const capacity = counts[variantIndex] ?? 0;
    highMeshes.push(
      createEmptyInstancedMeshes(
        group,
        asset,
        capacity,
        {
          castShadow: true,
          receiveShadow: true,
        },
        tileBounds,
      ),
    );
  });

  const lowPartMeshes = createEmptyInstancedMeshes(
    group,
    treeLodAsset,
    instances.length,
    {
      castShadow: false,
      receiveShadow: true,
    },
    tileBounds,
  );

  const lod = createTreeLodState(
    anchor,
    instances,
    highMeshes,
    lowPartMeshes[0] ?? null,
    treeAssets.length,
  );
  initializeTreeLodAllLow(lod);
  return lod;
}

interface GrassRadiusState {
  anchor: Vec3;
  assets: InstancedAsset[];
  /** Packed tile-local matrices. Mesh buffers are allocated only for the near field. */
  matricesByVariant: Float32Array[];
  /** Per variant: InstancedMesh parts (usually one mesh each). */
  meshesByVariant: THREE.InstancedMesh[][];
  tempMatrix: THREE.Matrix4;
  lastPackedFocus: Vec3 | null;
  visible: boolean;
}

function releaseInstancedMeshes(
  group: THREE.Group,
  meshes: THREE.InstancedMesh[],
): void {
  for (const mesh of meshes) {
    group.remove(mesh);
    mesh.dispose();
  }
  meshes.length = 0;
}

function releaseGrassMeshes(group: THREE.Group, state: GrassRadiusState): void {
  for (const meshes of state.meshesByVariant) {
    releaseInstancedMeshes(group, meshes);
  }
  state.meshesByVariant = state.matricesByVariant.map(() => []);
  state.lastPackedFocus = null;
}

function grassAllocationCapacity(required: number, available: number): number {
  let capacity = 64;
  while (capacity < required) capacity *= 2;
  return Math.min(capacity, available);
}

function ensureGrassMeshCapacity(
  group: THREE.Group,
  state: GrassRadiusState,
  variant: number,
  required: number,
): THREE.InstancedMesh[] {
  const existing = state.meshesByVariant[variant] ?? [];
  const existingCapacity = existing[0]?.instanceMatrix.count ?? 0;
  if (existing.length > 0 && existingCapacity >= required) return existing;

  releaseInstancedMeshes(group, existing);
  if (required === 0) return existing;

  const available = (state.matricesByVariant[variant]?.length ?? 0) / 16;
  const meshes = createEmptyInstancedMeshes(
    group,
    state.assets[variant],
    grassAllocationCapacity(required, available),
    { castShadow: false, receiveShadow: true },
  );
  state.meshesByVariant[variant] = meshes;
  return meshes;
}

function initGrassMeshes(
  group: THREE.Group,
  grassAssets: InstancedAsset[],
  instances: StoredVegetationInstance[],
  radiusState: GrassRadiusState,
): void {
  releaseGrassMeshes(group, radiusState);
  radiusState.assets = grassAssets;
  radiusState.matricesByVariant = packStoredMatricesByVariant(
    instances,
    grassAssets.length,
  );
  radiusState.meshesByVariant = radiusState.matricesByVariant.map(() => []);
  radiusState.lastPackedFocus = null;
}

function packGrassVariant(
  group: THREE.Group,
  state: GrassRadiusState,
  variant: number,
  focusWorldPosition: Vec3,
  radiusSquared: number,
): void {
  const fx = focusWorldPosition.x;
  const fy = focusWorldPosition.y;
  const fz = focusWorldPosition.z;
  const ax = state.anchor.x;
  const ay = state.anchor.y;
  const az = state.anchor.z;
  const temp = state.tempMatrix;
  const matrices = state.matricesByVariant[variant];
  if (!matrices?.length) {
    for (const mesh of state.meshesByVariant[variant] ?? []) mesh.count = 0;
    return;
  }

  let required = 0;
  for (let offset = 0; offset < matrices.length; offset += 16) {
    const dx = ax + matrices[offset + 12] - fx;
    const dy = ay + matrices[offset + 13] - fy;
    const dz = az + matrices[offset + 14] - fz;
    if (dx * dx + dy * dy + dz * dz <= radiusSquared) required += 1;
  }

  const meshes = ensureGrassMeshCapacity(group, state, variant, required);
  let write = 0;
  for (let offset = 0; offset < matrices.length; offset += 16) {
    const dx = ax + matrices[offset + 12] - fx;
    const dy = ay + matrices[offset + 13] - fy;
    const dz = az + matrices[offset + 14] - fz;
    if (dx * dx + dy * dy + dz * dz > radiusSquared) continue;
    temp.fromArray(matrices, offset);
    for (const mesh of meshes) {
      mesh.setMatrixAt(write, temp);
    }
    write += 1;
  }
  for (const mesh of meshes) {
    mesh.count = write;
    mesh.instanceMatrix.needsUpdate = true;
    mesh.computeBoundingSphere();
    if (mesh.boundingSphere) mesh.boundingSphere.radius += 2;
  }
}

function packGrassWithinRadius(
  group: THREE.Group,
  state: GrassRadiusState,
  focusWorldPosition: Vec3,
  radiusMeters: number,
): void {
  if (!state.visible) return;

  const fx = focusWorldPosition.x;
  const fy = focusWorldPosition.y;
  const fz = focusWorldPosition.z;
  if (state.lastPackedFocus) {
    const dx = fx - state.lastPackedFocus.x;
    const dy = fy - state.lastPackedFocus.y;
    const dz = fz - state.lastPackedFocus.z;
    // Same threshold as the manager grass focus move (~1 m).
    if (dx * dx + dy * dy + dz * dz < 1) return;
  }

  const radiusSquared = radiusMeters * radiusMeters;
  for (let variant = 0; variant < state.matricesByVariant.length; variant += 1) {
    packGrassVariant(
      group,
      state,
      variant,
      focusWorldPosition,
      radiusSquared,
    );
  }
  state.lastPackedFocus = { x: fx, y: fy, z: fz };
}

function setTreeLodMeshesVisible(lod: TreeLodMeshes | null, visible: boolean): void {
  if (!lod) return;
  for (const partMeshes of lod.highMeshes) {
    for (const mesh of partMeshes) mesh.visible = visible;
  }
  if (lod.lowMesh) lod.lowMesh.visible = visible;
}

export function createEmptyVegetationRenderGroup(): VegetationRenderGroup {
  return {
    anchor: { x: 0, y: 0, z: 0 },
    group: new THREE.Group(),
    hasTreeNearFocus: () => false,
    updateTreeLod: () => {},
    setGrassVisible: () => {},
    setTreesVisible: () => {},
    updateGrassRadius: () => {},
  };
}

export function createVegetationGroupFromStored(
  data: StoredVegetationTile,
  grassAssets: InstancedAsset[],
  treeAssets: InstancedAsset[],
  treeLodAsset: InstancedAsset | null,
): VegetationRenderGroup {
  const group = new THREE.Group();
  group.position.set(data.anchor.x, data.anchor.y, data.anchor.z);

  const grassRadiusState: GrassRadiusState = {
    anchor: data.anchor,
    assets: [],
    matricesByVariant: [],
    meshesByVariant: [],
    tempMatrix: new THREE.Matrix4(),
    lastPackedFocus: null,
    visible: false,
  };
  initGrassMeshes(
    group,
    grassAssets,
    data.grass,
    grassRadiusState,
  );

  const treeLod = buildTreeLodMeshes(
    group,
    data.anchor,
    data.trees,
    treeAssets,
    treeLodAsset,
  );
  let treesVisible = true;

  return {
    anchor: data.anchor,
    group,
    hasTreeNearFocus: (focusWorldPosition, radiusMeters) =>
      treeLod
        ? hasTreeNearFocus(treeLod, focusWorldPosition, radiusMeters)
        : false,
    updateTreeLod: (focusWorldPosition) => {
      if (treeLod && treesVisible) updateTreeLodMeshes(treeLod, focusWorldPosition);
    },
    setGrassVisible: (visible) => {
      if (grassRadiusState.visible === visible) return;
      grassRadiusState.visible = visible;
      if (!visible) releaseGrassMeshes(group, grassRadiusState);
    },
    setTreesVisible: (visible) => {
      if (treesVisible === visible) return;
      treesVisible = visible;
      setTreeLodMeshesVisible(treeLod, visible);
    },
    updateGrassRadius: (focusWorldPosition, radiusMeters = getGrassDistanceMeters()) => {
      packGrassWithinRadius(
        group,
        grassRadiusState,
        focusWorldPosition,
        radiusMeters,
      );
    },
  };
}

export function releaseVegetationGroup(
  parent: THREE.Group,
  group: THREE.Group | null,
): void {
  if (!group) return;
  parent.remove(group);
  group.traverse((object) => {
    if (object instanceof THREE.InstancedMesh) object.dispose();
  });
  group.clear();
}
