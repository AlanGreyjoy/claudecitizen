import * as THREE from "three";
import type { PrefabComponent, ShipSeatRole } from "../../world/prefabs/schema";
import type { Vec3 } from "../../types";
import { createViewportComponentBuilders } from "./viewport-component-builders";

/** Seat gizmo tint per role, so a four-seat cockpit reads at a glance. */
const SHIP_SEAT_ROLE_COLORS: Record<ShipSeatRole, number> = {
  pilot: 0x7dffa8,
  copilot: 0x5ec8ff,
  turret: 0xff9d5c,
  passenger: 0xc9d4e8,
};

/** Matches `collectPilotSeatComponent` in ship-runtime.ts. */
const SHIP_SEAT_DEFAULT_EYE: Vec3 = { x: 0, y: 0.87, z: 0.25 };

export type ViewportResourceTracker = <T extends { dispose: () => void }>(
  resource: T,
) => T;

/** Matches the collider bake's node matching (`physics/colliders.ts`). */
function sanitizeNodeName(name: string): string {
  return name.replace(/\s/g, "_");
}

function excludedColliderNodeNames(
  component: Extract<PrefabComponent, { type: "collider"; shape: "mesh" }>,
): ReadonlySet<string> {
  const excluded = new Set<string>();
  for (const node of component.excludeNodes ?? []) {
    if (node === component.node) continue;
    excluded.add(sanitizeNodeName(node));
  }
  return excluded;
}

/** Checks the mesh itself and its ancestors — excluded nodes are often leaves. */
function meshUnderExcludedNode(
  mesh: THREE.Object3D,
  root: THREE.Object3D,
  excluded: ReadonlySet<string>,
): boolean {
  if (excluded.size === 0) return false;
  let node: THREE.Object3D | null = mesh;
  while (node && node !== root) {
    if (node.name && excluded.has(sanitizeNodeName(node.name))) return true;
    node = node.parent;
  }
  return false;
}

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
  makeShipSeatHelper: (options: {
    role: ShipSeatRole;
    /** Seat-local eye offset from ship-controller; defaults to the bake default. */
    eye?: Vec3;
    /** Seat-local stand-up spot in scene XZ, when authored. */
    stand?: { x: number; z: number };
  }) => THREE.Group;
  clearShipSeatHelpers: (parent: THREE.Object3D) => void;
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

  /**
   * Seat gizmo for an empty registered in `ship-controller.seats[]`. Those
   * empties carry no component of their own, so nothing would draw at them.
   *
   * The marker is the seated character's **root**, which the avatar renders at
   * floor level (`character-avatar-model.ts` drops the model so its bounds sit
   * on the origin) — not the cushion. So the gizmo draws a flat foot disc at
   * the marker and puts the sphere at the **eye** offset, which is where the
   * cockpit camera actually ends up. Raising the marker to fix first-person
   * lifts the whole body off the chair; raising `eye` does not, and the two
   * shapes make that distinction visible while you drag.
   */
  function makeShipSeatHelper(options: {
    role: ShipSeatRole;
    eye?: Vec3;
    stand?: { x: number; z: number };
  }): THREE.Group {
    const color = SHIP_SEAT_ROLE_COLORS[options.role];
    const group = new THREE.Group();
    group.userData.editorShipSeatHelper = true;

    const foot = makeHelperMesh(new THREE.CircleGeometry(0.26, 24), color, 0.3);
    foot.rotation.x = -Math.PI / 2;
    const footRing = makeHelperMesh(
      new THREE.TorusGeometry(0.26, 0.015, 6, 24),
      color,
      0.85,
    );
    footRing.rotation.x = Math.PI / 2;

    const eye = options.eye ?? SHIP_SEAT_DEFAULT_EYE;
    const eyeBall = makeHelperMesh(new THREE.SphereGeometry(0.16, 20, 14), color, 0.45);
    eyeBall.position.set(eye.x, eye.y, eye.z);
    const eyeWire = makeHelperMesh(
      new THREE.SphereGeometry(0.165, 14, 10),
      color,
      0.5,
      true,
    );
    eyeWire.position.copy(eyeBall.position);

    // Root → eye stem: the distance you are really authoring with Eye.
    const stemLength = Math.max(0.05, Math.hypot(eye.x, eye.y, eye.z));
    const stem = makeHelperMesh(
      new THREE.CylinderGeometry(0.012, 0.012, stemLength, 6),
      color,
      0.45,
    );
    stem.position.set(eye.x / 2, eye.y / 2, eye.z / 2);
    stem.lookAt(new THREE.Vector3(eye.x, eye.y, eye.z));
    stem.rotateX(Math.PI / 2);

    group.add(foot, footRing, stem, eyeBall, eyeWire);

    if (options.stand) {
      const stand = makeHelperMesh(new THREE.CircleGeometry(0.3, 20), color, 0.22, true);
      stand.rotation.x = -Math.PI / 2;
      stand.position.set(options.stand.x, 0.01, options.stand.z);
      group.add(stand);
    }
    return group;
  }

  function clearShipSeatHelpers(parent: THREE.Object3D): void {
    for (const child of [...parent.children]) {
      if (child.userData.editorShipSeatHelper) parent.remove(child);
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
    // Mirrors the gameplay bake's carve-out (prefab-colliders `excludeNodes`).
    // The preview is the only way to see what got baked, so it has to drop the
    // same subtrees or it reports collision that does not exist.
    const excluded = excludedColliderNodeNames(component);

    target.traverse((child) => {
      if (
        !(child instanceof THREE.Mesh) ||
        child.userData.editorMeshColliderHelper
      ) {
        return;
      }
      if (meshUnderExcludedNode(child, target, excluded)) return;
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
  const { buildComponentHelper } = createViewportComponentBuilders({
    track,
    makeHelperMesh,
    makeRestHeightHelper,
    makeMeshColliderHelper,
  });

  return {
    makeHelperMesh,
    makeRestHeightHelper,
    clearRestHeightHelpers,
    makeShipSeatHelper,
    clearShipSeatHelpers,
    makeMeshColliderHelper,
    buildComponentHelper,
  };
}
