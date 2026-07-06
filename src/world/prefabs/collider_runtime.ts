import * as THREE from "three";
import {
  type GameplayCollider,
  sceneMatrixToGameplayMatrix,
} from "../../player/colliders";
import type {
  PrefabComponent,
  PrefabDocument,
  PrefabEntity,
  PrefabTransform,
} from "./schema";

function transformMatrix(transform: PrefabTransform): THREE.Matrix4 {
  return new THREE.Matrix4().compose(
    new THREE.Vector3(
      transform.position.x,
      transform.position.y,
      transform.position.z,
    ),
    new THREE.Quaternion(
      transform.rotation.x,
      transform.rotation.y,
      transform.rotation.z,
      transform.rotation.w,
    ),
    new THREE.Vector3(transform.scale.x, transform.scale.y, transform.scale.z),
  );
}

function offsetMatrix(offset: { x: number; y: number; z: number } | undefined): THREE.Matrix4 {
  return new THREE.Matrix4().makeTranslation(
    offset?.x ?? 0,
    offset?.y ?? 0,
    offset?.z ?? 0,
  );
}

function bakeCollider(
  component: Extract<PrefabComponent, { type: "collider" }>,
  entity: PrefabEntity,
  entitySceneMatrix: THREE.Matrix4,
  id: string,
): GameplayCollider | null {
  const baseLocalToSpace = sceneMatrixToGameplayMatrix(
    entitySceneMatrix.clone().multiply(offsetMatrix(component.offset)),
  );

  if (component.shape === "box") {
    return {
      id,
      kind: "box",
      node: component.node,
      halfSize: {
        x: component.size.x / 2,
        y: component.size.y / 2,
        z: component.size.z / 2,
      },
      baseLocalToSpace,
    };
  }

  const assetUrl = component.assetUrl ?? entity.asset?.url;
  if (!assetUrl) {
    console.warn(
      `Mesh collider "${id}" has no assetUrl and its entity has no asset; skipping it.`,
    );
    return null;
  }

  return {
    id,
    kind: "mesh",
    assetUrl,
    convex: component.convex ?? false,
    node: component.node,
    nodeOverrides: entity.nodeOverrides,
    baseLocalToSpace,
  };
}

function collect(
  entity: PrefabEntity,
  parentSceneMatrix: THREE.Matrix4,
  out: GameplayCollider[],
): void {
  const entitySceneMatrix = parentSceneMatrix
    .clone()
    .multiply(transformMatrix(entity.transform));
  let colliderIndex = 0;
  for (const component of entity.components ?? []) {
    if (component.type !== "collider") continue;
    const collider = bakeCollider(
      component,
      entity,
      entitySceneMatrix,
      `${entity.id}:collider-${colliderIndex}`,
    );
    colliderIndex += 1;
    if (collider) out.push(collider);
  }

  for (const child of entity.children ?? []) {
    collect(child, entitySceneMatrix, out);
  }
}

export function buildPrefabColliders(doc: PrefabDocument): GameplayCollider[] {
  const colliders: GameplayCollider[] = [];
  collect(doc.root, new THREE.Matrix4(), colliders);
  return colliders;
}
