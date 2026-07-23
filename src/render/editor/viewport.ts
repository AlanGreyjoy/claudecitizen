import * as THREE from "three";
import { OrbitControls } from "three/examples/jsm/controls/OrbitControls";
import { TransformControls } from "three/examples/jsm/controls/TransformControls";
import {
  loadPrefabModel,
  createPrimitiveMesh,
} from "../prefabs/prefab_renderer";
import { setupUpdateObjectAnimations } from "../prefabs/object_animation";
import {
  createParticleSystem,
  type ParticleSystemHandle,
} from "../particles";
import {
  BUILTIN_GEAR_HINGES,
  BUILTIN_RAMP_HINGE,
} from "../main/scene/ship_model";
import type { EditorEntity, EditorStore, EntityTransform, GlbNodeRef } from "../../editor/document";
import type { PrefabComponent } from "../../world/prefabs/schema";
import type { Vec3 } from "../../types";
import { showContextMenu } from "../../editor/dom";
import { buildGlbAuthoringMenu } from "../../editor/component_actions";
import type { ParticlePreviewControls } from "../../editor/panels/particle_fields";
import { createViewportComponentHelpers } from "./viewport_component_helpers";
import {
  attachTopLevelEntityComponents,
  finalizeLoadedEntityModel,
} from "./viewport_entity_model";

export type GizmoMode = "translate" | "rotate" | "scale";
export type GizmoSpace = "local" | "world";

export interface ShipPreviewState {
  gearDown: boolean;
  rampDown: boolean;
  /** Open/closed per ship-door id. */
  doorsOpen: Record<string, boolean>;
}

export interface EditorViewportOptions {
  /** Called when an asset card is dropped onto the scene. */
  onDropAsset: (payload: string, position: Vec3) => void;
}

export interface EditorViewport {
  setGizmoMode: (mode: GizmoMode) => void;
  setGizmoSpace: (space: GizmoSpace) => void;
  setSnap: (
    enabled: boolean,
    translateStep: number,
    rotateStepDegrees: number,
  ) => void;
  /** Ship kind only: articulates gear/ramp/doors on loaded models for preview. */
  setShipPreview: (state: ShipPreviewState) => void;
  focusSelection: () => void;
  getGlbNodePrefabPosition: (entityId: string, nodeUuid: string) => Vec3 | null;
  getGlbNodePrefabTransform: (
    entityId: string,
    nodeUuid: string,
    parentEntityId?: string | null,
  ) => EntityTransform | null;
  getGlbNodeBounds: (entityId: string, nodeUuid: string) => { min: Vec3; max: Vec3 } | null;
  getGlbNodeLocalTransform: (
    entityId: string,
    nodeUuid: string,
  ) => EntityTransform | null;
  setGlbNodeLocalTransform: (
    entityId: string,
    nodeUuid: string,
    transform: Partial<EntityTransform>,
  ) => void;
  /** True while the RMB flythrough owns the camera (WASD is flying, not tool shortcuts). */
  isFlying: () => boolean;
  particlePreview: ParticlePreviewControls;
  dispose: () => void;
}

const DEG_TO_RAD = Math.PI / 180;
const RAD_TO_DEG = 180 / Math.PI;

