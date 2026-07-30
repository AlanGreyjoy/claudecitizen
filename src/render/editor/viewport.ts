import * as THREE from "three";
import type { EditorStore } from "../../editor/document";
import { toSceneDocument } from "../../editor/serialize";
import { resolveScenePlayConfig } from "../../world/scenes/scene-runtime";
import { attachViewportDrop } from "./viewport-drop";
import { createViewportEntityGraph } from "./viewport-entity-graph";
import { createViewportFlythrough } from "./viewport-flythrough";
import { createViewportGlbQueries } from "./viewport-glb-queries";
import { createViewportParticles } from "./viewport-particles";
import { createViewportPicking } from "./viewport-picking";
import { createViewportScene } from "./viewport-scene";
import { createViewportSelection } from "./viewport-selection";
import { createViewportShipPreview } from "./viewport-ship-preview";
import { createViewportSnap } from "./viewport-snap";
import { createViewFocus } from "./viewport-view-focus";
import type {
  EditorViewport,
  EditorViewportOptions,
  GizmoMode,
  GizmoSpace,
  ShipPreviewState,
} from "./viewport-types";

export type {
  EditorViewport,
  EditorViewportOptions,
  GizmoMode,
  GizmoSpace,
  ShipPreviewState,
} from "./viewport-types";

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
    registerParticlePrefabRoot: particles.registerPrefabRoot,
    disposeParticleHandles: particles.disposeAll,
    disposeParticleHandlesForEntity: particles.disposeForEntity,
    disposeParticlePrefabRootsForEntity: particles.disposePrefabRootsForEntity,
    discardParticlePrefabRoot: particles.discardPrefabRoot,
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

  const viewFocus = createViewFocus({
    camera,
    getTarget: () => orbit.target,
    entityRoot,
    objectsById: graph.objectsById,
    isSnapEnabled: snap.isEnabled,
    getTranslateStep: snap.getTranslateStep,
  });

  const drop = attachViewportDrop({
    container,
    canvas,
    camera,
    isSnapEnabled: snap.isEnabled,
    getTranslateStep: snap.getTranslateStep,
    isPlayMode: () => playMode,
    onDropAsset: options.onDropAsset,
    onDropPrefab: options.onDropPrefab,
  });

  const unsubscribe = store.subscribe((event) => {
    if (event.type === "structure" || event.type === "document") {
      graph.rebuildAll();
      syncSceneEnvironment();
      return;
    }
    if (event.type === "entity") {
      // Component / rename / visibility edits — keep the live GLB graph so
      // hierarchy expand keys and selection highlight survive.
      graph.refreshEntity(event.entityId);
      syncSceneEnvironment();
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
      syncSceneEnvironment();
      return;
    }
  });

  function syncSceneEnvironment(): void {
    const state = store.getState();
    if (state.documentType !== "scene") {
      viewportScene.setSceneEnvironment(null);
      return;
    }
    const config = resolveScenePlayConfig(toSceneDocument(state)).environment;
    viewportScene.setSceneEnvironment(config);
  }

  const resizeObserver = new ResizeObserver(viewportScene.resize);
  resizeObserver.observe(container);
  viewportScene.resize();

  let disposed = false;
  // WebGPURenderer initializes its backend asynchronously. Calling render()
  // before that lands still draws (it forwards to renderAsync), but warns on
  // every frame, so hold off until the backend is up.
  let backendReady = false;
  void viewportScene.ready.then(
    () => {
      backendReady = true;
    },
    (error: unknown) => {
      // WebGPU is a hard requirement — there is no WebGL fallback to drop to, so
      // the viewport stays blank on purpose rather than rendering something that
      // hides the problem. A user-facing boot gate belongs at the app layer, not
      // here; this keeps the cause loud in the meantime.
      console.error('[viewport] WebGPU unavailable — viewport disabled.', error);
    },
  );
  const frameClock = new THREE.Clock();
  function animate(): void {
    if (disposed) return;
    requestAnimationFrame(animate);
    if (!backendReady) return;
    const dt = Math.min(frameClock.getDelta(), 0.1);
    // OrbitControls.update() re-seats the camera from its own spherical state,
    // so it must not run while the flythrough owns the camera.
    if (flythrough.isFlying()) flythrough.update(dt);
    else orbit.update();
    selection.boxes.forEach((box) => box.update());
    graph.updateNpcRoutes();
    particles.update(dt, camera);
    viewportScene.updateSky(dt);
    if (!selection.isDraggingSelection()) {
      entityRoot.userData.updateObjectAnimations?.(dt);
    }
    renderer.render(scene, camera);
  }
  animate();

  graph.rebuildAll();
  syncSceneEnvironment();

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
    setEnvironmentLights: viewportScene.setEnvironmentLights,
    setProceduralSky: viewportScene.setProceduralSky,
    setShowAllColliders: selection.setShowAllColliders,
    setGridVisible: viewportScene.setGridVisible,
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
    getViewFocusPosition: viewFocus.getViewFocusPosition,
    getGlbNodePrefabPosition: glbQueries.getGlbNodePrefabPosition,
    getGlbNodePrefabTransform: glbQueries.getGlbNodePrefabTransform,
    getEntityTransformRelativeToGlbNode: glbQueries.getEntityTransformRelativeToGlbNode,
    getGlbNodeBounds: glbQueries.getGlbNodeBounds,
    getGlbNodeLocalTransform: glbQueries.getGlbNodeLocalTransform,
    setGlbNodeLocalTransform: glbQueries.setGlbNodeLocalTransform,
    setMaterialPreview: graph.setMaterialPreview,
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
