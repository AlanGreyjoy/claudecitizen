import * as THREE from "three";
import type { PrefabComponent } from "../../world/prefabs/schema";
import { createViewportComponentBuilders } from "./viewport-component-builders";

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
    makeMeshColliderHelper,
    buildComponentHelper,
  };
}
