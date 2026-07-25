import * as THREE from "three";
import type { PrefabComponent } from "../../world/prefabs/schema";

export interface ViewportHelperMeshFactory {
  (
    geometry: THREE.BufferGeometry,
    color: number,
    opacity: number,
    wireframe?: boolean,
  ): THREE.Mesh;
}

export interface ViewportComponentBuilderDeps {
  track: <T extends { dispose: () => void }>(resource: T) => T;
  makeHelperMesh: ViewportHelperMeshFactory;
  makeRestHeightHelper: (
    restHeightMeters: number,
    options?: { auto?: boolean; radius?: number },
  ) => THREE.Group;
  makeMeshColliderHelper: (
    target: THREE.Object3D,
    component: Extract<PrefabComponent, { type: "collider"; shape: "mesh" }>,
  ) => THREE.Object3D | null;
}

export function createViewportShipBuilders(deps: ViewportComponentBuilderDeps): Record<
  string,
  (component: PrefabComponent) => THREE.Object3D | null
> {
  const { makeHelperMesh, makeRestHeightHelper } = deps;

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
return {
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
}
