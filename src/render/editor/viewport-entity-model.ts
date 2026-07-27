import * as THREE from "three";
import {
  applyPrefabMaterialOverrides,
  isolatePrefabModelNode,
} from "../prefabs/prefab-renderer";
import { bindObjectAnimationComponent } from "../prefabs/object-animation";
import type { EditorEntity, EditorStore, GlbNodeRef } from "../../editor/document";
import type {
  PrefabComponent,
  PrefabDocument,
  PrefabEntity,
} from "../../world/prefabs/schema";
import type { ParticleSystemHandle } from "../particles";
import type { ViewportComponentHelpers } from "./viewport-component-helpers";

type MeshColliderHost = { asset?: { url: string } | null };

export function usesEntityAssetForMeshCollider(
  component: PrefabComponent,
  entity: MeshColliderHost,
): component is Extract<PrefabComponent, { type: "collider"; shape: "mesh" }> {
  return (
    component.type === "collider" &&
    component.shape === "mesh" &&
    (!component.assetUrl || component.assetUrl === entity.asset?.url)
  );
}

export interface EntityModelLoadContext {
  generation: number;
  buildGeneration: number;
  entity: EditorEntity;
  group: THREE.Group;
  model: THREE.Object3D;
  recenterAsHull: boolean;
  entityRoot: THREE.Group;
  store: EditorStore;
  helpers: Pick<
    ViewportComponentHelpers,
    | "buildComponentHelper"
    | "makeRestHeightHelper"
    | "clearRestHeightHelpers"
    | "makeHelperMesh"
  >;
  track: <T extends { dispose: () => void }>(resource: T) => T;
  sanitizeNodeName: (name: string) => string;
  buildGlbNodeRef: (object: THREE.Object3D) => GlbNodeRef;
  tagGlbNodes: (object: THREE.Object3D) => void;
  applyGlbOverridesForEntity: (entityId: string) => void;
  applyHiddenNodesForEntity: (entityId: string) => void;
}

export function attachRestHeightHelperForHull(
  ctx: Pick<EntityModelLoadContext, "entity" | "group" | "model" | "helpers">,
): void {
  const { entity, group, model, helpers } = ctx;
  const restSource = entity.components.find(
    (component) =>
      component.type === "ship-controller" || component.type === "ship-hull",
  );
  const authored =
    restSource &&
    (restSource.type === "ship-controller" || restSource.type === "ship-hull")
      ? restSource.restHeight
      : undefined;
  group.updateWorldMatrix(true, true);
  const hullBox = new THREE.Box3()
    .setFromObject(model)
    .applyMatrix4(group.matrixWorld.clone().invert());
  const hullSize = hullBox.getSize(new THREE.Vector3());
  const padRadius = Math.max(4, Math.max(hullSize.x, hullSize.z) * 0.55);
  const autoRest = Math.min(30, Math.max(0.3, -hullBox.min.y));
  helpers.clearRestHeightHelpers(group);
  group.add(
    helpers.makeRestHeightHelper(authored ?? autoRest, {
      auto: authored === undefined,
      radius: padRadius,
    }),
  );
}

export function attachModelComponentHelpers(
  ctx: Pick<EntityModelLoadContext, "entity" | "model" | "sanitizeNodeName"> & {
    helpers: Pick<ViewportComponentHelpers, "buildComponentHelper">;
  },
): void {
  const { entity, model, helpers, sanitizeNodeName } = ctx;
  for (const override of entity.glbNodeTransforms) {
    if (override.components.length === 0) continue;
    const targetNode = model.getObjectByName(sanitizeNodeName(override.nodeName));
    if (!targetNode) continue;
    for (const component of override.components) {
      const helper = helpers.buildComponentHelper(
        component,
        usesEntityAssetForMeshCollider(component, entity) ? targetNode : undefined,
      );
      if (helper) {
        helper.userData.editorNodeComponentHelper = true;
        targetNode.add(helper);
      }
    }
  }
  for (const component of entity.components) {
    if (!usesEntityAssetForMeshCollider(component, entity)) continue;
    const helper = helpers.buildComponentHelper(component, model);
    if (helper) {
      helper.userData.editorNodeComponentHelper = true;
      model.add(helper);
    }
  }
}

