import * as THREE from 'three';

const right = new THREE.Vector3();
const normal = new THREE.Vector3();
const toCamera = new THREE.Vector3();
const fallback = new THREE.Vector3();
const basis = new THREE.Matrix4();

/**
 * Orient a plane whose local +Y is `axis` so its face turns toward the camera.
 *
 * Crossed quad pairs (the previous approach) still go edge-on at the wrong
 * angle and double the overdraw; one axis-billboarded quad never does.
 * `axis` must be normalized; every vector is in render space.
 */
export function alignPlaneAxisToCamera(
  target: THREE.Object3D,
  axis: THREE.Vector3,
  worldPosition: THREE.Vector3,
  cameraPosition: THREE.Vector3,
): void {
  toCamera.subVectors(cameraPosition, worldPosition);
  right.crossVectors(axis, toCamera);
  if (right.lengthSq() < 1e-10) {
    // Looking straight down the axis: any perpendicular reads the same.
    fallback.set(Math.abs(axis.y) > 0.9 ? 1 : 0, Math.abs(axis.y) > 0.9 ? 0 : 1, 0);
    right.crossVectors(axis, fallback);
    if (right.lengthSq() < 1e-10) right.set(1, 0, 0);
  }
  right.normalize();
  normal.crossVectors(right, axis).normalize();
  basis.makeBasis(right, axis, normal);
  target.quaternion.setFromRotationMatrix(basis);
}
