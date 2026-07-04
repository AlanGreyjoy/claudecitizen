import * as THREE from "three";
import { OrbitControls } from "three/examples/jsm/controls/OrbitControls";
import { TransformControls } from "three/examples/jsm/controls/TransformControls";
import {
  loadPrefabModel,
  createPrimitiveMesh,
} from "../prefabs/prefab_renderer";
import {
  BUILTIN_GEAR_HINGES,
  BUILTIN_RAMP_HINGE,
} from "../main/scene/ship_model";
import type { EditorEntity, EditorStore } from "../../editor/document";
import type { PrefabComponent } from "../../world/prefabs/schema";
import type { Vec3 } from "../../types";

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
  /** True while the RMB flythrough owns the camera (WASD is flying, not tool shortcuts). */
  isFlying: () => boolean;
  dispose: () => void;
}

const DEG_TO_RAD = Math.PI / 180;
const RAD_TO_DEG = 180 / Math.PI;

const FLOOR_COLORS: Record<string, number> = {
  hab: 0x8bd8ff,
  lobby: 0x3fc6ff,
  hangar: 0xffce6f,
};

const SHIP_ZONE_COLORS: Record<string, number> = {
  cabin: 0x3fc6ff,
  cockpit: 0x7dffa8,
  "cockpit-door": 0xffce6f,
  ramp: 0xff9d5c,
};

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

  const scene = new THREE.Scene();
  scene.background = new THREE.Color(0x0a101d);
  scene.fog = new THREE.Fog(0x0a101d, 260, 620);

  const camera = new THREE.PerspectiveCamera(60, 1, 0.05, 10_000);
  camera.position.set(20, 16, 20);

  scene.add(new THREE.HemisphereLight(0xbcd4ff, 0x1a2030, 1.15));
  const sun = new THREE.DirectionalLight(0xffffff, 2.1);
  sun.position.set(40, 60, 24);
  scene.add(sun);

  const grid = new THREE.GridHelper(400, 400, 0x33507a, 0x18243c);
  (grid.material as THREE.Material).transparent = true;
  (grid.material as THREE.Material).opacity = 0.6;
  scene.add(grid);
  scene.add(new THREE.AxesHelper(3));

  const entityRoot = new THREE.Group();
  entityRoot.name = "editor-entities";
  scene.add(entityRoot);

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

  canvas.addEventListener("contextmenu", (event) => event.preventDefault());
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

  function makeHelperMesh(
    geometry: THREE.BufferGeometry,
    color: number,
    opacity: number,
    wireframe = false,
  ): THREE.Mesh {
    const material = track(
      new THREE.MeshBasicMaterial({
        color,
        transparent: true,
        opacity,
        wireframe,
        depthWrite: false,
      }),
    );
    const mesh = new THREE.Mesh(track(geometry), material);
    mesh.frustumCulled = false;
    return mesh;
  }

  /** XZ box outline + translucent fill, origin-relative (used by zones and mounts). */
  function makeZoneBoxHelper(
    min: { x: number; z: number },
    max: { x: number; z: number },
    height: number,
    color: number,
    baseY = 0,
  ): THREE.Group {
    const width = Math.max(0.01, max.x - min.x);
    const depth = Math.max(0.01, max.z - min.z);
    const group = new THREE.Group();
    const fill = makeHelperMesh(
      new THREE.BoxGeometry(width, height, depth),
      color,
      0.07,
    );
    const wire = makeHelperMesh(
      new THREE.BoxGeometry(width, height, depth),
      color,
      0.4,
      true,
    );
    fill.position.set(
      (min.x + max.x) / 2,
      baseY + height / 2,
      (min.z + max.z) / 2,
    );
    wire.position.copy(fill.position);
    group.add(fill, wire);
    return group;
  }

  function buildComponentHelper(
    component: PrefabComponent,
  ): THREE.Object3D | null {
    switch (component.type) {
      case "walk-volume": {
        const color = FLOOR_COLORS[component.floorId] ?? 0x3fc6ff;
        return makeZoneBoxHelper(
          component.min,
          component.max,
          component.height ?? 4,
          color,
        );
      }
      case "spawn-point": {
        const group = new THREE.Group();
        const cone = makeHelperMesh(
          new THREE.ConeGeometry(0.35, 1.4, 12),
          0x7dffa8,
          0.8,
        );
        cone.position.y = 0.7;
        const disc = makeHelperMesh(
          new THREE.CylinderGeometry(0.7, 0.7, 0.05, 20),
          0x7dffa8,
          0.3,
        );
        group.add(cone, disc);
        return group;
      }
      case "elevator": {
        const group = new THREE.Group();
        const pad = makeHelperMesh(
          new THREE.CylinderGeometry(0.9, 0.9, 0.18, 20),
          0x3fc6ff,
          0.55,
        );
        pad.position.y = 0.09;
        const beam = makeHelperMesh(
          new THREE.CylinderGeometry(0.12, 0.12, 3.2, 8),
          0x3fc6ff,
          0.3,
        );
        beam.position.y = 1.6;
        group.add(pad, beam);
        return group;
      }
      case "hangar-pad": {
        const group = new THREE.Group();
        // HANGAR_PAD_HALF_METERS in gameplay is 8m — visualize the landing square.
        const outline = makeHelperMesh(
          new THREE.BoxGeometry(16, 0.25, 16),
          0xffce6f,
          0.35,
          true,
        );
        const marker = makeHelperMesh(
          new THREE.CylinderGeometry(1.4, 1.4, 0.2, 24),
          0xffce6f,
          0.55,
        );
        marker.position.y = 0.1;
        group.add(outline, marker);
        return group;
      }
      case "interaction": {
        const sphere = makeHelperMesh(
          new THREE.SphereGeometry(component.radius, 16, 12),
          0xffce6f,
          0.28,
          true,
        );
        return sphere;
      }
      case "collider": {
        const size = component.size;
        const box = makeHelperMesh(
          new THREE.BoxGeometry(size.x, size.y, size.z),
          0xff7d7d,
          0.4,
          true,
        );
        const offset = component.offset;
        if (offset) box.position.set(offset.x, offset.y, offset.z);
        return box;
      }
      case "station-frame":
      case "ship-frame": {
        return new THREE.AxesHelper(2);
      }
      case "ship-hull": {
        // Subtle marker only — the hull is the entity's own model.
        const ring = makeHelperMesh(
          new THREE.TorusGeometry(1.2, 0.05, 8, 32),
          0x8bd8ff,
          0.5,
        );
        ring.rotation.x = Math.PI / 2;
        return ring;
      }
      case "ship-walk-zone": {
        const color = SHIP_ZONE_COLORS[component.zoneId] ?? 0x9d8bff;
        const group = makeZoneBoxHelper(
          component.min,
          component.max,
          component.height ?? 3.1,
          color,
        );
        if (component.slopeMinUp !== undefined && component.slopeMinUp !== 0) {
          // Slope indicator: line from the min-Z edge (offset floor) to max-Z edge.
          const geometry = track(new THREE.BufferGeometry());
          geometry.setFromPoints([
            new THREE.Vector3(
              (component.min.x + component.max.x) / 2,
              component.slopeMinUp,
              component.min.z,
            ),
            new THREE.Vector3(
              (component.min.x + component.max.x) / 2,
              0,
              component.max.z,
            ),
          ]);
          const material = track(
            new THREE.LineBasicMaterial({
              color,
              transparent: true,
              opacity: 0.85,
            }),
          );
          group.add(new THREE.Line(geometry, material));
        }
        return group;
      }
      case "ship-stairs": {
        const isLadder = component.variant === "ladder";
        const color = isLadder
          ? (SHIP_ZONE_COLORS[component.zoneId] ?? 0xff8c42)
          : (SHIP_ZONE_COLORS[component.zoneId] ?? 0xffa86b);
        const rise = component.riseUp;
        const headroom = component.height ?? 3.1;
        const spanZ = component.max.z - component.min.z;
        const spanX = component.max.x - component.min.x;
        const centerZ = (component.min.z + component.max.z) / 2;
        const midX = (component.min.x + component.max.x) / 2;

        if (isLadder) {
          const group = new THREE.Group();
          const climbDepth = Math.min(spanZ, 0.35);
          const climbMin = { x: component.min.x, z: centerZ - climbDepth / 2 };
          const climbMax = { x: component.max.x, z: centerZ + climbDepth / 2 };
          group.add(makeZoneBoxHelper(climbMin, climbMax, rise, color));
          if (headroom > 0.05) {
            const headroomGroup = makeZoneBoxHelper(
              component.min,
              component.max,
              headroom,
              color,
              rise,
            );
            headroomGroup.traverse((child) => {
              if (
                child instanceof THREE.Mesh &&
                child.material instanceof THREE.MeshBasicMaterial
              ) {
                child.material.opacity *= 0.35;
              }
            });
            group.add(headroomGroup);
          }
          const rungs = Math.max(4, Math.round(rise / 0.3));
          const railThickness = 0.08;
          for (const railX of [component.min.x, component.max.x]) {
            const rail = makeHelperMesh(
              new THREE.BoxGeometry(railThickness, rise, railThickness),
              color,
              0.75,
            );
            rail.position.set(railX, rise / 2, centerZ);
            group.add(rail);
          }
          for (let rung = 0; rung <= rungs; rung += 1) {
            const y = (rung / rungs) * rise;
            const rungMesh = makeHelperMesh(
              new THREE.BoxGeometry(spanX, 0.06, 0.1),
              color,
              0.7,
            );
            rungMesh.position.set(midX, y, centerZ);
            group.add(rungMesh);
          }
          return group;
        }

        const group = makeZoneBoxHelper(
          component.min,
          component.max,
          headroom + rise,
          color,
        );
        group.position.y = rise / 2;
        const steps = component.stepCount ?? 4;
        for (let step = 0; step <= steps; step += 1) {
          const t = step / steps;
          const z = component.min.z + spanZ * t;
          const y = rise * t;
          const tread = makeHelperMesh(
            new THREE.BoxGeometry(spanX, 0.04, 0.18),
            color,
            0.55,
          );
          tread.position.set(midX, y, z);
          group.add(tread);
        }
        return group;
      }
      case "ship-door": {
        const group = new THREE.Group();
        const sphere = makeHelperMesh(
          new THREE.SphereGeometry(component.radius ?? 1.6, 16, 12),
          0xffce6f,
          0.24,
          true,
        );
        const panel = makeHelperMesh(
          new THREE.BoxGeometry(1.2, 1.8, 0.08),
          0xffce6f,
          0.4,
        );
        panel.position.y = 0.9;
        group.add(sphere, panel);
        return group;
      }
      case "pilot-seat": {
        const group = new THREE.Group();
        const role = component.role ?? "passenger";
        const seatColor =
          role === "pilot"
            ? 0x7dffa8
            : role === "copilot"
              ? 0x7db8ff
              : role === "turret"
                ? 0xff9d5c
                : 0x9aa3b8;
        const seat = makeHelperMesh(
          new THREE.BoxGeometry(0.6, 0.12, 0.6),
          seatColor,
          0.6,
        );
        const back = makeHelperMesh(
          new THREE.BoxGeometry(0.6, 0.8, 0.12),
          seatColor,
          0.45,
        );
        back.position.set(0, 0.45, -0.3);
        const eye = component.eye ?? { x: 0, y: 0.87, z: 0.25 };
        const eyeDot = makeHelperMesh(
          new THREE.SphereGeometry(0.08, 10, 8),
          0xffffff,
          0.85,
        );
        eyeDot.position.set(eye.x, eye.y, eye.z);
        const stand = component.stand ?? { x: 0, z: -1.55 };
        const standDot = makeHelperMesh(
          new THREE.SphereGeometry(0.1, 10, 8),
          0xffce6f,
          0.7,
        );
        standDot.position.set(stand.x, 0.05, stand.z);
        const radius = component.interactRadius ?? 1.45;
        const reach = makeHelperMesh(
          new THREE.SphereGeometry(radius, 16, 12),
          seatColor,
          0.12,
          true,
        );
        reach.position.set(stand.x, 0.5, stand.z);
        group.add(seat, back, eyeDot, standDot, reach);
        return group;
      }
      case "ramp-interact": {
        const color = component.placement === "outside" ? 0xff9d5c : 0xffce6f;
        const radius =
          component.radius ?? (component.placement === "outside" ? 3 : 1.7);
        return makeHelperMesh(
          new THREE.SphereGeometry(radius, 16, 12),
          color,
          0.22,
          true,
        );
      }
      case "ramp-mount": {
        return makeZoneBoxHelper(component.min, component.max, 0.4, 0xff9d5c);
      }
      case "ship-stats":
      case "ship-gear":
      case "ship-ramp":
        return null;
    }
    return null;
  }

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
      const mesh = createPrimitiveMesh(entity.primitive);
      track(mesh.geometry);
      track(mesh.material as THREE.Material);
      group.add(mesh);
      hasVisual = true;
    }
    if (entity.asset) {
      hasVisual = true;
      const url = entity.asset.url;
      // The game recenters the flyable hull on its bounding-box center
      // (ship_model.ts), so mirror that here or zones drift from the mesh.
      const recenterAsHull = entity.components.some(
        (component) => component.type === "ship-hull",
      );
      void loadPrefabModel(url)
        .then((model) => {
          if (generation !== buildGeneration) return;
          if (recenterAsHull) {
            const box = new THREE.Box3().setFromObject(model);
            model.position.sub(box.getCenter(new THREE.Vector3()));
          }
          group.add(model);
          applyShipPreview();
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
          console.warn(`Editor: asset failed to load: ${url}`);
        });
    }

    for (const component of entity.components) {
      const helper = buildComponentHelper(component);
      if (helper) {
        group.add(helper);
        hasVisual = true;
      }
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
    const selectedId = store.getSelection();
    gizmo.detach();
    entityRoot.clear();
    objectsById.clear();
    for (const resource of disposables) resource.dispose();
    disposables.length = 0;

    for (const entity of store.getState().roots) {
      entityRoot.add(buildEntityObject(entity, buildGeneration));
    }
    if (selectedId) attachSelection(selectedId);
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
  ): void {
    const object = entityRoot.getObjectByName(name);
    if (!object) return;
    const base = baseOf(object);
    previewQuat.setFromAxisAngle(PREVIEW_AXES[axis], radians);
    object.quaternion.copy(base.quaternion).multiply(previewQuat);
  }

  function previewSlide(
    name: string,
    offset: number,
    axis: "x" | "y" | "z",
  ): void {
    const object = entityRoot.getObjectByName(name);
    if (!object) return;
    const base = baseOf(object);
    previewAxis.copy(PREVIEW_AXES[axis]).multiplyScalar(offset);
    object.position.copy(base.position).add(previewAxis);
  }

  function collectDoorComponents(): Extract<
    PrefabComponent,
    { type: "ship-door" }
  >[] {
    const doors: Extract<PrefabComponent, { type: "ship-door" }>[] = [];
    const visit = (entities: EditorEntity[]): void => {
      for (const entity of entities) {
        for (const component of entity.components) {
          if (component.type === "ship-door") doors.push(component);
        }
        visit(entity.children);
      }
    };
    visit(store.getState().roots);
    return doors;
  }

  function applyShipPreview(): void {
    if (store.getState().kind !== "ship") return;
    const gear01 = shipPreview.gearDown ? 1 : 0;
    for (const hinge of BUILTIN_GEAR_HINGES) {
      previewHinge(hinge.name, hinge.deployRadians * gear01);
    }
    previewHinge(
      BUILTIN_RAMP_HINGE.name,
      BUILTIN_RAMP_HINGE.lowerRadians * (shipPreview.rampDown ? 1 : 0),
    );
    for (const door of collectDoorComponents()) {
      const open = shipPreview.doorsOpen[door.id] ?? door.defaultOpen ?? false;
      const open01 = open ? 1 : 0;
      for (const node of door.nodes) {
        if (door.motion === "slide")
          previewSlide(node.name, node.delta * open01, door.axis);
        else previewHinge(node.name, node.delta * open01, door.axis);
      }
    }
  }

  // ---- selection ---------------------------------------------------------

  let selectionBox: THREE.BoxHelper | null = null;

  function attachSelection(entityId: string | null): void {
    gizmo.detach();
    if (selectionBox) {
      scene.remove(selectionBox);
      selectionBox.geometry.dispose();
      (selectionBox.material as THREE.Material).dispose();
      selectionBox = null;
    }
    if (!entityId) return;
    const object = objectsById.get(entityId);
    if (!object) return;
    gizmo.attach(object);
    selectionBox = new THREE.BoxHelper(object, 0x8bd8ff);
    scene.add(selectionBox);
  }

  const raycaster = new THREE.Raycaster();
  const pointer = new THREE.Vector2();
  let pointerDownAt: { x: number; y: number } | null = null;

  function entityIdFromObject(object: THREE.Object3D): string | null {
    let current: THREE.Object3D | null = object;
    while (current) {
      const id = current.userData.entityId as string | undefined;
      if (id) return id;
      current = current.parent;
    }
    return null;
  }

  function pickEntity(clientX: number, clientY: number): string | null {
    const rect = canvas.getBoundingClientRect();
    pointer.set(
      ((clientX - rect.left) / rect.width) * 2 - 1,
      -((clientY - rect.top) / rect.height) * 2 + 1,
    );
    raycaster.setFromCamera(pointer, camera);
    const hits = raycaster.intersectObjects(entityRoot.children, true);
    for (const hit of hits) {
      if (!hit.object.visible) continue;
      const id = entityIdFromObject(hit.object);
      if (id) return id;
    }
    return null;
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
    pointerDownAt = null;
    if (moved > 5) return;
    if (gizmo.axis) return; // click consumed by the gizmo
    store.setSelection(pickEntity(event.clientX, event.clientY));
  });

  // ---- gizmo <-> store ---------------------------------------------------

  let draggingEntityId: string | null = null;

  gizmo.addEventListener("dragging-changed", (event) => {
    const dragging = Boolean((event as unknown as { value: boolean }).value);
    orbit.enabled = !dragging;
    if (dragging) {
      draggingEntityId = store.getSelection();
      if (draggingEntityId) store.beginTransformGesture(draggingEntityId);
    } else {
      store.endTransformGesture();
      draggingEntityId = null;
    }
  });

  gizmo.addEventListener("objectChange", () => {
    const object = gizmo.object;
    if (!object || !draggingEntityId) return;
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
      }
      return;
    }
    if (event.type === "selection") {
      attachSelection(event.entityId);
    }
  });

  // ---- focus / resize / loop ------------------------------------------------

  function focusSelection(): void {
    const selectedId = store.getSelection();
    const target = selectedId ? objectsById.get(selectedId) : null;
    const box = new THREE.Box3();
    if (target) {
      box.setFromObject(target);
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
    selectionBox?.update();
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
    isFlying: () => flying,
    dispose() {
      disposed = true;
      endFly();
      unsubscribe();
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
