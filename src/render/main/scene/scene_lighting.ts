import * as THREE from 'three';
import {
  DEFAULT_FOG_COLOR,
  DEFAULT_FOG_FAR,
  DEFAULT_FOG_NEAR,
  SKY_HIGH_COLOR,
} from '../domain/constants';
import { resolveRenderQuality } from '../domain/render_quality';

export interface SceneLighting {
  ambient: THREE.HemisphereLight;
  sun: THREE.DirectionalLight;
  sunMesh: THREE.Mesh;
  moonMesh: THREE.Mesh;
  moonLight: THREE.DirectionalLight;
}

export function createSceneLighting(scene: THREE.Scene): SceneLighting {
  const renderQuality = resolveRenderQuality();
  const ambient = new THREE.HemisphereLight(0xc4e2ff, 0x261b12, 1.05);
  scene.add(ambient);

  const sun = new THREE.DirectionalLight(0xfff1d2, 1.8);
  sun.castShadow = renderQuality.shadowMapSize > 0;
  sun.shadow.mapSize.width = renderQuality.shadowMapSize;
  sun.shadow.mapSize.height = renderQuality.shadowMapSize;
  sun.shadow.bias = -0.0003;
  scene.add(sun);
  scene.add(sun.target);

  const sunMesh = new THREE.Mesh(
    new THREE.SphereGeometry(12000, 32, 32),
    new THREE.MeshBasicMaterial({ color: 0xfff1d2, fog: false }),
  );
  scene.add(sunMesh);

  const moonMesh = new THREE.Mesh(
    new THREE.SphereGeometry(7000, 32, 32),
    new THREE.MeshBasicMaterial({ color: 0xdfe6f2, fog: false, toneMapped: false }),
  );
  scene.add(moonMesh);

  const moonLight = new THREE.DirectionalLight(0x93a7cc, 0);
  scene.add(moonLight);
  scene.add(moonLight.target);

  return { ambient, sun, sunMesh, moonMesh, moonLight };
}

export function createMainScene(): THREE.Scene {
  const scene = new THREE.Scene();
  scene.background = SKY_HIGH_COLOR.clone();
  scene.fog = new THREE.Fog(DEFAULT_FOG_COLOR, DEFAULT_FOG_NEAR, DEFAULT_FOG_FAR);
  return scene;
}

export function createMainCamera(): THREE.PerspectiveCamera {
  return new THREE.PerspectiveCamera(72, 1, 0.0001, 500_000);
}
