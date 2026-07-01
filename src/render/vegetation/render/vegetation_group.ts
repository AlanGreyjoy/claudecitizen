import * as THREE from 'three';
import type { Vec3 } from '../../../types';
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
}

function addInstancedAsset(
  group: THREE.Group,
  asset: InstancedAsset | null | undefined,
  matrices: THREE.Matrix4[],
): void {
  if (!asset?.parts?.length || matrices.length === 0) return;

  for (const part of asset.parts) {
    const mesh = new THREE.InstancedMesh(
      part.geometry,
      part.material,
      matrices.length,
    );
    mesh.frustumCulled = false;
    mesh.castShadow = true;
    mesh.receiveShadow = true;
    matrices.forEach((matrix, index) => mesh.setMatrixAt(index, matrix));
    mesh.instanceMatrix.needsUpdate = true;
    group.add(mesh);
  }
}

function createEmptyInstancedMeshes(
  group: THREE.Group,
  asset: InstancedAsset | null | undefined,
  capacity: number,
  options: { castShadow: boolean; receiveShadow: boolean },
): THREE.InstancedMesh[] {
  if (!asset?.parts?.length || capacity === 0) return [];

  const meshes: THREE.InstancedMesh[] = [];
  for (const part of asset.parts) {
    const mesh = new THREE.InstancedMesh(
      part.geometry,
      part.material,
      capacity,
    );
    mesh.frustumCulled = false;
    mesh.castShadow = options.castShadow;
    mesh.receiveShadow = options.receiveShadow;
    mesh.count = 0;
    group.add(mesh);
    meshes.push(mesh);
  }
  return meshes;
}

function groupStoredInstances(
  instances: StoredVegetationInstance[],
  assetCount: number,
): THREE.Matrix4[][] {
  const grouped: THREE.Matrix4[][] = Array.from({ length: assetCount }, () => []);
  if (assetCount === 0) return grouped;

  for (const instance of instances) {
    const index = Math.max(0, Math.min(assetCount - 1, instance.variantIndex));
    grouped[index].push(new THREE.Matrix4().fromArray(instance.matrix));
  }
  return grouped;
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
  const highMeshes: THREE.InstancedMesh[][] = [];

  treeAssets.forEach((asset, variantIndex) => {
    const capacity = counts[variantIndex] ?? 0;
    highMeshes.push(
      createEmptyInstancedMeshes(group, asset, capacity, {
        castShadow: true,
        receiveShadow: true,
      }),
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

export function createEmptyVegetationRenderGroup(): VegetationRenderGroup {
  return {
    anchor: { x: 0, y: 0, z: 0 },
    group: new THREE.Group(),
    hasTreeNearFocus: () => false,
    updateTreeLod: () => {},
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

  const groupedGrass = groupStoredInstances(data.grass, grassAssets.length);
  groupedGrass.forEach((matrices, assetIndex) => {
    addInstancedAsset(group, grassAssets[assetIndex], matrices);
  });

  const treeLod = buildTreeLodMeshes(
    group,
    data.anchor,
    data.trees,
    treeAssets,
    treeLodAsset,
  );

  return {
    anchor: data.anchor,
    group,
    hasTreeNearFocus: (focusWorldPosition, radiusMeters) =>
      treeLod
        ? hasTreeNearFocus(treeLod, focusWorldPosition, radiusMeters)
        : false,
    updateTreeLod: (focusWorldPosition) => {
      if (treeLod) updateTreeLodMeshes(treeLod, focusWorldPosition);
    },
  };
}

export function releaseVegetationGroup(
  parent: THREE.Group,
  group: THREE.Group | null,
): void {
  if (!group) return;
  parent.remove(group);
  group.clear();
}
