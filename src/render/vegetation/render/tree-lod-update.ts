import * as THREE from 'three';
import type { Vec3 } from '../../../types';
import { getTreeLodDistanceMeters } from '../domain/constants';
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
  /**
   * World-space sphere over this tile's trunk positions, with no margin, so a
   * reject is exact rather than conservative. `hasTreeNearFocus` is asked about
   * every selected tile on every LOD update, and the overwhelmingly common
   * answer is "no" — without this it paid a full instance scan to say so.
   */
  boundsCenter: Vec3;
  boundsRadius: number;
  /**
   * Which bucket each instance landed in last pack, so a re-pack can tell
   * "nothing moved" from "membership changed but the counts happen to match".
   */
  lastWasHigh: Uint8Array;
}

/** World-space sphere over the trunk positions, zero margin. */
function computeTrunkBounds(
  anchor: Vec3,
  instances: StoredVegetationInstance[],
): { center: Vec3; radius: number } {
  if (instances.length === 0) {
    return { center: { x: anchor.x, y: anchor.y, z: anchor.z }, radius: 0 };
  }

  let minX = Number.POSITIVE_INFINITY;
  let minY = Number.POSITIVE_INFINITY;
  let minZ = Number.POSITIVE_INFINITY;
  let maxX = Number.NEGATIVE_INFINITY;
  let maxY = Number.NEGATIVE_INFINITY;
  let maxZ = Number.NEGATIVE_INFINITY;
  for (const instance of instances) {
    const x = instance.matrix[12];
    const y = instance.matrix[13];
    const z = instance.matrix[14];
    if (x < minX) minX = x;
    if (y < minY) minY = y;
    if (z < minZ) minZ = z;
    if (x > maxX) maxX = x;
    if (y > maxY) maxY = y;
    if (z > maxZ) maxZ = z;
  }

  const center = {
    x: anchor.x + (minX + maxX) * 0.5,
    y: anchor.y + (minY + maxY) * 0.5,
    z: anchor.z + (minZ + maxZ) * 0.5,
  };
  const halfX = (maxX - minX) * 0.5;
  const halfY = (maxY - minY) * 0.5;
  const halfZ = (maxZ - minZ) * 0.5;
  return {
    center,
    radius: Math.sqrt(halfX * halfX + halfY * halfY + halfZ * halfZ),
  };
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
  const bounds = computeTrunkBounds(anchor, instances);
  return {
    anchor,
    assetCount,
    boundsCenter: bounds.center,
    boundsRadius: bounds.radius,
    highIndices: new Array<number>(assetCount).fill(0),
    highMeshes,
    instances,
    lastHighCounts: new Array<number>(assetCount).fill(-1),
    // 2 = "never packed", so the first update always uploads.
    lastWasHigh: new Uint8Array(instances.length).fill(2),
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
  lod.lastWasHigh.fill(0);
}

export function hasTreeNearFocus(
  lod: TreeLodMeshes,
  focusWorldPosition: Vec3,
  radiusMeters: number,
): boolean {
  // Whole-tile reject before touching a single instance. The sphere covers the
  // exact trunk positions the scan below tests, so a miss here is a real miss.
  const reach = radiusMeters + lod.boundsRadius;
  if (distanceSq(lod.boundsCenter, focusWorldPosition) > reach * reach) return false;

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
    lastWasHigh,
    tempMatrix,
  } = lod;
  if (instances.length === 0 || !lowMesh || assetCount === 0) return;

  const lodDistance = getTreeLodDistanceMeters();
  const lodDistanceSq = lodDistance * lodDistance;
  highIndices.fill(0);
  let lowIndex = 0;
  /**
   * Counts alone cannot decide this. Instances are packed in a fixed iteration
   * order, so the buffers are identical only when *every* instance kept its
   * bucket — strafe so one tree enters high detail as another leaves and the
   * counts match while the contents differ. Keying the upload off the count
   * left those buffers stale, drawing the previous position's trees.
   */
  let membershipChanged = false;

  for (let index = 0; index < instances.length; index += 1) {
    const instance = instances[index];
    const worldPos = instanceWorldPosition(anchor, instance.matrix);
    tempMatrix.fromArray(instance.matrix);
    const isHigh = distanceSq(worldPos, focusWorldPosition) < lodDistanceSq;
    const wasHigh = isHigh ? 1 : 0;
    if (lastWasHigh[index] !== wasHigh) {
      lastWasHigh[index] = wasHigh;
      membershipChanged = true;
    }

    if (isHigh) {
      const variantIndex = Math.max(
        0,
        Math.min(assetCount - 1, instance.variantIndex),
      );
      const slot = highIndices[variantIndex];
      for (const mesh of highMeshes[variantIndex] ?? []) {
        mesh.setMatrixAt(slot, tempMatrix);
      }
      highIndices[variantIndex] = slot + 1;
      continue;
    }

    lowMesh.setMatrixAt(lowIndex, tempMatrix);
    lowIndex += 1;
  }

  for (let variantIndex = 0; variantIndex < highMeshes.length; variantIndex++) {
    const count = highIndices[variantIndex] ?? 0;
    const changed = membershipChanged || lastHighCounts[variantIndex] !== count;
    lastHighCounts[variantIndex] = count;
    for (const mesh of highMeshes[variantIndex] ?? []) {
      mesh.count = count;
      if (changed) mesh.instanceMatrix.needsUpdate = true;
    }
  }

  const lowChanged = membershipChanged || lod.lastLowCount !== lowIndex;
  lod.lastLowCount = lowIndex;
  lowMesh.count = lowIndex;
  if (lowChanged) lowMesh.instanceMatrix.needsUpdate = true;
}
