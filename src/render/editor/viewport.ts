import * as THREE from "three";
import type { EditorStore } from "../../editor/document";
import { attachViewportDrop } from "./viewport_drop";
import { createViewportEntityGraph } from "./viewport_entity_graph";
import { createViewportFlythrough } from "./viewport_flythrough";
import { createViewportGlbQueries } from "./viewport_glb_queries";
import { createViewportParticles } from "./viewport_particles";
import { createViewportPicking } from "./viewport_picking";
import { createViewportScene } from "./viewport_scene";
import { createViewportSelection } from "./viewport_selection";
import { createViewportShipPreview } from "./viewport_ship_preview";
import { createViewportSnap } from "./viewport_snap";
import type {
  EditorViewport,
  EditorViewportOptions,
  GizmoMode,
  GizmoSpace,
  ShipPreviewState,
} from "./viewport_types";

export type {
  EditorViewport,
  EditorViewportOptions,
  GizmoMode,
  GizmoSpace,
  ShipPreviewState,
} from "./viewport_types";

export function createEditorViewport(
  container: HTMLElement,
  store: EditorStore,
  options: EditorViewportOptions,
): EditorViewport {
  const viewportScene = createViewportScene(container);
  const {
    canvas,
    renderer,
    scene,
    camera,
    entityRoot,
    orbit,
    gizmo,
  } = viewportScene;

  const flythrough = createViewportFlythrough(camera, canvas, orbit);
  const particles = createViewportParticles();
  const shipPreview = createViewportShipPreview(store, entityRoot);
  const snap = createViewportSnap(gizmo);
  let playMode = false;

  // Selection is created after the entity graph (needs objectsById), but the
  // graph calls into selection during rebuild — bridge until both exist.
  const selectionRef: {
    current: ReturnType<typeof createViewportSelection> | null;
  } = { current: null };

  const graph = createViewportEntityGraph({
    store,
    entityRoot,
    gizmo,
    selectionBoxes: {
      forEach(fn) {
        selectionRef.current?.boxes.forEach(fn);
      },
    },
    syncSelectionHighlight() {
      selectionRef.current?.syncHighlight();
    },
    applyShipPreview: shipPreview.apply,
    resetShipPreviewWarnings: shipPreview.resetMissingWarnings,
    registerParticleHandle: particles.register,
    disposeParticleHandles: particles.disposeAll,
  });

  const glbQueries = createViewportGlbQueries(
    store,
    entityRoot,
    graph.objectsById,
  );

  const selection = createViewportSelection({
    store,
    scene,
    camera,
    entityRoot,
    objectsById: graph.objectsById,
    gizmo,
    orbit,
    glbQueries,
  });
  selectionRef.current = selection;

  const picking = createViewportPicking({
    store,
    camera,
    canvas,
    entityRoot,
    objectsById: graph.objectsById,
    gizmo,
    isFlying: flythrough.isFlying,
    isPlayMode: () => playMode,
    glbQueries,
  });

  const drop = attachViewportDrop({
    container,
    canvas,
    camera,
    isSnapEnabled: snap.isEnabled,
    getTranslateStep: snap.getTranslateStep,
    isPlayMode: () => playMode,
    onDropAsset: options.onDropAsset,
  });

  const unsubscribe = store.subscribe((event) => {
    if (
      event.type === "structure" ||
      event.type === "document" ||
      event.type === "entity"
    ) {
      graph.rebuildAll();
      return;
    }
    if (event.type === "glb-components") {
      graph.refreshGlbNodeComponents(event.edits);
      return;
    }
    if (event.type === "transform") {
      const entity = store.locate(event.entityId)?.entity;
      if (entity && selection.getDraggingEntityId() !== event.entityId) {
        graph.applyEntityTransform(event.entityId, entity);
      }
      return;
    }
    if (event.type === "selection" || event.type === "sub-selection") {
      if (event.type === "selection") {
        picking.noteSelectionEntity(event.entityId);
      }
      selection.syncHighlight();
      return;
    }
    if (event.type === "glb-transform") {
      const override = store.getGlbNodeOverride(event.entityId, event.nodeUuid);
      if (override) {
        graph.applyGlbOverrideToNode(event.entityId, event.nodeName, override);
      }
      return;
    }
    if (event.type === "glb-visibility") {
      graph.applyHiddenNodesForEntity(event.entityId);
      return;
    }
    if (event.type === "history") {
      return;
    }
  });

  const resizeObserver = new ResizeObserver(viewportScene.resize);
  resizeObserver.observe(container);
  viewportScene.resize();

  let disposed = false;
  const frameClock = new THREE.Clock();
  function animate(): void {
    if (disposed) return;
    requestAnimationFrame(animate);
    const dt = Math.min(frameClock.getDelta(), 0.1);
    // OrbitControls.update() re-seats the camera from its own spherical state,
    // so it must not run while the flythrough owns the camera.
    if (flythrough.isFlying()) flythrough.update(dt);
    else orbit.update();
    selection.boxes.forEach((box) => box.update());
    graph.updateNpcRoutes();
    particles.update(dt, camera);
    if (!selection.isDraggingSelection()) {
      entityRoot.userData.updateObjectAnimations?.(dt);
    }
    renderer.render(scene, camera);
  }
  animate();

  graph.rebuildAll();

  return {
    setGizmoMode(mode: GizmoMode) {
      if (playMode) return;
      gizmo.setMode(mode);
    },
    setGizmoSpace(space: GizmoSpace) {
      if (playMode) return;
      gizmo.setSpace(space);
    },
    setSnap: snap.setSnap,
    setPlayMode(playing: boolean) {
      playMode = playing;
      container.classList.toggle("is-playing", playing);
      if (playing) {
        gizmo.detach();
        store.clearSelection();
      }
    },
    isPlayMode: () => playMode,
    setShipPreview(state: ShipPreviewState) {
      shipPreview.setState(state);
    },
    focusSelection: selection.focusSelection,
    getGlbNodePrefabPosition: glbQueries.getGlbNodePrefabPosition,
    getGlbNodePrefabTransform: glbQueries.getGlbNodePrefabTransform,
    getGlbNodeBounds: glbQueries.getGlbNodeBounds,
    getGlbNodeLocalTransform: glbQueries.getGlbNodeLocalTransform,
    setGlbNodeLocalTransform: glbQueries.setGlbNodeLocalTransform,
    isFlying: flythrough.isFlying,
    particlePreview: particles.preview,
    dispose() {
      disposed = true;
      flythrough.dispose();
      unsubscribe();
      particles.disposeAll();
      snap.dispose();
      drop.dispose();
      picking.dispose();
      selection.dispose();
      resizeObserver.disconnect();
      graph.disposeTracked();
      viewportScene.dispose();
    },
  };
}
