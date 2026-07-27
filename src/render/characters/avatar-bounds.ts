import * as THREE from 'three';

/**
 * Bounds of the visible geometry only. `Box3.setFromObject` also swallows
 * helper/empty nodes and non-rendered attachment points, which pushes the
 * ground offset off by whatever those sit at.
 */
export function avatarGeometryBounds(root: THREE.Object3D): THREE.Box3 {
  const bounds = new THREE.Box3().makeEmpty();
  root.updateMatrixWorld(true);
  root.traverse((object) => {
    if (!(object instanceof THREE.Mesh) || !object.visible) return;
    if (!object.geometry.boundingBox) object.geometry.computeBoundingBox();
    if (object.geometry.boundingBox) {
      bounds.union(object.geometry.boundingBox.clone().applyMatrix4(object.matrixWorld));
    }
  });
  return bounds.isEmpty() ? new THREE.Box3().setFromObject(root) : bounds;
}
