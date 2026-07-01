import * as THREE from 'three';
import { GLTFLoader } from 'three/examples/jsm/loaders/GLTFLoader';

const SHIP_URL = new URL('../../../assets/ships/Ship_Large.gltf', import.meta.url).href;

export function createShipModel(renderScale: number): THREE.Group {
  const group = new THREE.Group();

  const loader = new GLTFLoader();
  const bbox = new THREE.Box3();
  const center = new THREE.Vector3();

  loader.load(
    SHIP_URL,
    (gltf) => {
      const sceneRoot = gltf.scene;
      sceneRoot.rotation.y = Math.PI / 2;
      sceneRoot.scale.setScalar(renderScale);
      sceneRoot.traverse((object) => {
        object.frustumCulled = false;
        if (object instanceof THREE.Mesh) {
          object.castShadow = true;
          object.receiveShadow = true;
        }
      });
      bbox.setFromObject(sceneRoot);
      bbox.getCenter(center);
      sceneRoot.position.sub(center);
      group.add(sceneRoot);
    },
    undefined,
    (error) => {
      console.error('ClaudeCitizen ship load failed.', error);
    },
  );

  return group;
}
