import * as THREE from "three";
import type { TransformControls } from "three/examples/jsm/controls/TransformControls";
import {
  loadPrefabModel,
  createPrimitiveMesh,
  createPropInstanceGroupAsync,
  applyPrefabMaterialOverrides,
} from "../prefabs/prefab-renderer";
import { setupUpdateObjectAnimations } from "../prefabs/object-animation";
import {
  createParticleSystem,
  type ParticleSystemHandle,
} from "../particles";
import type { EditorEntity, EditorStore, EntityTransform } from "../../editor/document";
import { loadPrefabDocument } from "../../world/prefabs/loader";
import {
  createViewportComponentHelpers,
  type ViewportResourceTracker,
} from "./viewport-component-helpers";
import {
  attachPrefabInstanceColliderHelpers,
  attachRestHeightHelperForHull,
  attachTopLevelEntityComponents,
  attachModelObjectAnimations,
  clearEntityLevelComponentHelpers,
  finalizeLoadedEntityModel,
  refreshEntityModelComponentHelpers,
  refreshNodeOverrideComponentHelpers,
} from "./viewport-entity-model";
import { createViewportNpcRoutes } from "./viewport-npc-routes";
import {
  applyEntityTransformToObject,
  applyTransformToObject3D,
  buildGlbNodeRef,
  findGlbNodeByName,
  sanitizeNodeName,
  tagGlbNodes,
} from "./viewport-transforms";

export interface ViewportEntityGraph {
  objectsById: Map<string, THREE.Group>;
  track: ViewportResourceTracker;
  updateNpcRoutes: () => void;
  rebuildAll: () => void;
  refreshEntity: (entityId: string) => void;
  applyEntityTransform: (entityId: string, entity: EditorEntity) => void;
  applyGlbOverrideToNode: (
    entityId: string,
    nodeName: string,
    transform: EntityTransform,
  ) => void;
  applyHiddenNodesForEntity: (entityId: string) => void;
  refreshGlbNodeComponents: (
    edits: ReadonlyArray<{ entityId: string; nodeName: string }>,
  ) => void;
  disposeTracked: () => void;
}

export interface ViewportEntityGraphDeps {
  store: EditorStore;
  entityRoot: THREE.Group;
  gizmo: TransformControls;
  selectionBoxes: { forEach: (fn: (box: { update: () => void }) => void) => void };
  syncSelectionHighlight: () => void;
  applyShipPreview: (options?: { quiet?: boolean }) => void;
  resetShipPreviewWarnings: () => void;
  registerParticleHandle: (entityId: string, handle: ParticleSystemHandle) => void;
  disposeParticleHandles: () => void;
  disposeParticleHandlesForEntity: (entityId: string) => void;
}

function findLoadedEntityModel(group: THREE.Group): THREE.Object3D | null {
  for (const child of group.children) {
    if (child.userData.entityId) continue;
    if (child.userData.glbNodeUuid) return child;
  }
  return null;
}

