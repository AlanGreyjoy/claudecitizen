import * as THREE from 'three';
import type { InstancedAsset } from './instanced_assets';
import { applyWindToMaterial } from './wind';

const CONE_RADIUS = 0.55;
const CONE_HEIGHT = 2.2;
const CONE_SEGMENTS = 6;

export function createTreeLodAsset(): InstancedAsset {
  const geometry = new THREE.ConeGeometry(
    CONE_RADIUS,
    CONE_HEIGHT,
    CONE_SEGMENTS,
  );
  geometry.translate(0, CONE_HEIGHT * 0.5, 0);

  const material = new THREE.MeshStandardMaterial({
    color: 0x4a7a3a,
    flatShading: true,
  });
  // Match the high-LOD pine sway so trees don't visibly "freeze" when they
  // swap to the imposter cone at distance.
  applyWindToMaterial(material, {
    referenceHeight: CONE_HEIGHT,
    speed: 0.7,
    strength: CONE_HEIGHT * 0.035,
  });

  return {
    baseOffsetY: 0,
    boundsHalfExtents: [CONE_RADIUS, CONE_HEIGHT * 0.5, CONE_RADIUS],
    collisionCenter: [0, CONE_HEIGHT * 0.5, 0],
    parts: [{ geometry, material }],
  };
}

export function disposeTreeLodAsset(asset: InstancedAsset): void {
  for (const part of asset.parts) {
    part.geometry.dispose();
    if (Array.isArray(part.material)) {
      part.material.forEach((material) => material.dispose());
    } else {
      part.material.dispose();
    }
  }
}
