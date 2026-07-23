import * as THREE from "three";
import {
  applyPrefabMaterialOverrides,
  isolatePrefabModelNode,
} from "../prefabs/prefab_renderer";
import { bindObjectAnimationComponent } from "../prefabs/object_animation";
import type { EditorEntity, EditorStore, GlbNodeRef } from "../../editor/document";
import type { PrefabComponent } from "../../world/prefabs/schema";
import type { ParticleSystemHandle } from "../particles";
import type { ViewportComponentHelpers } from "./viewport_component_helpers";

export function usesEntityAssetForMeshCollider(
  component: PrefabComponent,
  entity: EditorEntity,
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
  applyShipPreview: () => void;
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
  ctx: Pick<
    EntityModelLoadContext,
    "entity" | "model" | "helpers" | "sanitizeNodeName"
  >,
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
      if (helper) targetNode.add(helper);
    }
  }
  for (const component of entity.components) {
    if (!usesEntityAssetForMeshCollider(component, entity)) continue;
    const helper = helpers.buildComponentHelper(component, model);
    if (helper) model.add(helper);
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
    applyShipPreview,
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
  applyShipPreview();
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
      if (helper) group.add(helper);
      const handle = createParticleSystem(component);
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
      group.add(helper);
      hasVisual = true;
    }
  }
  return hasVisual;
}
