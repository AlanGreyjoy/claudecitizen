import * as THREE from "three";
import type { TransformControls } from "three/examples/jsm/controls/TransformControls";
import type { OrbitControls } from "three/examples/jsm/controls/OrbitControls";
import type { EditorStore } from "../../editor/document";
import type { ViewportGlbQueries } from "./viewport_glb_queries";
import {
  findObjectByUuid,
  RAD_TO_DEG,
  withLightRangesHidden,
} from "./viewport_transforms";

const PRIMARY_BOX_COLOR = 0x8bd8ff;
const SECONDARY_BOX_COLOR = 0x5a9cb8;

export interface ViewportSelection {
  boxes: THREE.BoxHelper[];
  syncHighlight: () => void;
  getGizmoTarget: () => THREE.Object3D | null;
  focusSelection: () => void;
  getDraggingEntityId: () => string | null;
  isDraggingSelection: () => boolean;
  dispose: () => void;
}

export interface ViewportSelectionDeps {
  store: EditorStore;
  scene: THREE.Scene;
  camera: THREE.PerspectiveCamera;
  entityRoot: THREE.Group;
  objectsById: Map<string, THREE.Group>;
  gizmo: TransformControls;
  orbit: OrbitControls;
  glbQueries: ViewportGlbQueries;
}

