import * as THREE from "three";
import { createPrefabLightObject } from "../prefabs/prefab_renderer";
import { createParticleShapeHelper } from "../particles";
import type { PrefabComponent } from "../../world/prefabs/schema";

export type ViewportResourceTracker = <T extends { dispose: () => void }>(
  resource: T,
) => T;

export interface ViewportComponentHelpers {
  makeHelperMesh: (
    geometry: THREE.BufferGeometry,
    color: number,
    opacity: number,
    wireframe?: boolean,
  ) => THREE.Mesh;
  makeRestHeightHelper: (
    restHeightMeters: number,
    options?: { auto?: boolean; radius?: number },
  ) => THREE.Group;
  clearRestHeightHelpers: (parent: THREE.Object3D) => void;
  makeMeshColliderHelper: (
    target: THREE.Object3D,
    component: Extract<PrefabComponent, { type: "collider"; shape: "mesh" }>,
  ) => THREE.Object3D | null;
  buildComponentHelper: (
    component: PrefabComponent,
    meshColliderTarget?: THREE.Object3D,
  ) => THREE.Object3D | null;
}

export function createViewportComponentHelpers(
  track: ViewportResourceTracker,
): ViewportComponentHelpers {
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

  /**
   * Parked rest-height debug gizmo: ship origin → pad plane at local Y = -restHeight.
   * Gear tips / belly should meet the disc when the ship is parked.
   */
  function makeRestHeightHelper(
    restHeightMeters: number,
    options?: { auto?: boolean; radius?: number },
  ): THREE.Group {
    const height = Math.max(0.05, restHeightMeters);
    const auto = options?.auto ?? false;
    const radius = options?.radius ?? Math.max(6, Math.min(24, height * 1.5));
    const color = auto ? 0xffce6f : 0x5ec8ff;
    const group = new THREE.Group();
    group.userData.editorRestHeightHelper = true;

    const pad = makeHelperMesh(
      new THREE.CylinderGeometry(radius, radius, 0.06, 48),
      color,
      auto ? 0.16 : 0.2,
    );
    pad.position.y = -height;
    const padWire = makeHelperMesh(
      new THREE.CylinderGeometry(radius, radius, 0.06, 48),
      color,
      auto ? 0.4 : 0.55,
      true,
    );
    padWire.position.y = -height;

    const ring = makeHelperMesh(
      new THREE.TorusGeometry(Math.max(0.5, radius * 0.92), 0.045, 8, 48),
      color,
      0.75,
    );
    ring.rotation.x = Math.PI / 2;
    ring.position.y = -height + 0.04;

    const lineMaterial = track(
      auto
        ? new THREE.LineDashedMaterial({
            color,
            dashSize: 0.45,
            gapSize: 0.28,
            transparent: true,
            opacity: 0.7,
            depthWrite: false,
          })
        : new THREE.LineBasicMaterial({
            color,
            transparent: true,
            opacity: 0.95,
            depthWrite: false,
          }),
    );
    const stemGeometry = track(new THREE.BufferGeometry());
    stemGeometry.setFromPoints([
      new THREE.Vector3(0, 0, 0),
      new THREE.Vector3(0, -height, 0),
    ]);
    const stem = new THREE.Line(stemGeometry, lineMaterial);
    if (auto) stem.computeLineDistances();

    const crossGeometry = track(new THREE.BufferGeometry());
    const arm = radius * 0.85;
    crossGeometry.setFromPoints([
      new THREE.Vector3(-arm, -height, 0),
      new THREE.Vector3(arm, -height, 0),
      new THREE.Vector3(0, -height, -arm),
      new THREE.Vector3(0, -height, arm),
    ]);
    const cross = new THREE.LineSegments(crossGeometry, lineMaterial);
    if (auto) cross.computeLineDistances();

    const origin = makeHelperMesh(
      new THREE.SphereGeometry(0.18, 12, 10),
      color,
      0.92,
    );
    const contact = makeHelperMesh(
      new THREE.SphereGeometry(0.14, 10, 8),
      color,
      0.88,
    );
    contact.position.y = -height;

    group.add(pad, padWire, ring, stem, cross, origin, contact);
    return group;
  }

  function clearRestHeightHelpers(parent: THREE.Object3D): void {
    for (const child of [...parent.children]) {
      if (child.userData.editorRestHeightHelper) parent.remove(child);
    }
  }

  function makeMeshColliderHelper(
    target: THREE.Object3D,
    component: Extract<PrefabComponent, { type: "collider"; shape: "mesh" }>,
  ): THREE.Object3D | null {
    target.updateWorldMatrix(true, true);
    const targetWorldInverse = target.matrixWorld.clone().invert();
    const group = new THREE.Group();
    group.userData.editorMeshColliderHelper = true;

    target.traverse((child) => {
      if (
        !(child instanceof THREE.Mesh) ||
        child.userData.editorMeshColliderHelper
      ) {
        return;
      }
      const toTargetLocal = targetWorldInverse.clone().multiply(child.matrixWorld);
      const geometry = child.geometry.clone().applyMatrix4(toTargetLocal);
      const helper = makeHelperMesh(
        geometry,
        component.convex ? 0xffb36b : 0xff7d7d,
        component.convex ? 0.24 : 0.34,
        true,
      );
      helper.userData.editorMeshColliderHelper = true;
      group.add(helper);
    });

    if (group.children.length === 0) return null;
    const offset = component.offset;
    if (offset) group.position.set(offset.x, offset.y, offset.z);
    return group;
  }

  /** Compact bulb marker — always visible so unselected lights stay pickable. */
  function makeLightBulbIcon(color: number): THREE.Group {
    const icon = new THREE.Group();
    icon.userData.editorLightBulbIcon = true;
    const glass = makeHelperMesh(
      new THREE.SphereGeometry(0.15, 14, 12),
      color,
      0.92,
    );
    glass.position.y = 0.08;
    const neck = makeHelperMesh(
      new THREE.CylinderGeometry(0.05, 0.07, 0.08, 10),
      color,
      0.88,
    );
    neck.position.y = -0.08;
    const base = makeHelperMesh(
      new THREE.CylinderGeometry(0.085, 0.095, 0.11, 10),
      color,
      0.8,
    );
    base.position.y = -0.17;
    icon.add(glass, neck, base);
    return icon;
  }

  /** Volume/range gizmo — only shown while the light entity is selected. */
  function tagLightRangeHelper(object: THREE.Object3D): THREE.Object3D {
    object.userData.editorLightRangeHelper = true;
    object.visible = false;
    // Never steal picks from scene content; the bulb icon is the hit target.
    object.traverse((child) => {
      child.raycast = () => {};
    });
    return object;
  }

  function buildPointLightHelper(
    component: Extract<PrefabComponent, { type: "point-light" }>,
  ): THREE.Object3D | null {
    const color = new THREE.Color(component.color ?? "#dfeaff").getHex();
    const group = new THREE.Group();
    group.add(createPrefabLightObject(component));
    group.add(makeLightBulbIcon(color));
    const radius = component.distance > 0 ? component.distance : 2;
    const reach = tagLightRangeHelper(
      makeHelperMesh(new THREE.SphereGeometry(radius, 24, 12), color, 0.12, true),
    );
    group.add(reach);
    return group;
  }
  function buildAreaLightHelper(
    component: Extract<PrefabComponent, { type: "area-light" }>,
  ): THREE.Object3D | null {
    const color = new THREE.Color(component.color ?? "#cfe8ff").getHex();
    const group = new THREE.Group();
    group.add(createPrefabLightObject(component));
    // Area lights already have a compact panel; keep a bulb for consistency.
    group.add(makeLightBulbIcon(color));
    const panel = makeHelperMesh(
      new THREE.BoxGeometry(component.width, component.height, 0.035),
      color,
      0.32,
    );
    const outline = makeHelperMesh(
      new THREE.BoxGeometry(component.width, component.height, 0.04),
      color,
      0.7,
      true,
    );
    const directionGeometry = track(new THREE.BufferGeometry());
    directionGeometry.setFromPoints([
      new THREE.Vector3(0, 0, 0),
      new THREE.Vector3(0, 0, -Math.max(0.75, component.height * 1.5)),
    ]);
    const directionMaterial = track(
      new THREE.LineBasicMaterial({
        color,
        transparent: true,
        opacity: 0.85,
      }),
    );
    const shape = tagLightRangeHelper(new THREE.Group());
    shape.add(
      panel,
      outline,
      new THREE.Line(directionGeometry, directionMaterial),
    );
    group.add(shape);
    return group;
  }
  function buildSpotLightHelper(
    component: Extract<PrefabComponent, { type: "spot-light" }>,
  ): THREE.Object3D | null {
    const color = new THREE.Color(component.color ?? "#dfeaff").getHex();
    const group = new THREE.Group();
    group.add(createPrefabLightObject(component));
    group.add(makeLightBulbIcon(color));
    const angle = THREE.MathUtils.degToRad(component.angle ?? 45);
    const range = component.distance > 0 ? component.distance : 24;
    const coneGeometry = track(
      new THREE.ConeGeometry(Math.tan(angle) * range, range, 24, 1, true),
    );
    coneGeometry.translate(0, -range / 2, 0);
    coneGeometry.rotateX(-Math.PI / 2);
    const cone = tagLightRangeHelper(
      makeHelperMesh(coneGeometry, color, 0.14, true),
    );
    group.add(cone);
    return group;
  }
  function buildSoundHelper(
    component: Extract<PrefabComponent, { type: "sound" }>,
  ): THREE.Object3D | null {
    const color = component.mode === "spatial" ? 0xd58cff : 0x65d8ff;
    const group = new THREE.Group();
    const speaker = makeHelperMesh(
    new THREE.SphereGeometry(0.18, 14, 10),
    color,
    0.88,
    );
    const cone = makeHelperMesh(
    new THREE.ConeGeometry(0.24, 0.42, 14),
    color,
    0.68,
    );
    cone.rotation.z = -Math.PI / 2;
    cone.position.x = 0.28;
    const zone =
    component.zone.shape === "sphere"
    ? makeHelperMesh(
    new THREE.SphereGeometry(component.zone.radius, 24, 16),
    color,
    0.16,
    true,
    )
    : makeHelperMesh(
    new THREE.BoxGeometry(
    component.zone.size.x,
    component.zone.size.y,
    component.zone.size.z,
    ),
    color,
    0.16,
    true,
    );
    group.add(speaker, cone, zone);
    return group;
  }
  function buildParticleSystemHelper(
    component: Extract<PrefabComponent, { type: "particle-system" }>,
  ): THREE.Object3D | null {
    const group = new THREE.Group();
    group.add(createParticleShapeHelper(component.shape));
    return group;
  }
  function buildSpawnPointHelper(
    component: Extract<PrefabComponent, { type: "spawn-point" }>,
  ): THREE.Object3D | null {
void component;
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
  function buildNpcSpawnerHelper(
    component: Extract<PrefabComponent, { type: "npc-spawner" }>,
  ): THREE.Object3D | null {
    const group = new THREE.Group();
    const color = 0x7de7ff;
    const radius = Math.max(0.15, component.radius);
    const zone = makeHelperMesh(
    new THREE.CylinderGeometry(radius, radius, 0.05, 32),
    color,
    0.18,
    true,
    );
    zone.position.y = 0.025;
    const body = makeHelperMesh(
    new THREE.CapsuleGeometry(0.22, 0.75, 5, 10),
    color,
    0.72,
    );
    body.position.y = 0.7;
    const head = makeHelperMesh(
    new THREE.SphereGeometry(0.25, 14, 10),
    color,
    0.88,
    );
    head.position.y = 1.55;
    group.add(zone, body, head);
    return group;
  }
  function buildNpcWaypointHelper(
    component: Extract<PrefabComponent, { type: "npc-waypoint" }>,
  ): THREE.Object3D | null {
void component;
    const group = new THREE.Group();
    const color = 0xc39bff;
    const node = makeHelperMesh(
    new THREE.OctahedronGeometry(0.28),
    color,
    0.86,
    );
    node.position.y = 0.28;
    const stemGeometry = track(new THREE.BufferGeometry());
    stemGeometry.setFromPoints([
    new THREE.Vector3(0, 0, 0),
    new THREE.Vector3(0, 0.28, 0),
    ]);
    const stemMaterial = track(
    new THREE.LineBasicMaterial({
    color,
    transparent: true,
    opacity: 0.82,
    depthWrite: false,
    }),
    );
    group.add(node, new THREE.Line(stemGeometry, stemMaterial));
    return group;
  }
  function buildNpcPlacementHelper(
    component: Extract<PrefabComponent, { type: "npc-placement" }>,
  ): THREE.Object3D | null {
    const group = new THREE.Group();
    const color = component.behavior === "stationary" ? 0xffd37d : 0xffa97d;
    const body = makeHelperMesh(
    new THREE.CapsuleGeometry(0.24, 0.82, 5, 10),
    color,
    0.72,
    );
    body.position.y = 0.72;
    const head = makeHelperMesh(
    new THREE.SphereGeometry(0.27, 14, 10),
    color,
    0.9,
    );
    head.position.y = 1.62;
    const facingGeometry = track(new THREE.BufferGeometry());
    facingGeometry.setFromPoints([
    new THREE.Vector3(0, 0.04, 0),
    new THREE.Vector3(0, 0.04, 0.9),
    ]);
    const facingMaterial = track(
    new THREE.LineBasicMaterial({
    color,
    transparent: true,
    opacity: 0.88,
    depthWrite: false,
    }),
    );
    group.add(body, head, new THREE.Line(facingGeometry, facingMaterial));
    return group;
  }
  function buildElevatorHelper(
    component: Extract<PrefabComponent, { type: "elevator" }>,
  ): THREE.Object3D | null {
void component;
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
  function buildHangarPadHelper(
    component: Extract<PrefabComponent, { type: "hangar-pad" }>,
  ): THREE.Object3D | null {
void component;
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
  function buildInteractionHelper(
    component: Extract<PrefabComponent, { type: "interaction" }>,
  ): THREE.Object3D | null {
    const sphere = makeHelperMesh(
    new THREE.SphereGeometry(component.radius, 16, 12),
    0xffce6f,
    0.28,
    true,
    );
    return sphere;
  }
  function buildColliderHelper(
    component: Extract<PrefabComponent, { type: "collider" }>,
    meshColliderTarget?: THREE.Object3D,
  ): THREE.Object3D | null {
    if (component.shape === "mesh") {
      if (meshColliderTarget) {
        return makeMeshColliderHelper(meshColliderTarget, component);
      }
      const group = new THREE.Group();
      const geometry = component.convex
        ? new THREE.IcosahedronGeometry(0.7, 1)
        : new THREE.BoxGeometry(1.2, 1.2, 1.2);
      const helper = makeHelperMesh(
        geometry,
        component.convex ? 0xffb36b : 0xff7d7d,
        component.convex ? 0.24 : 0.34,
        true,
      );
      const offset = component.offset;
      if (offset) helper.position.set(offset.x, offset.y, offset.z);
      group.add(helper);
      return group;
    }
    if (component.shape !== "box") return null;
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
  function buildFrameAxesHelper(): THREE.Object3D | null {
    return new THREE.AxesHelper(2);
  }
  function buildShipHullHelper(
    component: Extract<PrefabComponent, { type: "ship-hull" }>,
  ): THREE.Object3D | null {
void component;
    // Subtle marker only — the hull is the entity's own model.
    // Rest-height pad is attached after the GLB loads (see recenterAsHull).
    const ring = makeHelperMesh(
    new THREE.TorusGeometry(1.2, 0.05, 8, 32),
    0x8bd8ff,
    0.5,
    );
    ring.rotation.x = Math.PI / 2;
    return ring;
  }
  function buildShipDoorHelper(
    component: Extract<PrefabComponent, { type: "ship-door" }>,
  ): THREE.Object3D | null {
    const group = new THREE.Group();
    const radius = component.radius ?? 1.6;
    const raycast = (component.trigger ?? "radial") === "raycast";
    const sphere = makeHelperMesh(
    new THREE.SphereGeometry(radius, 16, 12),
    raycast ? 0x7db8ff : 0xffce6f,
    raycast ? 0.14 : 0.24,
    true,
    );
    if (raycast) {
    const aim = makeHelperMesh(
    new THREE.SphereGeometry(component.aimRadius ?? 0.35, 12, 10),
    0x7db8ff,
    0.45,
    true,
    );
    group.add(aim);
    }
    const panel = makeHelperMesh(
    new THREE.BoxGeometry(1.2, 1.8, 0.08),
    raycast ? 0x7db8ff : 0xffce6f,
    0.4,
    );
    panel.position.y = 0.9;
    group.add(sphere, panel);
    return group;
  }
  function buildPilotSeatHelper(
    component: Extract<PrefabComponent, { type: "pilot-seat" }>,
  ): THREE.Object3D | null {
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
  function buildBedHelper(
    component: Extract<PrefabComponent, { type: "bed" }>,
  ): THREE.Object3D | null {
    const group = new THREE.Group();
    const bedColor = 0xb88cff;
    const mattress = makeHelperMesh(
    new THREE.BoxGeometry(0.9, 0.12, 2.0),
    bedColor,
    0.55,
    );
    mattress.position.y = 0.06;
    const eye = component.eye ?? { x: 0, y: 0.3, z: 0.15 };
    const eyeDot = makeHelperMesh(
    new THREE.SphereGeometry(0.08, 10, 8),
    0xffffff,
    0.85,
    );
    eyeDot.position.set(eye.x, eye.y, eye.z);
    const stand = component.stand ?? { x: -0.9, z: 0 };
    const standDot = makeHelperMesh(
    new THREE.SphereGeometry(0.1, 10, 8),
    0xffce6f,
    0.7,
    );
    standDot.position.set(stand.x, 0.05, stand.z);
    const radius = component.radius ?? 1.6;
    const raycast = (component.trigger ?? "radial") === "raycast";
    const reach = makeHelperMesh(
    new THREE.SphereGeometry(radius, 16, 12),
    raycast ? 0x7db8ff : bedColor,
    raycast ? 0.14 : 0.12,
    true,
    );
    if (raycast) {
    const aim = makeHelperMesh(
    new THREE.SphereGeometry(component.aimRadius ?? 0.35, 12, 10),
    0x7db8ff,
    0.45,
    true,
    );
    group.add(aim);
    }
    group.add(mattress, eyeDot, standDot, reach);
    return group;
  }
  function buildRampInteractHelper(
    component: Extract<PrefabComponent, { type: "ramp-interact" }>,
  ): THREE.Object3D | null {
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
  function buildCockpitControlHelper(
    component: Extract<PrefabComponent, { type: "cockpit-control" }>,
  ): THREE.Object3D | null {
    const group = new THREE.Group();
    const color =
    component.action === "landing-gear" ? 0x7dffa8 : 0xffce6f;
    const radius = component.gazeRadius ?? 0.2;
    const sphere = makeHelperMesh(
    new THREE.SphereGeometry(radius, 12, 10),
    color,
    0.35,
    true,
    );
    const core = makeHelperMesh(
    new THREE.SphereGeometry(0.06, 10, 8),
    color,
    0.9,
    );
    group.add(sphere, core);
    return group;
  }
  function buildCockpitStatHelper(
    component: Extract<PrefabComponent, { type: "cockpit-stat" }>,
  ): THREE.Object3D | null {
void component;
    const group = new THREE.Group();
    const color = 0x6fc8ff;
    const sphere = makeHelperMesh(
    new THREE.SphereGeometry(0.18, 12, 10),
    color,
    0.3,
    true,
    );
    const core = makeHelperMesh(
    new THREE.BoxGeometry(0.22, 0.1, 0.04),
    color,
    0.85,
    );
    group.add(sphere, core);
    return group;
  }
  function buildEntertainmentSystemHelper(
    component: Extract<PrefabComponent, { type: "entertainment-system" }>,
  ): THREE.Object3D | null {
    const group = new THREE.Group();
    const color = 0xb48cff;
    const radius = component.gazeRadius ?? 0.35;
    const sphere = makeHelperMesh(
    new THREE.SphereGeometry(radius, 12, 10),
    color,
    0.28,
    true,
    );
    const w = component.screenWidth ?? 0.55;
    const h = component.screenHeight ?? 0.32;
    const screen = makeHelperMesh(
    new THREE.PlaneGeometry(w, h),
    color,
    0.75,
    );
    group.add(sphere, screen);
    return group;
  }
  function buildWeaponShopHelper(
    component: Extract<PrefabComponent, { type: "weapon-shop" }>,
  ): THREE.Object3D | null {
    const group = new THREE.Group();
    const color = 0xff7a4a;
    const radius = component.gazeRadius ?? 0.4;
    const sphere = makeHelperMesh(
    new THREE.SphereGeometry(radius, 12, 10),
    color,
    0.28,
    true,
    );
    const w = component.screenWidth ?? 0.45;
    const h = component.screenHeight ?? 0.28;
    const screen = makeHelperMesh(
    new THREE.PlaneGeometry(w, h),
    color,
    0.75,
    );
    group.add(sphere, screen);
    return group;
  }
  function buildOutfittersHelper(
    component: Extract<PrefabComponent, { type: "outfitters" }>,
  ): THREE.Object3D | null {
    const group = new THREE.Group();
    const color = 0x4ad9a0;
    const radius = component.gazeRadius ?? 0.4;
    const sphere = makeHelperMesh(
    new THREE.SphereGeometry(radius, 12, 10),
    color,
    0.28,
    true,
    );
    const w = component.screenWidth ?? 0.45;
    const h = component.screenHeight ?? 0.28;
    const screen = makeHelperMesh(
    new THREE.PlaneGeometry(w, h),
    color,
    0.75,
    );
    group.add(sphere, screen);
    return group;
  }
  function buildConsumableShopHelper(
    component: Extract<PrefabComponent, { type: "food-shop" | "drinks-shop" | "canteen" }>,
  ): THREE.Object3D | null {
    const group = new THREE.Group();
    const color =
    component.type === "food-shop"
    ? 0xf0c14a
    : component.type === "drinks-shop"
    ? 0x4ab8f0
    : 0xc47af0;
    const radius = component.gazeRadius ?? 0.4;
    const sphere = makeHelperMesh(
    new THREE.SphereGeometry(radius, 12, 10),
    color,
    0.28,
    true,
    );
    const w = component.screenWidth ?? 0.45;
    const h = component.screenHeight ?? 0.28;
    const screen = makeHelperMesh(
    new THREE.PlaneGeometry(w, h),
    color,
    0.75,
    );
    group.add(sphere, screen);
    return group;
  }
  function buildShipControllerHelper(
    component: Extract<PrefabComponent, { type: "ship-controller" }>,
  ): THREE.Object3D | null {
    if (component.restHeight === undefined) return null;
    return makeRestHeightHelper(component.restHeight);
  }
  function buildNullHelper(): THREE.Object3D | null {
    return null;
  }
  const componentHelperBuilders = {
    "point-light": buildPointLightHelper,
    "area-light": buildAreaLightHelper,
    "spot-light": buildSpotLightHelper,
    "sound": buildSoundHelper,
    "particle-system": buildParticleSystemHelper,
    "spawn-point": buildSpawnPointHelper,
    "npc-spawner": buildNpcSpawnerHelper,
    "npc-waypoint": buildNpcWaypointHelper,
    "npc-placement": buildNpcPlacementHelper,
    "elevator": buildElevatorHelper,
    "hangar-pad": buildHangarPadHelper,
    "interaction": buildInteractionHelper,
    "station-frame": () => buildFrameAxesHelper(),
    "ship-frame": () => buildFrameAxesHelper(),
    "ship-hull": buildShipHullHelper,
    "ship-door": buildShipDoorHelper,
    "pilot-seat": buildPilotSeatHelper,
    "bed": buildBedHelper,
    "ramp-interact": buildRampInteractHelper,
    "cockpit-control": buildCockpitControlHelper,
    "cockpit-stat": buildCockpitStatHelper,
    "entertainment-system": buildEntertainmentSystemHelper,
    "weapon-shop": buildWeaponShopHelper,
    "outfitters": buildOutfittersHelper,
    "food-shop": buildConsumableShopHelper,
    "drinks-shop": buildConsumableShopHelper,
    "canteen": buildConsumableShopHelper,
    "ship-controller": buildShipControllerHelper,
    "ship-stats": () => buildNullHelper(),
    "ship-gear": () => buildNullHelper(),
    "ship-ramp": () => buildNullHelper(),
  } as Record<string, (component: PrefabComponent) => THREE.Object3D | null>;

  function buildComponentHelper(
    component: PrefabComponent,
    meshColliderTarget?: THREE.Object3D,
  ): THREE.Object3D | null {
    if (component.type === "collider") {
      return buildColliderHelper(component, meshColliderTarget);
    }
    const builder = componentHelperBuilders[component.type];
    return builder ? builder(component) : null;
  }

  return {
    makeHelperMesh,
    makeRestHeightHelper,
    clearRestHeightHelpers,
    makeMeshColliderHelper,
    buildComponentHelper,
  };
}