/** Remove helpers previously attached by `attachModelComponentHelpers`. */
export function clearNodeComponentHelpers(node: THREE.Object3D): void {
  for (const child of [...node.children]) {
    if (child.userData.editorNodeComponentHelper) node.remove(child);
  }
}

export function attachModelObjectAnimations(
  ctx: Pick<EntityModelLoadContext, "entity" | "model" | "entityRoot">,
): void {
  const { entity, model, entityRoot } = ctx;
  for (const component of entity.components) {
    if (
      component.type === "object-animation" &&
      (component.nodes?.length ?? 0) > 0
    ) {
      bindObjectAnimationComponent(entityRoot, model, component);
    }
  }
}

export function finalizeLoadedEntityModel(ctx: EntityModelLoadContext): void {
  const {
    generation,
    buildGeneration,
    entity,
    group,
    model,
    recenterAsHull,
    entityRoot,
    store,
    helpers,
    track,
    sanitizeNodeName,
    buildGlbNodeRef,
    tagGlbNodes,
    applyGlbOverridesForEntity,
    applyHiddenNodesForEntity,
  } = ctx;
  if (generation !== buildGeneration) return;
  if (recenterAsHull) {
    const box = new THREE.Box3().setFromObject(model);
    model.position.sub(box.getCenter(new THREE.Vector3()));
  }
  const asset = entity.asset;
  if (!asset) return;
  const url = asset.url;
  if (asset.node && !isolatePrefabModelNode(model, asset.node)) {
    console.warn(`Editor: node "${asset.node}" not found in ${url}`);
    store.setGlbTree(entity.id, null);
    return;
  }
  for (const material of applyPrefabMaterialOverrides(
    model,
    entity.materialOverrides,
  )) {
    track(material);
  }
  tagGlbNodes(model);
  group.add(model);
  store.setGlbTree(entity.id, buildGlbNodeRef(model));
  applyGlbOverridesForEntity(entity.id);
  applyHiddenNodesForEntity(entity.id);
  if (recenterAsHull) {
    attachRestHeightHelperForHull({ entity, group, model, helpers });
  }
  attachModelComponentHelpers({
    entity,
    model,
    helpers,
    sanitizeNodeName,
  });
  attachModelObjectAnimations({ entity, model, entityRoot });
}

export function attachTopLevelEntityComponents(args: {
  entity: EditorEntity;
  group: THREE.Group;
  entityRoot: THREE.Group;
  helpers: Pick<ViewportComponentHelpers, "buildComponentHelper">;
  registerParticleHandle: (
    entityId: string,
    handle: ParticleSystemHandle,
  ) => void;
  createParticleSystem: (
    component: Extract<PrefabComponent, { type: "particle-system" }>,
  ) => ParticleSystemHandle;
}): boolean {
  const {
    entity,
    group,
    entityRoot,
    helpers,
    registerParticleHandle,
    createParticleSystem,
  } = args;
  let hasVisual = false;
  for (const component of entity.components) {
    if (
      entity.asset &&
      usesEntityAssetForMeshCollider(component, entity)
    ) {
      continue;
    }
    if (component.type === "particle-system") {
      const helper = helpers.buildComponentHelper(component);
      if (helper) {
        helper.userData.editorEntityComponentHelper = true;
        group.add(helper);
      }
      const handle = createParticleSystem(component);
      handle.object3d.userData.editorEntityComponentHelper = true;
      group.add(handle.object3d);
      registerParticleHandle(entity.id, handle);
      hasVisual = true;
      continue;
    }
    if (component.type === "object-animation") {
      const nodeCount = component.nodes?.length ?? 0;
      if (nodeCount === 0 || !entity.asset) {
        bindObjectAnimationComponent(entityRoot, group, component);
      }
    }
    const helper = helpers.buildComponentHelper(component);
    if (helper) {
      helper.userData.editorEntityComponentHelper = true;
      group.add(helper);
      hasVisual = true;
    }
  }
  return hasVisual;
}

