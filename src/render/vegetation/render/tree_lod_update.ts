import * as THREE from 'three';
import type { Vec3 } from '../../../types';
import { TREE_LOD_DISTANCE_METERS } from '../domain/constants';
import type { StoredVegetationInstance } from '../domain/storage';

export interface TreeLodMeshes {
  anchor: Vec3;
  instances: StoredVegetationInstance[];
  highMeshes: THREE.InstancedMesh[][];
  lowMesh: THREE.InstancedMesh | null;
  assetCount: number;
  highIndices: number[];
  lastHighCounts: number[];
  lastLowCount: number;
  tempMatrix: THREE.Matrix4;
}

function instanceWorldPosition(anchor: Vec3, matrix: Float32Array): Vec3 {
  return {
    x: anchor.x + matrix[12],
    y: anchor.y + matrix[13],
    z: anchor.z + matrix[14],
  };
}

function distanceSq(a: Vec3, b: Vec3): number {
  const dx = a.x - b.x;
  const dy = a.y - b.y;
  const dz = a.z - b.z;
  return dx * dx + dy * dy + dz * dz;
}

export function createTreeLodState(
  anchor: Vec3,
  instances: StoredVegetationInstance[],
  highMeshes: THREE.InstancedMesh[][],
  lowMesh: THREE.InstancedMesh | null,
  assetCount: number,
): TreeLodMeshes {
  return {
    anchor,
    assetCount,
    highIndices: new Array<number>(assetCount).fill(0),
    highMeshes,
    instances,
    lastHighCounts: new Array<number>(assetCount).fill(-1),
    lastLowCount: -1,
    lowMesh,
    tempMatrix: new THREE.Matrix4(),
  };
}

export function initializeTreeLodAllLow(lod: TreeLodMeshes): void {
  const { instances, lowMesh, tempMatrix } = lod;
  if (instances.length === 0 || !lowMesh) return;

  for (let index = 0; index < instances.length; index += 1) {
    tempMatrix.fromArray(instances[index].matrix);
    lowMesh.setMatrixAt(index, tempMatrix);
  }

  lowMesh.count = instances.length;
  lowMesh.instanceMatrix.needsUpdate = true;

  for (const partMeshes of lod.highMeshes) {
    for (const mesh of partMeshes) {
      mesh.count = 0;
    }
  }

  lod.lastHighCounts.fill(0);
  lod.lastLowCount = instances.length;
}

export function hasTreeNearFocus(
  lod: TreeLodMeshes,
  focusWorldPosition: Vec3,
  radiusMeters: number,
): boolean {
  const radiusSq = radiusMeters * radiusMeters;
  for (const instance of lod.instances) {
    const worldPos = instanceWorldPosition(lod.anchor, instance.matrix);
    if (distanceSq(worldPos, focusWorldPosition) < radiusSq) return true;
  }
  return false;
}

export function updateTreeLodMeshes(
  lod: TreeLodMeshes,
  focusWorldPosition: Vec3,
): void {
  const {
    anchor,
    instances,
    highMeshes,
    lowMesh,
    assetCount,
    highIndices,
    lastHighCounts,
    tempMatrix,
  } = lod;
  if (instances.length === 0 || !lowMesh || assetCount === 0) return;

  const lodDistanceSq = TREE_LOD_DISTANCE_METERS * TREE_LOD_DISTANCE_METERS;
  highIndices.fill(0);
  let lowIndex = 0;

  for (const instance of instances) {
    const worldPos = instanceWorldPosition(anchor, instance.matrix);
    tempMatrix.fromArray(instance.matrix);

    if (distanceSq(worldPos, focusWorldPosition) < lodDistanceSq) {
      const variantIndex = Math.max(
        0,
        Math.min(assetCount - 1, instance.variantIndex),
      );
      const index = highIndices[variantIndex];
      for (const mesh of highMeshes[variantIndex] ?? []) {
        mesh.setMatrixAt(index, tempMatrix);
      }
      highIndices[variantIndex] = index + 1;
      continue;
    }

    lowMesh.setMatrixAt(lowIndex, tempMatrix);
    lowIndex += 1;
  }

  for (let variantIndex = 0; variantIndex < highMeshes.length; variantIndex++) {
    const count = highIndices[variantIndex] ?? 0;
    const countChanged = lastHighCounts[variantIndex] !== count;
    lastHighCounts[variantIndex] = count;
    for (const mesh of highMeshes[variantIndex] ?? []) {
      mesh.count = count;
      if (countChanged) mesh.instanceMatrix.needsUpdate = true;
    }
  }

  const lowCountChanged = lod.lastLowCount !== lowIndex;
  lod.lastLowCount = lowIndex;
  lowMesh.count = lowIndex;
  if (lowCountChanged) lowMesh.instanceMatrix.needsUpdate = true;
}
