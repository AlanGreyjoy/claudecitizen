import type * as THREE from "three";
import type { EditorEntity, EntityTransform, GlbNodeRef } from "../../editor/document";

export const DEG_TO_RAD = Math.PI / 180;
export const RAD_TO_DEG = 180 / Math.PI;

export function applyEntityTransformToObject(
  object: THREE.Object3D,
  entity: EditorEntity,
): void {
  object.position.set(entity.position.x, entity.position.y, entity.position.z);
  object.rotation.set(
    entity.rotation.x * DEG_TO_RAD,
    entity.rotation.y * DEG_TO_RAD,
    entity.rotation.z * DEG_TO_RAD,
    "XYZ",
  );
  object.scale.set(entity.scale.x, entity.scale.y, entity.scale.z);
}

export function applyTransformToObject3D(
  object: THREE.Object3D,
  transform: EntityTransform,
): void {
  object.position.set(
    transform.position.x,
    transform.position.y,
    transform.position.z,
  );
  object.rotation.set(
    transform.rotation.x * DEG_TO_RAD,
    transform.rotation.y * DEG_TO_RAD,
    transform.rotation.z * DEG_TO_RAD,
    "XYZ",
  );
  object.scale.set(transform.scale.x, transform.scale.y, transform.scale.z);
}

export function sanitizeNodeName(name: string): string {
  return name.replace(/\s/g, "_");
}

export function findGlbNodeByName(
  entityGroup: THREE.Object3D,
  nodeName: string,
): THREE.Object3D | null {
  return entityGroup.getObjectByName(sanitizeNodeName(nodeName)) ?? null;
}

export function buildGlbNodeRef(object: THREE.Object3D): GlbNodeRef {
  return {
    uuid: object.uuid,
    name: object.name || "(unnamed)",
    children: object.children.map((child) => buildGlbNodeRef(child)),
  };
}

export function tagGlbNodes(object: THREE.Object3D): void {
  object.userData.glbNodeUuid = object.uuid;
  for (const child of object.children) tagGlbNodes(child);
}

export function findObjectByUuid(
  root: THREE.Object3D,
  uuid: string,
): THREE.Object3D | null {
  let found: THREE.Object3D | null = null;
  root.traverse((object) => {
    if (!found && object.uuid === uuid) found = object;
  });
  return found;
}

export function pathFromEntityRoot(
  root: THREE.Object3D,
  hit: THREE.Object3D,
): THREE.Object3D[] {
  const chain: THREE.Object3D[] = [];
  let current: THREE.Object3D | null = hit;
  while (current) {
    chain.unshift(current);
    if (current === root) break;
    current = current.parent;
  }
  return chain[0] === root ? chain : [root];
}

export function entityIdFromObject(object: THREE.Object3D): string | null {
  let current: THREE.Object3D | null = object;
  while (current) {
    const id = current.userData.entityId as string | undefined;
    if (id) return id;
    current = current.parent;
  }
  return null;
}

export function isEffectivelyVisible(object: THREE.Object3D): boolean {
  let current: THREE.Object3D | null = object;
  while (current) {
    if (!current.visible) return false;
    current = current.parent;
  }
  return true;
}

/** Hide light volume gizmos so bounds/selection boxes use the bulb only. */
export function withLightRangesHidden<T>(
  object: THREE.Object3D,
  fn: () => T,
): T {
  const hidden: THREE.Object3D[] = [];
  object.traverse((child) => {
    if (child.userData.editorLightRangeHelper && child.visible) {
      child.visible = false;
      hidden.push(child);
    }
  });
  try {
    return fn();
  } finally {
    for (const child of hidden) child.visible = true;
  }
}
