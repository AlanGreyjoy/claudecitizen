import * as THREE from "three";
import {
  type GameplayCollider,
  loadNodeWorldMatrices,
  sceneMatrixToGameplayMatrix,
} from "./colliders";
import type {
  PrefabComponent,
  PrefabDocument,
  PrefabEntity,
  PrefabTransform,
} from "../world/prefabs/schema";

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

/**
 * Play (`ship_model`) recenters the flyable hull and ignores entity translation.
 * Colliders must match that space — otherwise a leftover editor Y offset (e.g.
 * dropship at y=7.25) lifts the trimesh onto the visual roof.
 */
function shipHullColliderMatrix(
  parentSceneMatrix: THREE.Matrix4,
  transform: PrefabTransform,
): THREE.Matrix4 {
  const rotationScale = new THREE.Matrix4().compose(
    new THREE.Vector3(0, 0, 0),
    new THREE.Quaternion(
      transform.rotation.x,
      transform.rotation.y,
      transform.rotation.z,
      transform.rotation.w,
    ),
    new THREE.Vector3(transform.scale.x, transform.scale.y, transform.scale.z),
  );
  return parentSceneMatrix.clone().multiply(rotationScale);
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
  baseSceneMatrix: THREE.Matrix4,
  id: string,
  defaultNode?: string,
  recenterHull = false,
): GameplayCollider | null {
  const baseLocalToSpace = sceneMatrixToGameplayMatrix(
    baseSceneMatrix.clone().multiply(offsetMatrix(component.offset)),
  );

  if (component.shape === "box") {
    return {
      id,
      kind: "box",
      node: component.node ?? defaultNode,
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
    node: component.node ?? defaultNode ?? entity.asset?.node,
    nodeOverrides: entity.nodeOverrides,
    baseLocalToSpace,
    recenterHull,
  };
}

async function collectEntityColliders(
  entity: PrefabEntity,
  hullColliderSceneMatrix: THREE.Matrix4,
  out: GameplayCollider[],
): Promise<void> {
  let colliderIndex = 0;
  const isShipHull =
    entity.components?.some((component) => component.type === "ship-controller") ??
    false;
  for (const component of entity.components ?? []) {
    if (component.type !== "collider") continue;
    const collider = bakeCollider(
      component,
      entity,
      hullColliderSceneMatrix,
      `${entity.id}:collider-${colliderIndex}`,
      undefined,
      isShipHull,
    );
    colliderIndex += 1;
    if (collider) out.push(collider);
  }
}

async function collectNodeOverrideColliders(
  entity: PrefabEntity,
  hullColliderSceneMatrix: THREE.Matrix4,
  out: GameplayCollider[],
): Promise<void> {
  if (!entity.asset?.url || !entity.nodeOverrides) return;
  const nodesWithColliders = entity.nodeOverrides.filter(
    (o) => o.components?.some((c) => c.type === "collider"),
  );
  if (nodesWithColliders.length === 0) return;

  const isShipHull =
    entity.components?.some((component) => component.type === "ship-controller") ??
    false;
  const nodeNames = nodesWithColliders.map((o) => o.node);
  const requestedNodeNames = entity.asset.node
    ? [...nodeNames, entity.asset.node]
    : nodeNames;
  const matrices = await loadNodeWorldMatrices(
    entity.asset.url,
    requestedNodeNames,
    entity.nodeOverrides,
    isShipHull,
  );
  const assetRootInverse = entity.asset.node
    ? matrices.get(entity.asset.node)?.clone().invert()
    : undefined;
  for (const override of nodesWithColliders) {
    const nodeWorldMatrix = matrices.get(override.node);
    if (!nodeWorldMatrix) {
      console.warn(
        `Collider on GLB node "${override.node}" skipped — node not found in ${entity.asset.url}.`,
      );
      continue;
    }
    const nodeSceneMatrix = hullColliderSceneMatrix.clone();
    if (assetRootInverse) nodeSceneMatrix.multiply(assetRootInverse);
    nodeSceneMatrix.multiply(nodeWorldMatrix);
    let nodeColliderIndex = 0;
    for (const component of override.components!) {
      if (component.type !== "collider") continue;
      const collider = bakeCollider(
        component,
        entity,
        nodeSceneMatrix,
        `${entity.id}:${override.node}:collider-${nodeColliderIndex}`,
        override.node,
        isShipHull,
      );
      nodeColliderIndex += 1;
      if (collider) out.push(collider);
    }
  }
}

async function collect(
  entity: PrefabEntity,
  parentSceneMatrix: THREE.Matrix4,
  out: GameplayCollider[],
): Promise<void> {
  const entitySceneMatrix = parentSceneMatrix
    .clone()
    .multiply(transformMatrix(entity.transform));
  const isShipHull =
    entity.components?.some((component) => component.type === "ship-controller") ??
    false;
  // Hierarchy keeps full entity transform; hull colliders match play (no translation).
  const hullColliderSceneMatrix = isShipHull
    ? shipHullColliderMatrix(parentSceneMatrix, entity.transform)
    : entitySceneMatrix;
  await collectEntityColliders(entity, hullColliderSceneMatrix, out);
  await collectNodeOverrideColliders(entity, hullColliderSceneMatrix, out);

  for (const child of entity.children ?? []) {
    await collect(child, entitySceneMatrix, out);
  }
}

export async function buildPrefabColliders(doc: PrefabDocument): Promise<GameplayCollider[]> {
  const colliders: GameplayCollider[] = [];
  await collect(doc.root, new THREE.Matrix4(), colliders);
  return colliders;
}
