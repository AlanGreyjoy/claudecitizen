import * as THREE from "three";
import type { TransformControls } from "three/examples/jsm/controls/TransformControls";
import { showContextMenu } from "../../editor/dom";
import { buildGlbAuthoringMenu } from "../../editor/component_actions";
import type { EditorStore } from "../../editor/document";
import type { ViewportGlbQueries } from "./viewport_glb_queries";
import {
  entityIdFromObject,
  isEffectivelyVisible,
  pathFromEntityRoot,
} from "./viewport_transforms";

export interface ViewportPicking {
  noteSelectionEntity: (entityId: string | null) => void;
  dispose: () => void;
}

export interface ViewportPickingDeps {
  store: EditorStore;
  camera: THREE.PerspectiveCamera;
  canvas: HTMLCanvasElement;
  entityRoot: THREE.Group;
  objectsById: Map<string, THREE.Group>;
  gizmo: TransformControls;
  isFlying: () => boolean;
  isPlayMode: () => boolean;
  glbQueries: ViewportGlbQueries;
}

export function createViewportPicking(deps: ViewportPickingDeps): ViewportPicking {
  const {
    store,
    camera,
    canvas,
    entityRoot,
    objectsById,
    gizmo,
    isFlying,
    isPlayMode,
    glbQueries,
  } = deps;

  let lastDrillEntityId: string | null = null;
  let lastDrillScreen: { x: number; y: number } | null = null;
  const raycaster = new THREE.Raycaster();
  const pointer = new THREE.Vector2();
  let pointerDownAt: { x: number; y: number } | null = null;

  /** Deepest GLB-tree node along a pick path (0 = entity root / no GLB node). */
  function deepestGlbNodeIndex(entityId: string, path: THREE.Object3D[]): number {
    for (let i = path.length - 1; i >= 1; i--) {
      if (store.getGlbNodeName(entityId, path[i].uuid)) return i;
    }
    return 0;
  }

  function applyViewportPick(
    entityId: string,
    path: THREE.Object3D[],
    depth: number,
  ): void {
    if (depth <= 0) {
      store.setSelection(entityId);
      return;
    }
    store.setSubSelection(entityId, path[depth].uuid);
  }

  function pickAtScreen(
    clientX: number,
    clientY: number,
  ): { entityId: string; hitObject: THREE.Object3D; path: THREE.Object3D[] } | null {
    const rect = canvas.getBoundingClientRect();
    pointer.set(
      ((clientX - rect.left) / rect.width) * 2 - 1,
      -((clientY - rect.top) / rect.height) * 2 + 1,
    );
    raycaster.setFromCamera(pointer, camera);
    const hits = raycaster.intersectObjects(entityRoot.children, true);
    for (const hit of hits) {
      if (!isEffectivelyVisible(hit.object)) continue;
      if (hit.object.userData.editorMeshColliderHelper) continue;
      if (hit.object.userData.editorLightRangeHelper) continue;
      const entityId = entityIdFromObject(hit.object);
      if (!entityId) continue;
      const root = objectsById.get(entityId);
      if (!root) continue;
      return {
        entityId,
        hitObject: hit.object,
        path: pathFromEntityRoot(root, hit.object),
      };
    }
    return null;
  }

  function onContextMenu(event: MouseEvent): void {
    event.preventDefault();
    if (isPlayMode() || isFlying()) return;
    const sub = store.getSubSelection();
    if (!sub) return;
    const nodeName = store.getGlbNodeName(sub.entityId, sub.nodeUuid);
    showContextMenu(
      event.clientX,
      event.clientY,
      buildGlbAuthoringMenu(
        store,
        sub.entityId,
        sub.nodeUuid,
        glbQueries.getGlbNodePrefabPosition,
        glbQueries.getGlbNodeBounds,
        nodeName,
      ),
    );
  }

  function onPointerDown(event: PointerEvent): void {
    if (isPlayMode()) return;
    if (event.button !== 0) return;
    pointerDownAt = { x: event.clientX, y: event.clientY };
  }

  function onPointerUp(event: PointerEvent): void {
    if (isPlayMode()) {
      pointerDownAt = null;
      return;
    }
    if (event.button !== 0 || !pointerDownAt) return;
    const moved = Math.hypot(
      event.clientX - pointerDownAt.x,
      event.clientY - pointerDownAt.y,
    );
    const clickAt = { x: event.clientX, y: event.clientY };
    pointerDownAt = null;
    if (moved > 5) return;
    if (gizmo.axis) return;

    const pick = pickAtScreen(clickAt.x, clickAt.y);
    if (!pick) {
      lastDrillEntityId = null;
      lastDrillScreen = null;
      store.clearSelection();
      return;
    }

    const { entityId, path } = pick;
    const deepest = deepestGlbNodeIndex(entityId, path);
    const modifierToggle = event.ctrlKey || event.metaKey;
    if (modifierToggle) {
      lastDrillEntityId = entityId;
      lastDrillScreen = clickAt;
      store.setEntitySelection(entityId, "toggle");
      return;
    }

    const sameEntity = entityId === lastDrillEntityId;
    const sameSpot =
      sameEntity &&
      lastDrillScreen !== null &&
      Math.hypot(clickAt.x - lastDrillScreen.x, clickAt.y - lastDrillScreen.y) <=
        5;

    if (!sameSpot) {
      // Select what was clicked (deepest GLB node under the cursor).
      lastDrillEntityId = entityId;
      lastDrillScreen = clickAt;
      applyViewportPick(entityId, path, deepest);
      return;
    }

    // Re-click same spot: walk up toward the entity, then cycle back to the leaf.
    lastDrillScreen = clickAt;
    const sub = store.getSubSelection();
    let depth = 0;
    if (sub?.entityId === entityId) {
      const idx = path.findIndex((object) => object.uuid === sub.nodeUuid);
      if (idx > 0) depth = idx;
    }

    if (depth <= 0) {
      applyViewportPick(entityId, path, deepest);
      return;
    }

    let next = depth - 1;
    while (next > 0 && !store.getGlbNodeName(entityId, path[next].uuid)) {
      next -= 1;
    }
    applyViewportPick(entityId, path, next);
  }

  canvas.addEventListener("contextmenu", onContextMenu);
  canvas.addEventListener("pointerdown", onPointerDown);
  canvas.addEventListener("pointerup", onPointerUp);

  return {
    noteSelectionEntity(entityId) {
      lastDrillEntityId = entityId;
    },
    dispose() {
      canvas.removeEventListener("contextmenu", onContextMenu);
      canvas.removeEventListener("pointerdown", onPointerDown);
      canvas.removeEventListener("pointerup", onPointerUp);
    },
  };
}
