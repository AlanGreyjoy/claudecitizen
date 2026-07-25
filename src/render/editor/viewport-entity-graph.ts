import * as THREE from "three";
import type { TransformControls } from "three/examples/jsm/controls/TransformControls";
import {
  loadPrefabModel,
  createPrimitiveMesh,
  createPropInstanceGroup,
} from "../prefabs/prefab_renderer";
import { setupUpdateObjectAnimations } from "../prefabs/object_animation";
import {
  createParticleSystem,
  type ParticleSystemHandle,
} from "../particles";
import type { EditorEntity, EditorStore, EntityTransform } from "../../editor/document";
import { loadPrefabDocument } from "../../world/prefabs/loader";
import {
  createViewportComponentHelpers,
  type ViewportResourceTracker,
} from "./viewport_component_helpers";
import {
  attachTopLevelEntityComponents,
  finalizeLoadedEntityModel,
  refreshNodeOverrideComponentHelpers,
} from "./viewport_entity_model";
import { createViewportNpcRoutes } from "./viewport_npc_routes";
import {
  applyEntityTransformToObject,
  applyTransformToObject3D,
  buildGlbNodeRef,
  findGlbNodeByName,
  sanitizeNodeName,
  tagGlbNodes,
} from "./viewport_transforms";

export interface ViewportEntityGraph {
  objectsById: Map<string, THREE.Group>;
  track: ViewportResourceTracker;
  updateNpcRoutes: () => void;
  rebuildAll: () => void;
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
      const recenterAsHull = entity.components.some(
        (component) =>
          component.type === "ship-hull" || component.type === "ship-controller",
      );
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
        .then((doc) => {
          if (generation !== buildGeneration || !doc) return;
          const instanceGroup = createPropInstanceGroup(doc);
          instanceGroup.name = `prefab-instance:${prefabId}`;
          instanceGroup.userData.prefabInstanceId = prefabId;
          // Clear any previous instance preview children marked as such.
          for (const child of [...group.children]) {
            if (child.userData.prefabInstanceId) group.remove(child);
          }
          group.add(instanceGroup);
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

  return {
    objectsById,
    track,
    updateNpcRoutes: npcRoutes.update,
    rebuildAll,
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
