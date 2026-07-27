import * as THREE from "three";
import type { Vec3 } from "../../types";

export interface ViewFocusOptions {
  camera: THREE.PerspectiveCamera;
  /** Orbit pivot — the point the Scene view is looking at. */
  getTarget: () => THREE.Vector3;
  entityRoot: THREE.Object3D;
  objectsById: Map<string, THREE.Object3D>;
  isSnapEnabled: () => boolean;
  getTranslateStep: () => number;
}

export interface ViewFocus {
  /** Orbit pivot expressed in `parentEntityId`'s local space (root when null). */
  getViewFocusPosition: (parentEntityId: string | null) => Vec3;
}

/**
 * Spawn point for "create here" authoring actions: the orbit pivot, which is
 * what the Scene view is centred on (flythrough re-aims it, so it stays in
 * front of the camera while flying).
 */
export function createViewFocus(options: ViewFocusOptions): ViewFocus {
  const { camera, getTarget, entityRoot, objectsById, isSnapEnabled, getTranslateStep } =
    options;
  const point = new THREE.Vector3();

  return {
    getViewFocusPosition(parentEntityId: string | null): Vec3 {
      point.copy(getTarget());
      if (!Number.isFinite(point.x + point.y + point.z)) {
        camera.getWorldDirection(point).multiplyScalar(8).add(camera.position);
      }
      const parent =
        (parentEntityId ? objectsById.get(parentEntityId) : null) ?? entityRoot;
      parent.updateWorldMatrix(true, false);
      parent.worldToLocal(point);

      const step = isSnapEnabled() ? getTranslateStep() : 0;
      const snap = (value: number): number =>
        step > 0 ? Math.round(value / step) * step : value;
      return { x: snap(point.x), y: snap(point.y), z: snap(point.z) };
    },
  };
}
