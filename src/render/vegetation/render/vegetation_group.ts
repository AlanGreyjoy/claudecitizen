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
    // Only grass flows through this path; at lush densities thousands of tiny
    // shadow casters per tile bloat the shadow pass with no visible payoff.
    mesh.castShadow = false;
    mesh.receiveShadow = true;
    matrices.forEach((matrix, index) => mesh.setMatrixAt(index, matrix));
    mesh.instanceMatrix.needsUpdate = true;
    // Instance-aware bounds so frustum culling can drop off-screen tiles.
    mesh.computeBoundingSphere();
    group.add(mesh);
  }
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
      mesh.frustumCulled = false;
    }
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
