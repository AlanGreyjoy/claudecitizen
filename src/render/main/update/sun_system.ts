import * as THREE from 'three';
import type { Vec3 } from '../../../types';
import { normalize } from '../../../math/vec3';
import { radialUp } from '../../../world/coordinates';
import { v3 } from '../domain/math';
import type { RenderMode } from '../domain/types';
import { DAY_LENGTH_SECONDS } from '../domain/constants';

export interface SunSystemState {
  sunDir: THREE.Vector3;
  daylightFactor: number;
  rawDaylight: number;
  planetCenter: THREE.Vector3;
}

const sunDirScratch = new THREE.Vector3();
const moonDirScratch = new THREE.Vector3();

export function updateSunSystem(
  nowSeconds: number,
  focusPosition: Vec3,
  renderScale: number,
  renderMode: RenderMode,
  up: Vec3,
  sun: THREE.DirectionalLight,
  sunMesh: THREE.Mesh,
  moonMesh?: THREE.Mesh,
  moonLight?: THREE.DirectionalLight,
): SunSystemState {
  const theta = (nowSeconds / DAY_LENGTH_SECONDS) * Math.PI * 2;
  sunDirScratch.set(
    Math.cos(theta),
    Math.sin(theta) * 0.364,
    Math.sin(theta) * 0.939,
  ).normalize();

  const planetCenter = new THREE.Vector3(
    -focusPosition.x * renderScale,
    -focusPosition.y * renderScale,
    -focusPosition.z * renderScale,
  );
  // Sky bodies are anchored to the camera (focus is at the origin) at a fixed
  // distance inside the far plane; positioning them relative to the planet
  // center at sunDist put them inside the planet, never visible.
  const skyBodyDist = 200_000;
  sunMesh.position.copy(sunDirScratch).multiplyScalar(skyBodyDist);

  const shadowDist = (renderMode === 'on-foot' || renderMode === 'on-ship-deck' ? 200 : 1500) * renderScale;
  sun.position.copy(sunDirScratch).multiplyScalar(shadowDist);
  sun.target.position.set(0, 0, 0);

  if (renderMode === 'on-foot' || renderMode === 'on-ship-deck') {
    const shadowSize = 35 * renderScale;
    sun.shadow.camera.left = -shadowSize;
    sun.shadow.camera.right = shadowSize;
    sun.shadow.camera.top = shadowSize;
    sun.shadow.camera.bottom = -shadowSize;
    sun.shadow.camera.near = 0.1;
    sun.shadow.camera.far = 1000 * renderScale;
  } else {
    const shadowSize = 500 * renderScale;
    sun.shadow.camera.left = -shadowSize;
    sun.shadow.camera.right = shadowSize;
    sun.shadow.camera.top = shadowSize;
    sun.shadow.camera.bottom = -shadowSize;
    sun.shadow.camera.near = 0.1;
    sun.shadow.camera.far = 3000 * renderScale;
  }
  sun.shadow.camera.updateProjectionMatrix();

  const rawDaylight = sunDirScratch.dot(v3(up));
  const daylightFactor = Math.max(0, Math.min(1, rawDaylight + 0.2));

  if (moonMesh && moonLight) {
    // Full-moon model: the moon sits opposite the sun, so it is up at night.
    moonDirScratch.copy(sunDirScratch).negate();
    moonMesh.position.copy(moonDirScratch).multiplyScalar(skyBodyDist * 0.92);
    const moonElevation = Math.max(0, moonDirScratch.dot(v3(up)));
    const nightFactor = 1 - daylightFactor;
    moonMesh.visible = moonElevation > 0.01;
    moonLight.position.copy(moonDirScratch).multiplyScalar(shadowDist);
    moonLight.target.position.set(0, 0, 0);
    moonLight.intensity = 0.35 * moonElevation * nightFactor;
  }

  return {
    sunDir: sunDirScratch.clone(),
    daylightFactor,
    rawDaylight,
    planetCenter,
  };
}

export function updateSunIntensity(
  sun: THREE.DirectionalLight,
  rawDaylight: number,
  spaceFactor: number,
): void {
  sun.intensity = (1.65 + spaceFactor * 0.55) * Math.max(0, Math.min(1, rawDaylight * 2.0 + 0.2));
}

export interface ShipPlacementInput {
  position: Vec3;
  up?: Vec3;
  forward: Vec3;
}

export function updateShipPlacement(
  shipMesh: THREE.Group,
  ship: ShipPlacementInput,
  focusPosition: Vec3,
  renderScale: number,
): void {
  const shipLookTarget = new THREE.Vector3();
  const localPosition = new THREE.Vector3(
    (ship.position.x - focusPosition.x) * renderScale,
    (ship.position.y - focusPosition.y) * renderScale,
    (ship.position.z - focusPosition.z) * renderScale,
  );
  shipMesh.position.copy(localPosition);
  shipMesh.up.copy(v3(normalize(ship.up ?? radialUp(ship.position))));
  const forward = normalize(ship.forward);
  shipLookTarget.set(
    localPosition.x + forward.x * 200 * renderScale,
    localPosition.y + forward.y * 200 * renderScale,
    localPosition.z + forward.z * 200 * renderScale,
  );
  shipMesh.lookAt(shipLookTarget);
}
