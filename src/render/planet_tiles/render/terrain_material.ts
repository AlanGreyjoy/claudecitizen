import * as THREE from 'three';

export function createTerrainMaterial(): THREE.MeshStandardMaterial {
  return new THREE.MeshStandardMaterial({
    dithering: true,
    flatShading: true,
    metalness: 0,
    roughness: 0.94,
    side: THREE.FrontSide,
    vertexColors: true,
  });
}