export function createViewportEntityGraph(
  deps: ViewportEntityGraphDeps,
): ViewportEntityGraph {
  const {
    store,
    entityRoot,
    gizmo,
    selectionBoxes,
    syncSelectionHighlight,
    applyShipPreview,
    resetShipPreviewWarnings,
    registerParticleHandle,
    disposeParticleHandles,
    disposeParticleHandlesForEntity,
  } = deps;

  const objectsById = new Map<string, THREE.Group>();
  const disposables: { dispose: () => void }[] = [];
  let buildGeneration = 0;
  let pendingModelLoads = 0;

  function track<T extends { dispose: () => void }>(resource: T): T {
    disposables.push(resource);
    return resource;
  }

  function notifyModelLoadSettled(generation: number): void {
    if (generation !== buildGeneration || pendingModelLoads > 0) return;
    applyShipPreview({ quiet: false });
  }

  const npcRoutes = createViewportNpcRoutes(
    store,
    entityRoot,
    objectsById,
    track,
  );

  const {
    makeHelperMesh,
    makeRestHeightHelper,
    clearRestHeightHelpers,
    buildComponentHelper,
  } = createViewportComponentHelpers(track);

  function applyGlbOverrideToNode(
    entityId: string,
    nodeName: string,
    transform: EntityTransform,
  ): void {
    const entityGroup = objectsById.get(entityId);
    if (!entityGroup) return;
    const node = findGlbNodeByName(entityGroup, nodeName);
    if (!node) return;
    applyTransformToObject3D(node, transform);
    selectionBoxes.forEach((box) => box.update());
  }

  function applyGlbOverridesForEntity(entityId: string): void {
    for (const entry of store.getGlbOverridesForEntity(entityId)) {
      if (!entry.transform) continue;
      applyGlbOverrideToNode(entityId, entry.nodeName, entry.transform);
    }
  }

  function applyHiddenNodesForEntity(entityId: string): void {
    const entityGroup = objectsById.get(entityId);
    if (!entityGroup) return;
    for (const nodeName of store.getGlbHiddenNodes(entityId)) {
      const node = findGlbNodeByName(entityGroup, nodeName);
      if (node) node.visible = false;
    }
  }

  function refreshGlbNodeComponents(
    edits: ReadonlyArray<{ entityId: string; nodeName: string }>,
  ): void {
    for (const edit of edits) {
      const entity = store.locate(edit.entityId)?.entity;
      const group = objectsById.get(edit.entityId);
      if (!entity?.asset || !group) continue;
      const model = findLoadedEntityModel(group);
      if (!model) continue;
      refreshNodeOverrideComponentHelpers({
        entity,
        model,
        nodeName: edit.nodeName,
        helpers: { buildComponentHelper },
        sanitizeNodeName,
      });
    }
    selectionBoxes.forEach((box) => box.update());
  }

  function buildEntityObject(
    entity: EditorEntity,
    generation: number,
  ): THREE.Group {
    const group = new THREE.Group();
    group.name = entity.name;
    group.userData.entityId = entity.id;
    group.visible = entity.visible;
    const recenterAsHull = entity.components.some(
      (component) =>
        component.type === "ship-hull" || component.type === "ship-controller",
    );
    group.userData.editorAssetUrl = entity.asset?.url ?? null;
    group.userData.editorHasPrimitive = Boolean(entity.primitive);
    group.userData.editorRecenterAsHull = recenterAsHull;
    applyEntityTransformToObject(group, entity);
    objectsById.set(entity.id, group);

    let hasVisual = false;
    if (entity.primitive) {
      const mesh = createPrimitiveMesh(entity.primitive, entity.materialOverrides);
      track(mesh.geometry);
      track(mesh.material as THREE.Material);
      group.add(mesh);
      hasVisual = true;
    }
    if (entity.asset) {
      hasVisual = true;
      const asset = entity.asset;
      const url = asset.url;
      // The game recenters the flyable hull on its bounding-box center
      // (ship_model.ts), so mirror that here or zones drift from the mesh.
      pendingModelLoads += 1;
      void loadPrefabModel(url)
        .then((model) => {
          finalizeLoadedEntityModel({
            generation,
            buildGeneration,
            entity,
            group,
            model,
            recenterAsHull,
            entityRoot,
            store,
            helpers: {
              buildComponentHelper,
              makeRestHeightHelper,
              clearRestHeightHelpers,
              makeHelperMesh,
            },
            track,
            sanitizeNodeName,
            buildGlbNodeRef,
            tagGlbNodes,
            applyGlbOverridesForEntity,
            applyHiddenNodesForEntity,
          });
        })
        .catch(() => {
          if (generation !== buildGeneration) return;
          const placeholder = makeHelperMesh(
            new THREE.BoxGeometry(1, 1, 1),
            0xff7d7d,
            0.5,
            true,
          );
          group.add(placeholder);
          store.setGlbTree(entity.id, null);
          console.warn(`Editor: asset failed to load: ${url}`);
        })
        .finally(() => {
          if (generation !== buildGeneration) return;
          pendingModelLoads -= 1;
          notifyModelLoadSettled(generation);
        });
    }

    hasVisual =
      attachTopLevelEntityComponents({
        entity,
        group,
        entityRoot,
        helpers: { buildComponentHelper },
        registerParticleHandle,
        createParticleSystem,
      }) || hasVisual;

    const prefabInstance = entity.components.find(
      (component) => component.type === "prefab-instance",
    );
    if (prefabInstance && prefabInstance.type === "prefab-instance") {
      hasVisual = true;
      const prefabId = prefabInstance.prefabId;
      pendingModelLoads += 1;
      void loadPrefabDocument(prefabId)
        .then(async (doc) => {
          if (generation !== buildGeneration || !doc) return;
          const instanceGroup = await createPropInstanceGroupAsync(doc);
          if (generation !== buildGeneration) return;
          attachPrefabInstanceColliderHelpers({
            instanceRoot: instanceGroup,
            doc,
            helpers: { buildComponentHelper },
            sanitizeNodeName,
          });
          instanceGroup.name = `prefab-instance:${prefabId}`;
          instanceGroup.userData.prefabInstanceId = prefabId;
          // Clear any previous instance preview children marked as such.
          for (const child of [...group.children]) {
            if (child.userData.prefabInstanceId) group.remove(child);
          }
          group.add(instanceGroup);
          selectionBoxes.forEach((box) => box.update());
          syncSelectionHighlight();
        })
        .catch((error) => {
          console.warn(
            `Editor: prefab-instance "${prefabId}" failed to load.`,
            error,
          );
        })
        .finally(() => {
          if (generation !== buildGeneration) return;
          pendingModelLoads -= 1;
          notifyModelLoadSettled(generation);
        });
    }

    if (!hasVisual && entity.children.length === 0) {
      const marker = makeHelperMesh(
        new THREE.BoxGeometry(0.4, 0.4, 0.4),
        0x8fa3c9,
        0.5,
        true,
      );
      group.add(marker);
    }

    for (const child of entity.children) {
      group.add(buildEntityObject(child, generation));
    }
    return group;
  }

  function rebuildAll(): void {
    buildGeneration += 1;
    pendingModelLoads = 0;
    resetShipPreviewWarnings();
    gizmo.detach();
    entityRoot.clear();
    objectsById.clear();
    store.clearGlbTrees();
    disposeParticleHandles();
    npcRoutes.clear();
    setupUpdateObjectAnimations(entityRoot);
    for (const resource of disposables) resource.dispose();
    disposables.length = 0;

    for (const entity of store.getState().roots) {
      entityRoot.add(buildEntityObject(entity, buildGeneration));
    }
    npcRoutes.build();
    syncSelectionHighlight();
    // Defer articulation preview until async GLBs finish (settled apply in load finally).
    if (pendingModelLoads === 0) applyShipPreview({ quiet: false });
  }

  /**
   * In-place update for rename / visibility / component edits. Avoids reminting
   * GLB UUIDs (which collapses hierarchy expand state and drops selection highlight).
   * Falls back to rebuildAll when the visual identity of the entity changed.
   */
  function refreshEntity(entityId: string): void {
    const entity = store.locate(entityId)?.entity;
    const group = objectsById.get(entityId);
    if (!entity || !group) {
      rebuildAll();
      return;
    }

    const nextAssetUrl = entity.asset?.url ?? null;
    const nextHasPrimitive = Boolean(entity.primitive);
    const nextRecenterAsHull = entity.components.some(
      (component) =>
        component.type === "ship-hull" || component.type === "ship-controller",
    );
    if (
      group.userData.editorAssetUrl !== nextAssetUrl ||
      group.userData.editorHasPrimitive !== nextHasPrimitive ||
      group.userData.editorRecenterAsHull !== nextRecenterAsHull
    ) {
      rebuildAll();
      return;
    }

    group.name = entity.name;
    group.visible = entity.visible;
    applyEntityTransformToObject(group, entity);

    disposeParticleHandlesForEntity(entityId);
    clearEntityLevelComponentHelpers(group);
    clearRestHeightHelpers(group);

    attachTopLevelEntityComponents({
      entity,
      group,
      entityRoot,
      helpers: { buildComponentHelper },
      registerParticleHandle,
      createParticleSystem,
    });

    const model = findLoadedEntityModel(group);
    if (model) {
      for (const material of applyPrefabMaterialOverrides(
        model,
        entity.materialOverrides,
      )) {
        track(material);
      }
      refreshEntityModelComponentHelpers({
        entity,
        model,
        helpers: { buildComponentHelper },
        sanitizeNodeName,
      });
      attachModelObjectAnimations({ entity, model, entityRoot });
      if (nextRecenterAsHull) {
        attachRestHeightHelperForHull({
          entity,
          group,
          model,
          helpers: {
            buildComponentHelper,
            makeRestHeightHelper,
            clearRestHeightHelpers,
            makeHelperMesh,
          },
        });
      }
    }

    npcRoutes.build();
    selectionBoxes.forEach((box) => box.update());
    syncSelectionHighlight();
    applyShipPreview({ quiet: true });
  }

  return {
    objectsById,
    track,
    updateNpcRoutes: npcRoutes.update,
    rebuildAll,
    refreshEntity,
    applyEntityTransform(entityId, entity) {
      const object = objectsById.get(entityId);
      if (!object) return;
      applyEntityTransformToObject(object, entity);
      entityRoot.userData.refreshObjectAnimationBase?.(object);
    },
    applyGlbOverrideToNode,
    applyHiddenNodesForEntity,
    refreshGlbNodeComponents,
    disposeTracked() {
      for (const resource of disposables) resource.dispose();
      disposables.length = 0;
    },
  };
}