export function createViewportSelection(
  deps: ViewportSelectionDeps,
): ViewportSelection {
  const {
    store,
    scene,
    camera,
    entityRoot,
    objectsById,
    gizmo,
    orbit,
    glbQueries,
  } = deps;

  let selectionBoxes: THREE.BoxHelper[] = [];
  let draggingEntityId: string | null = null;
  let draggingGlbNode: { entityId: string; nodeUuid: string } | null = null;

  function getGizmoTarget(): THREE.Object3D | null {
    const entityId = store.getSelection();
    if (!entityId) return null;
    const entityObject = objectsById.get(entityId);
    if (!entityObject) return null;
    const sub = store.getSubSelection();
    if (sub && sub.entityId === entityId) {
      const node = findObjectByUuid(entityObject, sub.nodeUuid);
      if (node) return node;
    }
    return entityObject;
  }

  function clearSelectionBoxes(): void {
    for (const box of selectionBoxes) {
      scene.remove(box);
      box.geometry.dispose();
      (box.material as THREE.Material).dispose();
    }
    selectionBoxes = [];
  }

  function syncLightRangeHelpers(selectedIds: ReadonlySet<string>): void {
    for (const [entityId, object] of objectsById) {
      const showRange = selectedIds.has(entityId);
      object.traverse((child) => {
        if (child.userData.editorLightRangeHelper) {
          child.visible = showRange;
        }
      });
    }
  }

  function syncSelectionHighlight(): void {
    const entityId = store.getSelection();
    gizmo.detach();
    clearSelectionBoxes();
    const selectedIds = store.getSelectedIds();
    const sub = store.getSubSelection();
    syncLightRangeHelpers(new Set(selectedIds));
    if (selectedIds.length === 0) return;

    for (const selectedId of selectedIds) {
      const object = objectsById.get(selectedId);
      if (!object) continue;
      const color =
        selectedId === entityId ? PRIMARY_BOX_COLOR : SECONDARY_BOX_COLOR;
      const boxTarget =
        sub &&
        sub.entityId === selectedId &&
        selectedIds.length === 1
          ? (findObjectByUuid(object, sub.nodeUuid) ?? object)
          : object;
      const box = withLightRangesHidden(
        boxTarget,
        () => new THREE.BoxHelper(boxTarget, color),
      );
      // BoxHelper.update() runs every frame; keep light volumes out of the outline.
      const updateBox = box.update.bind(box);
      box.update = () => {
        withLightRangesHidden(boxTarget, updateBox);
      };
      scene.add(box);
      selectionBoxes.push(box);
    }

    const target = getGizmoTarget();
    if (!target) return;
    gizmo.attach(target);
  }

  function focusSelection(): void {
    const box = new THREE.Box3();
    const selectedIds = store.getSelectedIds();
    const sub = store.getSubSelection();

    if (sub && selectedIds.length <= 1) {
      const target = getGizmoTarget();
      if (target) {
        withLightRangesHidden(target, () => {
          box.setFromObject(target);
        });
      }
    } else if (selectedIds.length > 0) {
      let hasContent = false;
      for (const selectedId of selectedIds) {
        const object = objectsById.get(selectedId);
        if (!object) continue;
        withLightRangesHidden(object, () => {
          box.expandByObject(object);
        });
        hasContent = true;
      }
      if (!hasContent && entityRoot.children.length > 0) {
        box.setFromObject(entityRoot);
      }
    } else if (entityRoot.children.length > 0) {
      box.setFromObject(entityRoot);
    } else {
      return;
    }
    if (box.isEmpty()) return;
    const center = box.getCenter(new THREE.Vector3());
    const radius = Math.max(2, box.getSize(new THREE.Vector3()).length() / 2);
    const direction = camera.position.clone().sub(orbit.target).normalize();
    orbit.target.copy(center);
    camera.position.copy(
      center.clone().add(direction.multiplyScalar(radius * 2.2)),
    );
  }

  gizmo.addEventListener("dragging-changed", (event) => {
    const dragging = Boolean((event as unknown as { value: boolean }).value);
    orbit.enabled = !dragging;
    if (dragging) {
      const sub = store.getSubSelection();
      const entityId = store.getSelection();
      const gizmoTarget = getGizmoTarget();
      if (
        sub &&
        entityId &&
        gizmoTarget &&
        gizmoTarget.uuid === sub.nodeUuid &&
        gizmoTarget !== objectsById.get(entityId)
      ) {
        draggingGlbNode = { entityId, nodeUuid: sub.nodeUuid };
        draggingEntityId = null;
        const before = glbQueries.getGlbNodeLocalTransform(entityId, sub.nodeUuid);
        if (before) {
          store.beginGlbTransformGesture(entityId, sub.nodeUuid, before);
        }
        return;
      }
      draggingGlbNode = null;
      draggingEntityId = entityId;
      if (draggingEntityId) store.beginTransformGesture(draggingEntityId);
      return;
    }
    if (draggingEntityId) store.endTransformGesture();
    if (draggingGlbNode) store.endGlbTransformGesture();
    if (draggingEntityId) {
      const object = objectsById.get(draggingEntityId);
      if (object) {
        entityRoot.userData.refreshObjectAnimationBase?.(object);
      }
    }
    draggingEntityId = null;
    draggingGlbNode = null;
  });

  gizmo.addEventListener("objectChange", () => {
    const object = gizmo.object;
    if (!object) return;
    if (draggingGlbNode) {
      store.previewGlbTransform(draggingGlbNode.entityId, draggingGlbNode.nodeUuid, {
        position: {
          x: object.position.x,
          y: object.position.y,
          z: object.position.z,
        },
        rotation: {
          x: object.rotation.x * RAD_TO_DEG,
          y: object.rotation.y * RAD_TO_DEG,
          z: object.rotation.z * RAD_TO_DEG,
        },
        scale: { x: object.scale.x, y: object.scale.y, z: object.scale.z },
      });
      selectionBoxes.forEach((box) => box.update());
      return;
    }
    if (!draggingEntityId) return;
    store.previewTransform(draggingEntityId, {
      position: {
        x: object.position.x,
        y: object.position.y,
        z: object.position.z,
      },
      rotation: {
        x: object.rotation.x * RAD_TO_DEG,
        y: object.rotation.y * RAD_TO_DEG,
        z: object.rotation.z * RAD_TO_DEG,
      },
      scale: { x: object.scale.x, y: object.scale.y, z: object.scale.z },
    });
  });

  return {
    get boxes() {
      return selectionBoxes;
    },
    syncHighlight: syncSelectionHighlight,
    getGizmoTarget,
    focusSelection,
    getDraggingEntityId: () => draggingEntityId,
    isDraggingSelection: () =>
      draggingEntityId !== null || draggingGlbNode !== null,
    dispose: clearSelectionBoxes,
  };
}