/** Strip entity-level helpers previously stamped by `attachTopLevelEntityComponents`. */
export function clearEntityLevelComponentHelpers(group: THREE.Group): void {
  for (const child of [...group.children]) {
    if (child.userData.editorEntityComponentHelper) {
      group.remove(child);
    }
  }
}

/**
 * Clear every node/model helper under a loaded GLB (entity-level mesh colliders
 * and per-node override helpers), then re-attach from current entity data.
 */
export function refreshEntityModelComponentHelpers(args: {
  entity: EditorEntity;
  model: THREE.Object3D;
  helpers: Pick<ViewportComponentHelpers, "buildComponentHelper">;
  sanitizeNodeName: (name: string) => string;
}): void {
  const { entity, model, helpers, sanitizeNodeName } = args;
  model.traverse((node) => {
    clearNodeComponentHelpers(node);
  });
  attachModelComponentHelpers({ entity, model, helpers, sanitizeNodeName });
}

function findObjectByEntityId(
  root: THREE.Object3D,
  entityId: string,
): THREE.Object3D | null {
  let found: THREE.Object3D | null = null;
  root.traverse((object) => {
    if (found) return;
    if (object.userData.entityId === entityId) found = object;
  });
  return found;
}

/** Prefer the loaded GLB / primitive mesh under a prefab-entity group. */
function findPrefabEntityVisual(entityGroup: THREE.Object3D): THREE.Object3D | null {
  for (const child of entityGroup.children) {
    if (child.userData.entityId) continue;
    if (child.userData.editorMeshColliderHelper) continue;
    if (child.userData.editorNodeComponentHelper) continue;
    if (child.userData.editorLightRangeHelper) continue;
    let hasMesh = false;
    child.traverse((object) => {
      if ((object as THREE.Mesh).isMesh) hasMesh = true;
    });
    if (hasMesh) return child;
  }
  return null;
}

function addColliderHelper(
  helpers: Pick<ViewportComponentHelpers, "buildComponentHelper">,
  parent: THREE.Object3D,
  component: PrefabComponent,
  meshTarget?: THREE.Object3D,
): void {
  if (component.type !== "collider") return;
  const helper = helpers.buildComponentHelper(component, meshTarget);
  if (!helper) return;
  helper.userData.editorNodeComponentHelper = true;
  parent.add(helper);
}

function attachEntityColliderHelpers(
  entity: PrefabEntity,
  group: THREE.Object3D,
  helpers: Pick<ViewportComponentHelpers, "buildComponentHelper">,
  sanitizeNodeName: (name: string) => string,
): void {
  const model = entity.asset ? findPrefabEntityVisual(group) : null;

  for (const override of entity.nodeOverrides ?? []) {
    if (!model || (override.components?.length ?? 0) === 0) continue;
    const targetNode = model.getObjectByName(sanitizeNodeName(override.node));
    if (!targetNode) continue;
    for (const component of override.components ?? []) {
      addColliderHelper(
        helpers,
        targetNode,
        component,
        usesEntityAssetForMeshCollider(component, entity) ? targetNode : undefined,
      );
    }
  }

  for (const component of entity.components ?? []) {
    if (component.type !== "collider") continue;
    if (usesEntityAssetForMeshCollider(component, entity) && model) {
      addColliderHelper(helpers, model, component, model);
      continue;
    }
    addColliderHelper(helpers, group, component);
  }
}

/**
 * Prefab-instance previews use the game `buildEntity` path, which never draws
 * collider wireframes. Attach the same editor helpers used for authored entities.
 */
export function attachPrefabInstanceColliderHelpers(args: {
  instanceRoot: THREE.Object3D;
  doc: PrefabDocument;
  helpers: Pick<ViewportComponentHelpers, "buildComponentHelper">;
  sanitizeNodeName: (name: string) => string;
}): void {
  const { instanceRoot, doc, helpers, sanitizeNodeName } = args;

  const visit = (entity: PrefabEntity): void => {
    const group = findObjectByEntityId(instanceRoot, entity.id);
    if (group) {
      attachEntityColliderHelpers(entity, group, helpers, sanitizeNodeName);
    }
    for (const child of entity.children ?? []) visit(child);
  };

  visit(doc.root);
}
