import * as THREE from 'three';

function isDrawable(object: THREE.Object3D): boolean {
  return (
    object instanceof THREE.Mesh ||
    object instanceof THREE.Line ||
    object instanceof THREE.LineSegments ||
    object instanceof THREE.Points ||
    object instanceof THREE.Sprite
  );
}

/**
 * ClaudeCitizen default: frustum-cull every drawable mesh; leave container
 * Object3Ds uncullable so Three.js still visits their children (a Group with no
 * geometry would otherwise fail the frustum test and drop the whole subtree).
 */
export function applyDefaultFrustumCulling(root: THREE.Object3D): void {
  root.traverse((object) => {
    if (!isDrawable(object)) {
      object.frustumCulled = false;
      return;
    }
    object.frustumCulled = true;
    const geometry = (object as THREE.Mesh).geometry;
    if (geometry && geometry.boundingSphere == null) {
      geometry.computeBoundingSphere();
    }
  });
}