export function createEditorViewport(
  container: HTMLElement,
  store: EditorStore,
  options: EditorViewportOptions,
): EditorViewport {
  const canvas = document.createElement("canvas");
  canvas.tabIndex = 0;
  container.appendChild(canvas);

  const renderer = new THREE.WebGLRenderer({ canvas, antialias: true });
  renderer.setPixelRatio(Math.min(window.devicePixelRatio, 2));
  renderer.outputColorSpace = THREE.SRGBColorSpace;
  renderer.toneMapping = THREE.AgXToneMapping;
  renderer.toneMappingExposure = 1.12;
  renderer.shadowMap.enabled = true;
  renderer.shadowMap.type = THREE.PCFSoftShadowMap;

  const scene = new THREE.Scene();
  scene.background = new THREE.Color(0x0a101d);
  scene.fog = new THREE.Fog(0x0a101d, 260, 620);

  const camera = new THREE.PerspectiveCamera(60, 1, 0.05, 10_000);
  camera.position.set(20, 16, 20);

  scene.add(new THREE.HemisphereLight(0xbcd4ff, 0x121725, 0.82));
  const sun = new THREE.DirectionalLight(0xfff3dc, 2.45);
  sun.position.set(36, 62, 26);
  sun.castShadow = true;
  sun.shadow.mapSize.set(2048, 2048);
  sun.shadow.camera.left = -90;
  sun.shadow.camera.right = 90;
  sun.shadow.camera.top = 90;
  sun.shadow.camera.bottom = -90;
  sun.shadow.camera.near = 1;
  sun.shadow.camera.far = 180;
  sun.shadow.camera.updateProjectionMatrix();
  sun.shadow.bias = -0.00035;
  sun.shadow.radius = 2;
  scene.add(sun);
  const fill = new THREE.DirectionalLight(0x7db8ff, 0.42);
  fill.position.set(-32, 18, -42);
  scene.add(fill);

  const grid = new THREE.GridHelper(400, 400, 0x33507a, 0x18243c);
  (grid.material as THREE.Material).transparent = true;
  (grid.material as THREE.Material).opacity = 0.6;
  scene.add(grid);
  scene.add(new THREE.AxesHelper(3));

  const entityRoot = new THREE.Group();
  entityRoot.name = "editor-entities";
  scene.add(entityRoot);
  setupUpdateObjectAnimations(entityRoot);

  const particleHandles = new Map<string, ParticleSystemHandle[]>();

  function disposeParticleHandles(): void {
    for (const handles of particleHandles.values()) {
      for (const handle of handles) handle.dispose();
    }
    particleHandles.clear();
  }

  function registerParticleHandle(
    entityId: string,
    handle: ParticleSystemHandle,
  ): void {
    const list = particleHandles.get(entityId) ?? [];
    list.push(handle);
    particleHandles.set(entityId, list);
  }

  const particlePreview: ParticlePreviewControls = {
    restart(entityId) {
      for (const handle of particleHandles.get(entityId) ?? []) handle.restart();
    },
    setPlaying(entityId, playing) {
      for (const handle of particleHandles.get(entityId) ?? []) {
        handle.setPlaying(playing);
      }
    },
    isPlaying(entityId) {
      const handles = particleHandles.get(entityId) ?? [];
      if (handles.length === 0) return true;
      return handles.some((handle) => handle.isPlaying());
    },
  };

  const orbit = new OrbitControls(camera, canvas);
  orbit.enableDamping = true;
  orbit.dampingFactor = 0.12;
  orbit.target.set(0, 2, 0);
  // Right mouse is reserved for Unity-style flythrough; pan lives on middle mouse.
  orbit.mouseButtons = {
    LEFT: THREE.MOUSE.ROTATE,
    MIDDLE: THREE.MOUSE.PAN,
    RIGHT: null as unknown as THREE.MOUSE,
  };

  const gizmo = new TransformControls(camera, canvas);
  scene.add(gizmo.getHelper());

  // ---- flythrough camera (hold RMB, Unity-style) ---------------------------

  const FLY_KEY_CODES = new Set([
    "KeyW",
    "KeyA",
    "KeyS",
    "KeyD",
    "KeyQ",
    "KeyE",
    "ShiftLeft",
    "ShiftRight",
  ]);
  const FLY_LOOK_RADIANS_PER_PIXEL = 0.0022;
  const FLY_PITCH_LIMIT = Math.PI / 2 - 0.01;

  const flyKeys = new Set<string>();
  const flyEuler = new THREE.Euler(0, 0, 0, "YXZ");
  const flyForward = new THREE.Vector3();
  const flyRight = new THREE.Vector3();
  const flyMove = new THREE.Vector3();
  let flying = false;
  let flySpeed = 12; // meters per second, tuned with the wheel while flying
  let flyTargetDistance = 10;

  function beginFly(): void {
    if (flying) return;
    flying = true;
    flyTargetDistance = Math.max(4, camera.position.distanceTo(orbit.target));
    flyEuler.setFromQuaternion(camera.quaternion, "YXZ");
    flyEuler.z = 0;
    orbit.enabled = false;
    canvas.requestPointerLock?.();
  }

  function endFly(): void {
    if (!flying) return;
    flying = false;
    flyKeys.clear();
    if (document.pointerLockElement === canvas) document.exitPointerLock();
    // Re-aim the orbit pivot in front of the camera so orbiting continues
    // naturally from wherever the flythrough ended.
    camera.getWorldDirection(flyForward);
    orbit.target
      .copy(camera.position)
      .addScaledVector(flyForward, flyTargetDistance);
    orbit.enabled = true;
    orbit.update();
  }

  function onFlyLook(event: PointerEvent): void {
    if (!flying) return;
    flyEuler.y -= event.movementX * FLY_LOOK_RADIANS_PER_PIXEL;
    flyEuler.x -= event.movementY * FLY_LOOK_RADIANS_PER_PIXEL;
    flyEuler.x = Math.max(
      -FLY_PITCH_LIMIT,
      Math.min(FLY_PITCH_LIMIT, flyEuler.x),
    );
    camera.quaternion.setFromEuler(flyEuler);
  }

  function updateFly(dt: number): void {
    camera.getWorldDirection(flyForward);
    flyRight.crossVectors(flyForward, camera.up).normalize();
    flyMove.set(0, 0, 0);
    if (flyKeys.has("KeyW")) flyMove.add(flyForward);
    if (flyKeys.has("KeyS")) flyMove.sub(flyForward);
    if (flyKeys.has("KeyD")) flyMove.add(flyRight);
    if (flyKeys.has("KeyA")) flyMove.sub(flyRight);
    if (flyKeys.has("KeyE")) flyMove.y += 1;
    if (flyKeys.has("KeyQ")) flyMove.y -= 1;
    if (flyMove.lengthSq() === 0) return;
    const boost = flyKeys.has("ShiftLeft") || flyKeys.has("ShiftRight") ? 4 : 1;
    flyMove.normalize().multiplyScalar(flySpeed * boost * dt);
    camera.position.add(flyMove);
  }

  function onFlyKey(event: KeyboardEvent): void {
    if (!flying || !FLY_KEY_CODES.has(event.code)) return;
    event.preventDefault();
    if (event.type === "keydown") flyKeys.add(event.code);
    else flyKeys.delete(event.code);
  }
  window.addEventListener("keydown", onFlyKey);
  window.addEventListener("keyup", onFlyKey);

  function onPointerLockChange(): void {
    // Esc releases pointer lock — treat it as ending the flythrough.
    if (flying && document.pointerLockElement !== canvas) endFly();
  }
  document.addEventListener("pointerlockchange", onPointerLockChange);

  canvas.addEventListener("contextmenu", (event) => {
    event.preventDefault();
    if (flying) return;
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
        getGlbNodePrefabPosition,
        getGlbNodeBounds,
        nodeName,
      ),
    );
  });
  canvas.addEventListener("pointermove", onFlyLook);
  canvas.addEventListener("pointerdown", (event) => {
    if (event.button !== 2) return;
    // Capture keeps the pointerup on the canvas even if pointer lock is denied.
    try {
      canvas.setPointerCapture(event.pointerId);
    } catch {
      // Stale pointer id (e.g. synthetic events) — flythrough still works.
    }
    beginFly();
  });
  canvas.addEventListener("pointerup", (event) => {
    if (event.button === 2) endFly();
  });
  canvas.addEventListener("pointercancel", () => endFly());
  canvas.addEventListener(
    "wheel",
    (event) => {
      if (!flying) return;
      event.preventDefault();
      event.stopImmediatePropagation();
      flySpeed = Math.min(
        200,
        Math.max(0.5, flySpeed * Math.pow(1.1, -event.deltaY / 100)),
      );
    },
    { passive: false, capture: true },
  );

  // ---- entity graph sync -------------------------------------------------

  const objectsById = new Map<string, THREE.Group>();
  const disposables: { dispose: () => void }[] = [];
  let buildGeneration = 0;

  function track<T extends { dispose: () => void }>(resource: T): T {
    disposables.push(resource);
    return resource;
  }

  const {
    makeHelperMesh,
    makeRestHeightHelper,
    clearRestHeightHelpers,
    buildComponentHelper,
  } = createViewportComponentHelpers(track);

  function applyEntityTransformToObject(
    object: THREE.Object3D,
    entity: EditorEntity,
  ): void {
    object.position.set(
      entity.position.x,
      entity.position.y,
      entity.position.z,
    );
    object.rotation.set(
      entity.rotation.x * DEG_TO_RAD,
      entity.rotation.y * DEG_TO_RAD,
      entity.rotation.z * DEG_TO_RAD,
      "XYZ",
    );
    object.scale.set(entity.scale.x, entity.scale.y, entity.scale.z);
  }

  function applyTransformToObject3D(
    object: THREE.Object3D,
    transform: EntityTransform,
  ): void {
    object.position.set(
      transform.position.x,
      transform.position.y,
      transform.position.z,
    );
    object.rotation.set(
      transform.rotation.x * DEG_TO_RAD,
      transform.rotation.y * DEG_TO_RAD,
      transform.rotation.z * DEG_TO_RAD,
      "XYZ",
    );
    object.scale.set(transform.scale.x, transform.scale.y, transform.scale.z);
  }

  function sanitizeNodeName(name: string): string {
    return name.replace(/\s/g, '_');
  }

  function findGlbNodeByName(
    entityGroup: THREE.Object3D,
    nodeName: string,
  ): THREE.Object3D | null {
    return entityGroup.getObjectByName(sanitizeNodeName(nodeName)) ?? null;
  }

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

  function buildGlbNodeRef(object: THREE.Object3D): GlbNodeRef {
    return {
      uuid: object.uuid,
      name: object.name || "(unnamed)",
      children: object.children.map((child) => buildGlbNodeRef(child)),
    };
  }

  function tagGlbNodes(object: THREE.Object3D): void {
    object.userData.glbNodeUuid = object.uuid;
    for (const child of object.children) tagGlbNodes(child);
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
            applyShipPreview,
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
        });
    }

    hasVisual = attachTopLevelEntityComponents({
      entity,
      group,
      entityRoot,
      helpers: { buildComponentHelper },
      registerParticleHandle,
      createParticleSystem,
    }) || hasVisual;

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

  interface NpcRouteLine {
    from: THREE.Object3D;
    to: THREE.Object3D;
    position: THREE.BufferAttribute;
  }

  const npcRouteLines: NpcRouteLine[] = [];
  const npcRoutePointA = new THREE.Vector3();
  const npcRoutePointB = new THREE.Vector3();

  function updateNpcRouteLines(): void {
    for (const route of npcRouteLines) {
      route.from.getWorldPosition(npcRoutePointA);
      route.to.getWorldPosition(npcRoutePointB);
      entityRoot.worldToLocal(npcRoutePointA);
      entityRoot.worldToLocal(npcRoutePointB);
      route.position.setXYZ(0, npcRoutePointA.x, npcRoutePointA.y + 0.28, npcRoutePointA.z);
      route.position.setXYZ(1, npcRoutePointB.x, npcRoutePointB.y + 0.28, npcRoutePointB.z);
      route.position.needsUpdate = true;
    }
  }

  function buildNpcRouteLines(): void {
    npcRouteLines.length = 0;
    const waypoints = new Map<
      string,
      {
        component: Extract<PrefabComponent, { type: "npc-waypoint" }>;
        object: THREE.Object3D;
      }
    >();
    const visit = (entities: readonly EditorEntity[]): void => {
      for (const entity of entities) {
        const component = entity.components.find(
          (candidate): candidate is Extract<PrefabComponent, { type: "npc-waypoint" }> =>
            candidate.type === "npc-waypoint",
        );
        const object = objectsById.get(entity.id);
        if (component && object) waypoints.set(component.id, { component, object });
        visit(entity.children);
      }
    };
    visit(store.getState().roots);

    const material = track(
      new THREE.LineBasicMaterial({
        color: 0xc39bff,
        transparent: true,
        opacity: 0.58,
        depthWrite: false,
      }),
    );
    const edges = new Set<string>();
    for (const [id, waypoint] of waypoints) {
      for (const linkedId of waypoint.component.links) {
        const linked = waypoints.get(linkedId);
        if (
          !linked ||
          linked.component.routeGroup !== waypoint.component.routeGroup ||
          linked.component.floorId !== waypoint.component.floorId
        ) {
          continue;
        }
        const edgeKey = [id, linkedId].sort().join("\u0000");
        if (edges.has(edgeKey)) continue;
        edges.add(edgeKey);
        const geometry = track(new THREE.BufferGeometry());
        const position = new THREE.BufferAttribute(new Float32Array(6), 3);
        geometry.setAttribute("position", position);
        const line = new THREE.Line(geometry, material);
        line.frustumCulled = false;
        line.renderOrder = 3;
        entityRoot.add(line);
        npcRouteLines.push({
          from: waypoint.object,
          to: linked.object,
          position,
        });
      }
    }
    updateNpcRouteLines();
  }

  function rebuildAll(): void {
    buildGeneration += 1;
    gizmo.detach();
    entityRoot.clear();
    objectsById.clear();
    store.clearGlbTrees();
    disposeParticleHandles();
    setupUpdateObjectAnimations(entityRoot);
    for (const resource of disposables) resource.dispose();
    disposables.length = 0;

    for (const entity of store.getState().roots) {
      entityRoot.add(buildEntityObject(entity, buildGeneration));
    }
    buildNpcRouteLines();
    syncSelectionHighlight();
    applyShipPreview();
  }

  // ---- ship preview articulation (gear / ramp / doors) ---------------------

  let shipPreview: ShipPreviewState = {
    gearDown: true,
    rampDown: false,
    doorsOpen: {},
  };
  const articulationBase = new WeakMap<
    THREE.Object3D,
    { position: THREE.Vector3; quaternion: THREE.Quaternion }
  >();
  const previewQuat = new THREE.Quaternion();
  const previewAxis = new THREE.Vector3();
  const PREVIEW_AXES = {
    x: new THREE.Vector3(1, 0, 0),
    y: new THREE.Vector3(0, 1, 0),
    z: new THREE.Vector3(0, 0, 1),
  } as const;

  function baseOf(object: THREE.Object3D) {
    let base = articulationBase.get(object);
    if (!base) {
      base = {
        position: object.position.clone(),
        quaternion: object.quaternion.clone(),
      };
      articulationBase.set(object, base);
    }
    return base;
  }

  function previewHinge(
    name: string,
    radians: number,
    axis: "x" | "y" | "z" = "x",
    under?: string,
  ): void {
    const object = findArticulationNode(name, under);
    if (!object) return;
    const base = baseOf(object);
    previewQuat.setFromAxisAngle(PREVIEW_AXES[axis], radians);
    object.quaternion.copy(base.quaternion).multiply(previewQuat);
  }

  function previewSlide(
    name: string,
    offset: number,
    axis: "x" | "y" | "z",
    under?: string,
  ): void {
    const object = findArticulationNode(name, under);
    if (!object) return;
    const base = baseOf(object);
    previewAxis.copy(PREVIEW_AXES[axis]).multiplyScalar(offset);
    object.position.copy(base.position).add(previewAxis);
  }

  /** Resolve a GLB node for gear/ramp/door preview; `under` disambiguates duplicates. */
  function findArticulationNode(
    name: string,
    under?: string,
  ): THREE.Object3D | null {
    const safeName = sanitizeNodeName(name);
    const scope = under
      ? entityRoot.getObjectByName(sanitizeNodeName(under))
      : entityRoot;
    if (!scope) {
      console.warn(
        `Editor ship preview: ancestor "${under}" not found for node "${name}".`,
      );
      return null;
    }
    const object =
      under && sanitizeNodeName(scope.name) === safeName
        ? scope
        : scope.getObjectByName(safeName);
    if (!object) {
      console.warn(
        under
          ? `Editor ship preview: node "${name}" not found under "${under}".`
          : `Editor ship preview: node "${name}" not found.`,
      );
    }
    return object ?? null;
  }

  function findShipController(): Extract<
    PrefabComponent,
    { type: "ship-controller" }
  > | null {
    const visit = (entities: EditorEntity[]): Extract<
      PrefabComponent,
      { type: "ship-controller" }
    > | null => {
      for (const entity of entities) {
        for (const component of entity.components) {
          if (component.type === "ship-controller") return component;
        }
        const child = visit(entity.children);
        if (child) return child;
      }
      return null;
    };
    return visit(store.getState().roots);
  }

  function collectAnimations(): Array<{
    id: string;
    motion: "slide" | "hinge";
    axis: "x" | "y" | "z";
    nodes: { name: string; delta: number; under?: string }[];
    defaultOpen?: boolean;
  }> {
    const byId = new Map<
      string,
      {
        id: string;
        motion: "slide" | "hinge";
        axis: "x" | "y" | "z";
        nodes: { name: string; delta: number; under?: string }[];
        defaultOpen?: boolean;
      }
    >();

    // Legacy: doors still authored on ship-controller.
    const controller = findShipController();
    for (const door of controller?.doors ?? []) {
      byId.set(door.id, {
        id: door.id,
        motion: door.motion,
        axis: door.axis,
        nodes: door.nodes.map((node) => ({
          name: node.name,
          delta: node.delta,
          ...(node.under ? { under: node.under } : {}),
        })),
        defaultOpen: door.defaultOpen,
      });
    }

    // Primary: ship-door / animation markers (win on id conflict).
    const visit = (entities: EditorEntity[]): void => {
      for (const entity of entities) {
        for (const component of entity.components) {
          if (component.type === "ship-door" || component.type === "animation") {
            byId.set(component.id, {
              id: component.id,
              motion: component.motion,
              axis: component.axis,
              nodes: component.nodes.map((node) => ({
                name: node.name,
                delta: node.delta,
                ...("under" in node && node.under
                  ? { under: node.under }
                  : {}),
              })),
              defaultOpen: component.defaultOpen,
            });
          }
        }
        visit(entity.children);
      }
    };
    visit(store.getState().roots);

    return [...byId.values()];
  }

  function applyShipPreview(): void {
    const isShip = store.getState().kind === "ship";
    if (isShip) {
      const controller = findShipController();
      const gear01 = shipPreview.gearDown ? 1 : 0;
      const gearHinges =
        controller?.gear?.nodes ??
        BUILTIN_GEAR_HINGES.map((hinge) => ({
          name: hinge.name,
          ...(hinge.under ? { under: hinge.under } : {}),
          deployRadians: hinge.deployRadians,
          axis: hinge.axis,
        }));
      for (const hinge of gearHinges) {
        previewHinge(
          hinge.name,
          hinge.deployRadians * gear01,
          hinge.axis ?? "x",
          hinge.under,
        );
      }
      const rampHinge = controller?.ramp?.hinge ?? {
        node: BUILTIN_RAMP_HINGE.name,
        lowerRadians: BUILTIN_RAMP_HINGE.lowerRadians,
        axis: BUILTIN_RAMP_HINGE.axis,
      };
      previewHinge(
        rampHinge.node,
        rampHinge.lowerRadians * (shipPreview.rampDown ? 1 : 0),
        rampHinge.axis ?? "x",
      );
    }
    for (const anim of collectAnimations()) {
      const open = shipPreview.doorsOpen[anim.id] ?? anim.defaultOpen ?? false;
      const open01 = open ? 1 : 0;
      for (const node of anim.nodes) {
        if (anim.motion === "slide")
          previewSlide(node.name, node.delta * open01, anim.axis, node.under);
        else previewHinge(node.name, node.delta * open01, anim.axis, node.under);
      }
    }
  }

  // ---- selection ---------------------------------------------------------

  const PRIMARY_BOX_COLOR = 0x8bd8ff;
  const SECONDARY_BOX_COLOR = 0x5a9cb8;
  let selectionBoxes: THREE.BoxHelper[] = [];
  let drillDepth = 0;
  let lastDrillEntityId: string | null = null;
  let lastDrillScreen: { x: number; y: number } | null = null;

  function findObjectByUuid(
    root: THREE.Object3D,
    uuid: string,
  ): THREE.Object3D | null {
    let found: THREE.Object3D | null = null;
    root.traverse((object) => {
      if (!found && object.uuid === uuid) found = object;
    });
    return found;
  }

  function pathFromEntityRoot(
    root: THREE.Object3D,
    hit: THREE.Object3D,
  ): THREE.Object3D[] {
    const chain: THREE.Object3D[] = [];
    let current: THREE.Object3D | null = hit;
    while (current) {
      chain.unshift(current);
      if (current === root) break;
      current = current.parent;
    }
    return chain[0] === root ? chain : [root];
  }

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

  function syncSelectionHighlight(): void {
    const entityId = store.getSelection();
    gizmo.detach();
    clearSelectionBoxes();
    const selectedIds = store.getSelectedIds();
    if (selectedIds.length === 0) return;

    for (const selectedId of selectedIds) {
      const object = objectsById.get(selectedId);
      if (!object) continue;
      const color = selectedId === entityId ? PRIMARY_BOX_COLOR : SECONDARY_BOX_COLOR;
      const box = new THREE.BoxHelper(object, color);
      scene.add(box);
      selectionBoxes.push(box);
    }

    const target = getGizmoTarget();
    if (!target) return;
    gizmo.attach(target);
  }

  const raycaster = new THREE.Raycaster();
  const pointer = new THREE.Vector2();
  let pointerDownAt: { x: number; y: number } | null = null;
  const worldPositionScratch = new THREE.Vector3();
  const localPositionScratch = new THREE.Vector3();

  function entityIdFromObject(object: THREE.Object3D): string | null {
    let current: THREE.Object3D | null = object;
    while (current) {
      const id = current.userData.entityId as string | undefined;
      if (id) return id;
      current = current.parent;
    }
    return null;
  }

  function isEffectivelyVisible(object: THREE.Object3D): boolean {
    let current: THREE.Object3D | null = object;
    while (current) {
      if (!current.visible) return false;
      current = current.parent;
    }
    return true;
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

  function getGlbNodeLocalTransform(
    entityId: string,
    nodeUuid: string,
  ): EntityTransform | null {
    const override = store.getGlbNodeOverride(entityId, nodeUuid);
    if (override) return override;
    const entityGroup = objectsById.get(entityId);
    if (!entityGroup) return null;
    const node = findObjectByUuid(entityGroup, nodeUuid);
    if (!node) return null;
    return {
      position: { x: node.position.x, y: node.position.y, z: node.position.z },
      rotation: {
        x: node.rotation.x * RAD_TO_DEG,
        y: node.rotation.y * RAD_TO_DEG,
        z: node.rotation.z * RAD_TO_DEG,
      },
      scale: { x: node.scale.x, y: node.scale.y, z: node.scale.z },
    };
  }

  function setGlbNodeLocalTransform(
    entityId: string,
    nodeUuid: string,
    transform: Partial<EntityTransform>,
  ): void {
    const before = getGlbNodeLocalTransform(entityId, nodeUuid);
    if (!before) return;
    const after: EntityTransform = {
      position: transform.position
        ? { ...transform.position }
        : { ...before.position },
      rotation: transform.rotation
        ? { ...transform.rotation }
        : { ...before.rotation },
      scale: transform.scale ? { ...transform.scale } : { ...before.scale },
    };
    store.commitGlbNodeTransform(entityId, nodeUuid, before, after);
  }

  function getGlbNodePrefabPosition(entityId: string, nodeUuid: string): Vec3 | null {
    const entityGroup = objectsById.get(entityId);
    if (!entityGroup) return null;
    const node = findObjectByUuid(entityGroup, nodeUuid);
    if (!node) return null;
    entityGroup.updateMatrixWorld(true);
    node.getWorldPosition(worldPositionScratch);
    localPositionScratch.copy(worldPositionScratch);
    entityGroup.worldToLocal(localPositionScratch);
    return {
      x: localPositionScratch.x,
      y: localPositionScratch.y,
      z: localPositionScratch.z,
    };
  }

  function getGlbNodePrefabTransform(
    entityId: string,
    nodeUuid: string,
    parentEntityId: string | null = entityId,
  ): EntityTransform | null {
    const sourceGroup = objectsById.get(entityId);
    if (!sourceGroup) return null;
    const node = findObjectByUuid(sourceGroup, nodeUuid);
    if (!node) return null;
    const parentObject = parentEntityId === null
      ? entityRoot
      : objectsById.get(parentEntityId);
    if (!parentObject) return null;
    sourceGroup.updateWorldMatrix(true, true);
    parentObject.updateWorldMatrix(true, false);
    const relativeMatrix = parentObject.matrixWorld
      .clone()
      .invert()
      .multiply(node.matrixWorld);
    const position = new THREE.Vector3();
    const rotation = new THREE.Quaternion();
    const scale = new THREE.Vector3();
    relativeMatrix.decompose(position, rotation, scale);
    const euler = new THREE.Euler().setFromQuaternion(rotation, 'XYZ');
    return {
      position: { x: position.x, y: position.y, z: position.z },
      rotation: {
        x: euler.x * RAD_TO_DEG,
        y: euler.y * RAD_TO_DEG,
        z: euler.z * RAD_TO_DEG,
      },
      scale: { x: scale.x, y: scale.y, z: scale.z },
    };
  }

  function getGlbNodeBounds(
    entityId: string,
    nodeUuid: string,
  ): { min: Vec3; max: Vec3 } | null {
    const entityGroup = objectsById.get(entityId);
    if (!entityGroup) return null;
    entityGroup.updateMatrixWorld(true);
    const node = findObjectByUuid(entityGroup, nodeUuid);
    if (!node) return null;
    const box = new THREE.Box3();
    let hasMesh = false;
    node.traverse((child) => {
      if (
        !(child instanceof THREE.Mesh) ||
        child.userData.editorMeshColliderHelper
      ) {
        return;
      }
      const geo = child.geometry;
      if (!geo.boundingBox) geo.computeBoundingBox();
      const meshBox = geo.boundingBox.clone();
      // Transform mesh-local bbox into the target node's local space
      const toNodeLocal = node.matrixWorld.clone().invert().multiply(child.matrixWorld);
      const corners = [
        new THREE.Vector3(meshBox.min.x, meshBox.min.y, meshBox.min.z),
        new THREE.Vector3(meshBox.max.x, meshBox.min.y, meshBox.min.z),
        new THREE.Vector3(meshBox.min.x, meshBox.max.y, meshBox.min.z),
        new THREE.Vector3(meshBox.max.x, meshBox.max.y, meshBox.min.z),
        new THREE.Vector3(meshBox.min.x, meshBox.min.y, meshBox.max.z),
        new THREE.Vector3(meshBox.max.x, meshBox.min.y, meshBox.max.z),
        new THREE.Vector3(meshBox.min.x, meshBox.max.y, meshBox.max.z),
        new THREE.Vector3(meshBox.max.x, meshBox.max.y, meshBox.max.z),
      ].map((v) => v.applyMatrix4(toNodeLocal));
      for (const c of corners) {
        if (!hasMesh) { box.min.copy(c); box.max.copy(c); hasMesh = true; }
        else box.expandByPoint(c);
      }
    });
    if (!hasMesh) return null;
    return {
      min: { x: box.min.x, y: box.min.y, z: box.min.z },
      max: { x: box.max.x, y: box.max.y, z: box.max.z },
    };
  }

  canvas.addEventListener("pointerdown", (event) => {
    if (event.button !== 0) return;
    pointerDownAt = { x: event.clientX, y: event.clientY };
  });

  canvas.addEventListener("pointerup", (event) => {
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
      drillDepth = 0;
      lastDrillEntityId = null;
      lastDrillScreen = null;
      store.clearSelection();
      return;
    }

    const { entityId, path } = pick;
    const modifierToggle = event.ctrlKey || event.metaKey;
    if (modifierToggle) {
      drillDepth = 0;
      lastDrillEntityId = entityId;
      lastDrillScreen = clickAt;
      store.setEntitySelection(entityId, 'toggle');
      return;
    }

    const sameEntity = entityId === lastDrillEntityId;
    const sameSpot =
      sameEntity &&
      lastDrillScreen !== null &&
      Math.hypot(clickAt.x - lastDrillScreen.x, clickAt.y - lastDrillScreen.y) <= 5;

    if (!sameSpot) {
      drillDepth = 0;
      lastDrillEntityId = entityId;
      lastDrillScreen = clickAt;
      store.setSelection(entityId);
      return;
    }

    drillDepth = Math.min(drillDepth + 1, path.length - 1);
    lastDrillScreen = clickAt;
    if (drillDepth <= 0) {
      store.setSelection(entityId);
      return;
    }
    store.setSubSelection(entityId, path[drillDepth].uuid);
  });

  // ---- gizmo <-> store ---------------------------------------------------

  let draggingEntityId: string | null = null;
  let draggingGlbNode: { entityId: string; nodeUuid: string } | null = null;

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
        const before = getGlbNodeLocalTransform(entityId, sub.nodeUuid);
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

  // ---- snapping ----------------------------------------------------------

  let snapEnabled = true;
  let snapTranslate = 0.25;
  let snapRotateDegrees = 15;
  let ctrlHeld = false;

  function applySnapState(): void {
    const active = snapEnabled !== ctrlHeld; // Ctrl temporarily inverts snapping
    gizmo.setTranslationSnap(active ? snapTranslate : null);
    gizmo.setRotationSnap(active ? snapRotateDegrees * DEG_TO_RAD : null);
    gizmo.setScaleSnap(active ? 0.1 : null);
  }
  applySnapState();

  function onKeyChange(event: KeyboardEvent): void {
    if (event.key === "Control" || event.ctrlKey !== ctrlHeld) {
      ctrlHeld =
        event.type === "keydown"
          ? event.ctrlKey || event.key === "Control"
          : event.ctrlKey;
      applySnapState();
    }
  }
  window.addEventListener("keydown", onKeyChange);
  window.addEventListener("keyup", onKeyChange);

  // ---- drag & drop placement ----------------------------------------------

  const dropPlane = new THREE.Plane(new THREE.Vector3(0, 1, 0), 0);
  const dropPoint = new THREE.Vector3();

  function dropPositionFromEvent(event: DragEvent): Vec3 {
    const rect = canvas.getBoundingClientRect();
    pointer.set(
      ((event.clientX - rect.left) / rect.width) * 2 - 1,
      -((event.clientY - rect.top) / rect.height) * 2 + 1,
    );
    raycaster.setFromCamera(pointer, camera);
    const hit = raycaster.ray.intersectPlane(dropPlane, dropPoint);
    if (!hit) {
      raycaster.ray.at(12, dropPoint);
    }
    const snap = snapEnabled ? snapTranslate : 0;
    const snapValue = (value: number) =>
      snap > 0 ? Math.round(value / snap) * snap : value;
    return {
      x: snapValue(dropPoint.x),
      y: Math.max(0, snapValue(dropPoint.y)),
      z: snapValue(dropPoint.z),
    };
  }

  container.addEventListener("dragover", (event) => {
    if (!event.dataTransfer) return;
    event.preventDefault();
    event.dataTransfer.dropEffect = "copy";
    container.classList.add("ed-drop-active");
  });
  container.addEventListener("dragleave", () =>
    container.classList.remove("ed-drop-active"),
  );
  container.addEventListener("drop", (event) => {
    container.classList.remove("ed-drop-active");
    const payload =
      event.dataTransfer?.getData("application/x-claudecitizen-asset") ||
      event.dataTransfer?.getData("text/plain");
    if (!payload) return;
    event.preventDefault();
    options.onDropAsset(payload, dropPositionFromEvent(event));
  });

  // ---- store subscription --------------------------------------------------

  const unsubscribe = store.subscribe((event) => {
    if (
      event.type === "structure" ||
      event.type === "document" ||
      event.type === "entity"
    ) {
      rebuildAll();
      return;
    }
    if (event.type === "transform") {
      const entity = store.locate(event.entityId)?.entity;
      const object = objectsById.get(event.entityId);
      if (entity && object && draggingEntityId !== event.entityId) {
        applyEntityTransformToObject(object, entity);
        entityRoot.userData.refreshObjectAnimationBase?.(object);
      }
      return;
    }
    if (event.type === "selection" || event.type === "sub-selection") {
      if (event.type === "selection") {
        drillDepth = 0;
        lastDrillEntityId = event.entityId;
      }
      syncSelectionHighlight();
      return;
    }
    if (event.type === "glb-transform") {
      const override = store.getGlbNodeOverride(
        event.entityId,
        event.nodeUuid,
      );
      if (override) {
        applyGlbOverrideToNode(event.entityId, event.nodeName, override);
      }
      return;
    }
    if (event.type === "glb-visibility") {
      applyHiddenNodesForEntity(event.entityId);
      return;
    }
    if (event.type === "history") {
      return;
    }
  });

  // ---- focus / resize / loop ------------------------------------------------

  function focusSelection(): void {
    const box = new THREE.Box3();
    const selectedIds = store.getSelectedIds();
    const sub = store.getSubSelection();

    if (sub && selectedIds.length <= 1) {
      const target = getGizmoTarget();
      if (target) {
        box.setFromObject(target);
      }
    } else if (selectedIds.length > 0) {
      let hasContent = false;
      for (const selectedId of selectedIds) {
        const object = objectsById.get(selectedId);
        if (!object) continue;
        box.expandByObject(object);
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

  function resize(): void {
    const width = Math.max(1, container.clientWidth);
    const height = Math.max(1, container.clientHeight);
    renderer.setSize(width, height, false);
    camera.aspect = width / height;
    camera.updateProjectionMatrix();
  }

  const resizeObserver = new ResizeObserver(resize);
  resizeObserver.observe(container);
  resize();

  let disposed = false;
  const frameClock = new THREE.Clock();
  function animate(): void {
    if (disposed) return;
    requestAnimationFrame(animate);
    const dt = Math.min(frameClock.getDelta(), 0.1);
    // OrbitControls.update() re-seats the camera from its own spherical state,
    // so it must not run while the flythrough owns the camera.
    if (flying) updateFly(dt);
    else orbit.update();
    selectionBoxes.forEach((box) => box.update());
    updateNpcRouteLines();
    for (const handles of particleHandles.values()) {
      for (const handle of handles) handle.update(dt, camera);
    }
    if (!draggingEntityId && !draggingGlbNode) {
      entityRoot.userData.updateObjectAnimations?.(dt);
    }
    renderer.render(scene, camera);
  }
  animate();

  rebuildAll();

  return {
    setGizmoMode(mode) {
      gizmo.setMode(mode);
    },
    setGizmoSpace(space) {
      gizmo.setSpace(space);
    },
    setSnap(enabled, translateStep, rotateStepDegrees) {
      snapEnabled = enabled;
      snapTranslate = Math.max(0.01, translateStep);
      snapRotateDegrees = Math.max(1, rotateStepDegrees);
      applySnapState();
    },
    setShipPreview(state) {
      shipPreview = state;
      applyShipPreview();
    },
    focusSelection,
    getGlbNodePrefabPosition,
    getGlbNodePrefabTransform,
    getGlbNodeBounds,
    getGlbNodeLocalTransform,
    setGlbNodeLocalTransform,
    isFlying: () => flying,
    particlePreview,
    dispose() {
      disposed = true;
      endFly();
      unsubscribe();
      disposeParticleHandles();
      window.removeEventListener("keydown", onKeyChange);
      window.removeEventListener("keyup", onKeyChange);
      window.removeEventListener("keydown", onFlyKey);
      window.removeEventListener("keyup", onFlyKey);
      document.removeEventListener("pointerlockchange", onPointerLockChange);
      resizeObserver.disconnect();
      gizmo.detach();
      gizmo.dispose();
      orbit.dispose();
      for (const resource of disposables) resource.dispose();
      renderer.dispose();
      canvas.remove();
    },
  };
}
