import * as THREE from 'three';

export function createTerrainMaterial(): THREE.MeshLambertMaterial {
  return new THREE.MeshLambertMaterial({
    dithering: true,
    flatShading: true,
    side: THREE.FrontSide,
    vertexColors: true,
  });
}
