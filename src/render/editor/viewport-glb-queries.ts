import * as THREE from "three";
import type { EditorStore, EntityTransform } from "../../editor/document";
import type { Vec3 } from "../../types";
import { findObjectByUuid, RAD_TO_DEG } from "./viewport_transforms";

export interface ViewportGlbQueries {
  getGlbNodeLocalTransform: (
    entityId: string,
    nodeUuid: string,
  ) => EntityTransform | null;
  setGlbNodeLocalTransform: (
    entityId: string,
    nodeUuid: string,
    transform: Partial<EntityTransform>,
  ) => void;
  getGlbNodePrefabPosition: (entityId: string, nodeUuid: string) => Vec3 | null;
  getGlbNodePrefabTransform: (
    entityId: string,
    nodeUuid: string,
    parentEntityId?: string | null,
  ) => EntityTransform | null;
  getGlbNodeBounds: (
    entityId: string,
    nodeUuid: string,
  ) => { min: Vec3; max: Vec3 } | null;
}

export function createViewportGlbQueries(
  store: EditorStore,
  entityRoot: THREE.Group,
  objectsById: Map<string, THREE.Group>,
): ViewportGlbQueries {
  const worldPositionScratch = new THREE.Vector3();
  const localPositionScratch = new THREE.Vector3();

  function getGlbNodeLocalTransform(
    entityId: string,
    nodeUuid: string,
  ): EntityTransform | null {
    const override = store.getGlbNodeOverride(entityId, nodeUuid);
    if (override) return override;
    const entityGroup = objectsById.get(entityId);
    if (!entityGroup) return null;
    const node = findObjectByUuid(entityGroup, nodeUuid);
    if (!node) return null;
    return {
      position: { x: node.position.x, y: node.position.y, z: node.position.z },
      rotation: {
        x: node.rotation.x * RAD_TO_DEG,
        y: node.rotation.y * RAD_TO_DEG,
        z: node.rotation.z * RAD_TO_DEG,
      },
      scale: { x: node.scale.x, y: node.scale.y, z: node.scale.z },
    };
  }

  function setGlbNodeLocalTransform(
    entityId: string,
    nodeUuid: string,
    transform: Partial<EntityTransform>,
  ): void {
    const before = getGlbNodeLocalTransform(entityId, nodeUuid);
    if (!before) return;
    const after: EntityTransform = {
      position: transform.position
        ? { ...transform.position }
        : { ...before.position },
      rotation: transform.rotation
        ? { ...transform.rotation }
        : { ...before.rotation },
      scale: transform.scale ? { ...transform.scale } : { ...before.scale },
    };
    store.commitGlbNodeTransform(entityId, nodeUuid, before, after);
  }

  function getGlbNodePrefabPosition(entityId: string, nodeUuid: string): Vec3 | null {
    const entityGroup = objectsById.get(entityId);
    if (!entityGroup) return null;
    const node = findObjectByUuid(entityGroup, nodeUuid);
    if (!node) return null;
    entityGroup.updateMatrixWorld(true);
    node.getWorldPosition(worldPositionScratch);
    localPositionScratch.copy(worldPositionScratch);
    entityGroup.worldToLocal(localPositionScratch);
    return {
      x: localPositionScratch.x,
      y: localPositionScratch.y,
      z: localPositionScratch.z,
    };
  }

  function getGlbNodePrefabTransform(
    entityId: string,
    nodeUuid: string,
    parentEntityId: string | null = entityId,
  ): EntityTransform | null {
    const sourceGroup = objectsById.get(entityId);
    if (!sourceGroup) return null;
    const node = findObjectByUuid(sourceGroup, nodeUuid);
    if (!node) return null;
    const parentObject =
      parentEntityId === null ? entityRoot : objectsById.get(parentEntityId);
    if (!parentObject) return null;
    sourceGroup.updateWorldMatrix(true, true);
    parentObject.updateWorldMatrix(true, false);
    const relativeMatrix = parentObject.matrixWorld
      .clone()
      .invert()
      .multiply(node.matrixWorld);
    const position = new THREE.Vector3();
    const rotation = new THREE.Quaternion();
    const scale = new THREE.Vector3();
    relativeMatrix.decompose(position, rotation, scale);
    const euler = new THREE.Euler().setFromQuaternion(rotation, "XYZ");
    return {
      position: { x: position.x, y: position.y, z: position.z },
      rotation: {
        x: euler.x * RAD_TO_DEG,
        y: euler.y * RAD_TO_DEG,
        z: euler.z * RAD_TO_DEG,
      },
      scale: { x: scale.x, y: scale.y, z: scale.z },
    };
  }

  function getGlbNodeBounds(
    entityId: string,
    nodeUuid: string,
  ): { min: Vec3; max: Vec3 } | null {
    const entityGroup = objectsById.get(entityId);
    if (!entityGroup) return null;
    entityGroup.updateMatrixWorld(true);
    const node = findObjectByUuid(entityGroup, nodeUuid);
    if (!node) return null;
    const box = new THREE.Box3();
    let hasMesh = false;
    node.traverse((child) => {
      if (
        !(child instanceof THREE.Mesh) ||
        child.userData.editorMeshColliderHelper
      ) {
        return;
      }
      const geo = child.geometry;
      if (!geo.boundingBox) geo.computeBoundingBox();
      const meshBox = geo.boundingBox!.clone();
      // Transform mesh-local bbox into the target node's local space
      const toNodeLocal = node.matrixWorld
        .clone()
        .invert()
        .multiply(child.matrixWorld);
      const corners = [
        new THREE.Vector3(meshBox.min.x, meshBox.min.y, meshBox.min.z),
        new THREE.Vector3(meshBox.max.x, meshBox.min.y, meshBox.min.z),
        new THREE.Vector3(meshBox.min.x, meshBox.max.y, meshBox.min.z),
        new THREE.Vector3(meshBox.max.x, meshBox.max.y, meshBox.min.z),
        new THREE.Vector3(meshBox.min.x, meshBox.min.y, meshBox.max.z),
        new THREE.Vector3(meshBox.max.x, meshBox.min.y, meshBox.max.z),
        new THREE.Vector3(meshBox.min.x, meshBox.max.y, meshBox.max.z),
        new THREE.Vector3(meshBox.max.x, meshBox.max.y, meshBox.max.z),
      ].map((v) => v.applyMatrix4(toNodeLocal));
      for (const c of corners) {
        if (!hasMesh) {
          box.min.copy(c);
          box.max.copy(c);
          hasMesh = true;
        } else box.expandByPoint(c);
      }
    });
    if (!hasMesh) return null;
    return {
      min: { x: box.min.x, y: box.min.y, z: box.min.z },
      max: { x: box.max.x, y: box.max.y, z: box.max.z },
    };
  }

  return {
    getGlbNodeLocalTransform,
    setGlbNodeLocalTransform,
    getGlbNodePrefabPosition,
    getGlbNodePrefabTransform,
    getGlbNodeBounds,
  };
}
