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
  PrefabNodeOverride,
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

/**
 * GLB nodes something animates: ship door leaves and the boarding ramp, or a
 * station's `animation` component nodes. A mesh collider bakes every child it
 * can reach, so without this the closed door is part of the parent geometry
 * forever — the doorway never opens no matter what the door's collider does.
 */
export interface PrefabColliderOptions {
  articulatedNodes?: readonly string[];
}

/**
 * `hiddenNodes` is the editor's "delete this GLB node" — the renderer stops
 * drawing it, so the bake has to drop it too or the deleted geometry survives
 * as an invisible wall. Feeding the names through `excludeNodes` covers the
 * whole subtree: `colliders.ts` walks a mesh's ancestors when matching.
 */
function hiddenNodesOf(entity: PrefabEntity): readonly string[] {
  return entity.hiddenNodes ?? [];
}

function bakeCollider(
  component: Extract<PrefabComponent, { type: "collider" }>,
  entity: PrefabEntity,
  baseSceneMatrix: THREE.Matrix4,
  id: string,
  defaultNode?: string,
  recenterHull = false,
  excludeNodes?: readonly string[],
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

  // Author-picked exclusions plus whatever the rig animates.
  const excluded = [...new Set([...(component.excludeNodes ?? []), ...(excludeNodes ?? [])])];
  return {
    id,
    kind: "mesh",
    assetUrl,
    convex: component.convex ?? false,
    node: component.node ?? defaultNode ?? entity.asset?.node,
    nodeOverrides: entity.nodeOverrides,
    ...(excluded.length > 0 ? { excludeNodes: excluded } : {}),
    baseLocalToSpace,
    recenterHull,
  };
}

async function collectEntityColliders(
  entity: PrefabEntity,
  hullColliderSceneMatrix: THREE.Matrix4,
  out: GameplayCollider[],
  articulatedNodes: readonly string[],
): Promise<void> {
  let colliderIndex = 0;
  const isShipHull =
    entity.components?.some((component) => component.type === "ship-controller") ??
    false;
  const hiddenNodes = hiddenNodesOf(entity);
  const hidden = new Set(hiddenNodes);
  for (const component of entity.components ?? []) {
    if (component.type !== "collider") continue;
    // Index stays tied to the component slot so collider ids survive a delete.
    const id = `${entity.id}:collider-${colliderIndex}`;
    colliderIndex += 1;
    const targetNode = component.node ?? entity.asset?.node;
    // The collider's own node is gone — nothing left for it to stand in for.
    if (targetNode && hidden.has(targetNode)) continue;
    const collider = bakeCollider(
      component,
      entity,
      hullColliderSceneMatrix,
      id,
      undefined,
      isShipHull,
      [...articulatedNodes, ...hiddenNodes],
    );
    if (collider) out.push(collider);
  }
}

async function collectNodeOverrideColliders(
  entity: PrefabEntity,
  hullColliderSceneMatrix: THREE.Matrix4,
  out: GameplayCollider[],
  articulatedNodes: readonly string[],
): Promise<void> {
  if (!entity.asset?.url) return;
  const hiddenNodes = hiddenNodesOf(entity);
  const hidden = new Set(hiddenNodes);
  const nodesWithColliders = (entity.nodeOverrides ?? []).filter(
    (o) => !hidden.has(o.node) && o.components?.some((c) => c.type === "collider"),
  );
  const authoredNodes = new Set(nodesWithColliders.map((o) => o.node));
  // An articulated node the author never gave a collider gets one baked from
  // its own geometry, so a door blocks while closed and clears while open.
  const generatedNodes = articulatedNodes.filter(
    (node) => !authoredNodes.has(node) && !hidden.has(node),
  );
  if (nodesWithColliders.length === 0 && generatedNodes.length === 0) return;

  const isShipHull =
    entity.components?.some((component) => component.type === "ship-controller") ??
    false;
  const nodeNames = [...authoredNodes, ...generatedNodes];
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
  const nodeSceneMatrixFor = (nodeWorldMatrix: THREE.Matrix4): THREE.Matrix4 => {
    const nodeSceneMatrix = hullColliderSceneMatrix.clone();
    if (assetRootInverse) nodeSceneMatrix.multiply(assetRootInverse);
    return nodeSceneMatrix.multiply(nodeWorldMatrix);
  };

  bakeArticulatedNodeColliders({
    entity,
    generatedNodes,
    matrices,
    nodeSceneMatrixFor,
    isShipHull,
    hiddenNodes,
    out,
  });
  bakeAuthoredNodeColliders({
    entity,
    nodesWithColliders,
    matrices,
    nodeSceneMatrixFor,
    isShipHull,
    hiddenNodes,
    out,
  });
}

