import * as THREE from "three";
import { createPrefabLightObject } from "../prefabs/prefab-renderer";
import { createParticleShapeHelper } from "../particles";
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

/** Rails + rungs up the authored climb height, with the +Z step-off side marked. */
function buildLadderHelper(
  component: Extract<PrefabComponent, { type: "ladder" }>,
  makeHelperMesh: ViewportHelperMeshFactory,
): THREE.Object3D | null {
  const group = new THREE.Group();
  const height = Math.max(0.5, component.height);
  const color = 0x8ee88a;
  const halfWidth = 0.24;
  for (const side of [-halfWidth, halfWidth]) {
    const rail = makeHelperMesh(
      new THREE.CylinderGeometry(0.035, 0.035, height, 6),
      color,
      0.7,
    );
    rail.position.set(side, height / 2, 0);
    group.add(rail);
  }
  // One rung every ~30cm keeps the helper readable without flooding the scene.
  const rungCount = Math.max(1, Math.round(height / 0.3));
  for (let i = 1; i <= rungCount; i += 1) {
    const rung = makeHelperMesh(
      new THREE.CylinderGeometry(0.028, 0.028, halfWidth * 2, 6),
      color,
      0.5,
    );
    rung.rotation.z = Math.PI / 2;
    rung.position.y = (i / (rungCount + 1)) * height;
    group.add(rung);
  }
  const reach = makeHelperMesh(
    new THREE.SphereGeometry(component.radius ?? 1.2, 14, 10),
    color,
    0.16,
    true,
  );
  group.add(reach);
  // +Z arrow: the side the player mounts from and steps off toward at the top.
  const stepOff = makeHelperMesh(
    new THREE.ConeGeometry(0.16, 0.42, 10),
    color,
    0.75,
  );
  stepOff.rotation.x = Math.PI / 2;
  stepOff.position.set(0, height, 0.55);
  group.add(stepOff);
  return group;
}
export function createViewportStationBuilders(deps: ViewportComponentBuilderDeps): {
  buildColliderHelper: (
    component: Extract<PrefabComponent, { type: "collider" }>,
    meshColliderTarget?: THREE.Object3D,
  ) => THREE.Object3D | null;
  buildFrameAxesHelper: () => THREE.Object3D | null;
  builders: Record<string, (component: PrefabComponent) => THREE.Object3D | null>;
} {
  const { track, makeHelperMesh, makeMeshColliderHelper } = deps;

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

  const builders = {
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
    "ladder": (component: PrefabComponent) =>
      buildLadderHelper(
        component as Extract<PrefabComponent, { type: "ladder" }>,
        makeHelperMesh,
      ),
    "hangar-pad": buildHangarPadHelper,
    "interaction": buildInteractionHelper,
    "station-frame": () => buildFrameAxesHelper(),
    "ship-frame": () => buildFrameAxesHelper(),
  } as Record<string, (component: PrefabComponent) => THREE.Object3D | null>;

  return { buildColliderHelper, buildFrameAxesHelper, builders };
}