interface NodeColliderBakeContext {
  entity: PrefabEntity;
  matrices: Map<string, THREE.Matrix4>;
  nodeSceneMatrixFor: (nodeWorldMatrix: THREE.Matrix4) => THREE.Matrix4;
  isShipHull: boolean;
  /** Deleted GLB nodes — kept out of every mesh bake under this entity. */
  hiddenNodes: readonly string[];
  out: GameplayCollider[];
}

function bakeArticulatedNodeColliders(
  context: NodeColliderBakeContext & { generatedNodes: readonly string[] },
): void {
  const { entity, generatedNodes, matrices, nodeSceneMatrixFor, isShipHull, hiddenNodes, out } =
    context;
  for (const node of generatedNodes) {
    const nodeWorldMatrix = matrices.get(node);
    // Silent: a prefab's other GLBs simply do not contain this node. A node
    // that exists nowhere surfaces as the runtime's "no collider bound to
    // node(s)" warning instead, which names the door rather than the asset.
    if (!nodeWorldMatrix) continue;
    const collider = bakeCollider(
      { type: "collider", shape: "mesh" },
      entity,
      nodeSceneMatrixFor(nodeWorldMatrix),
      `${entity.id}:${node}:collider-articulated`,
      node,
      isShipHull,
      hiddenNodes,
    );
    if (collider) out.push(collider);
  }
}

function bakeAuthoredNodeColliders(
  context: NodeColliderBakeContext & { nodesWithColliders: readonly PrefabNodeOverride[] },
): void {
  const { entity, nodesWithColliders, matrices, nodeSceneMatrixFor, isShipHull, hiddenNodes, out } =
    context;
  for (const override of nodesWithColliders) {
    const nodeWorldMatrix = matrices.get(override.node);
    if (!nodeWorldMatrix) {
      console.warn(
        `Collider on GLB node "${override.node}" skipped — node not found in ${entity.asset?.url}.`,
      );
      continue;
    }
    const nodeSceneMatrix = nodeSceneMatrixFor(nodeWorldMatrix);
    let nodeColliderIndex = 0;
    for (const component of override.components ?? []) {
      if (component.type !== "collider") continue;
      const collider = bakeCollider(
        component,
        entity,
        nodeSceneMatrix,
        `${entity.id}:${override.node}:collider-${nodeColliderIndex}`,
        override.node,
        isShipHull,
        hiddenNodes,
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
  articulatedNodes: readonly string[],
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
  // Only an entity with a GLB can own an articulated node. Names that belong
  // to a different asset resolve to nothing and drop out on their own.
  const articulated = entity.asset?.url ? articulatedNodes : [];
  await collectEntityColliders(entity, hullColliderSceneMatrix, out, articulated);
  await collectNodeOverrideColliders(entity, hullColliderSceneMatrix, out, articulated);

  for (const child of entity.children ?? []) {
    await collect(child, entitySceneMatrix, out, articulatedNodes);
  }
}

export async function buildPrefabColliders(
  doc: PrefabDocument,
  options: PrefabColliderOptions = {},
): Promise<GameplayCollider[]> {
  const colliders: GameplayCollider[] = [];
  await collect(doc.root, new THREE.Matrix4(), colliders, options.articulatedNodes ?? []);
  return colliders;
}
