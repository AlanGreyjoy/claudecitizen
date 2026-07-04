import * as THREE from 'three';
import type { Vec3 } from '../../../types';
import { normalize } from '../../../math/vec3';
import { radialUp } from '../../../world/coordinates';
import { clamp01, v3 } from '../domain/math';
import type { RenderMode } from '../domain/types';
import { DAY_LENGTH_SECONDS } from '../domain/constants';

export interface SunSystemState {
  sunDir: THREE.Vector3;
  daylightFactor: number;
  rawDaylight: number;
  surfaceDaylightFactor: number;
  surfaceRawDaylight: number;
  dayNightInfluence: number;
  planetCenter: THREE.Vector3;
}

const cycleSunDirScratch = new THREE.Vector3();
const sunDirScratch = new THREE.Vector3();
const moonDirScratch = new THREE.Vector3();
const spaceSunDir = new THREE.Vector3(0.72, 0.34, 0.6).normalize();

function lerpNumber(a: number, b: number, t: number): number {
  return a + (b - a) * t;
}

function configureShadowCamera(
  light: THREE.DirectionalLight,
  renderMode: RenderMode,
  renderScale: number,
): void {
  if (
    renderMode === 'on-foot' ||
    renderMode === 'on-ship-deck' ||
    renderMode === 'in-station' ||
    renderMode === 'riding-elevator'
  ) {
    const shadowSize = 35 * renderScale;
    light.shadow.camera.left = -shadowSize;
    light.shadow.camera.right = shadowSize;
    light.shadow.camera.top = shadowSize;
    light.shadow.camera.bottom = -shadowSize;
    light.shadow.camera.near = 0.1;
    light.shadow.camera.far = 1000 * renderScale;
  } else {
    const shadowSize = 500 * renderScale;
    light.shadow.camera.left = -shadowSize;
    light.shadow.camera.right = shadowSize;
    light.shadow.camera.top = shadowSize;
    light.shadow.camera.bottom = -shadowSize;
    light.shadow.camera.near = 0.1;
    light.shadow.camera.far = 3000 * renderScale;
  }
  light.shadow.camera.updateProjectionMatrix();
}

export function updateSunSystem(
  nowSeconds: number,
  focusPosition: Vec3,
  renderScale: number,
  renderMode: RenderMode,
  up: Vec3,
  dayNightInfluence: number,
  sun: THREE.DirectionalLight,
  sunMesh: THREE.Mesh,
  moonMesh?: THREE.Mesh,
  moonLight?: THREE.DirectionalLight,
): SunSystemState {
  const theta = (nowSeconds / DAY_LENGTH_SECONDS) * Math.PI * 2;
  const surfaceInfluence = clamp01(dayNightInfluence);
  const spaceInfluence = 1 - surfaceInfluence;
  cycleSunDirScratch.set(
    Math.cos(theta),
    Math.sin(theta) * 0.364,
    Math.sin(theta) * 0.939,
  ).normalize();
  sunDirScratch.copy(spaceSunDir).lerp(cycleSunDirScratch, surfaceInfluence).normalize();

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

  const shadowDist =
    (renderMode === 'on-foot' ||
    renderMode === 'on-ship-deck' ||
    renderMode === 'in-station' ||
    renderMode === 'riding-elevator'
      ? 200
      : 1500) * renderScale;
  sun.position.copy(sunDirScratch).multiplyScalar(shadowDist);
  sun.target.position.set(0, 0, 0);
  configureShadowCamera(sun, renderMode, renderScale);

  const surfaceRawDaylight = cycleSunDirScratch.dot(v3(up));
  const surfaceDaylightFactor = clamp01(surfaceRawDaylight + 0.2);
  const rawDaylight = lerpNumber(surfaceRawDaylight, 1, spaceInfluence);
  const daylightFactor = lerpNumber(surfaceDaylightFactor, 1, spaceInfluence);

  const shadowsEnabled = sun.userData.shadowsEnabled === true;

  if (moonMesh && moonLight) {
    // Full-moon model: the moon sits opposite the sun, so it is up at night.
    moonDirScratch.copy(cycleSunDirScratch).negate();
    moonMesh.position.copy(moonDirScratch).multiplyScalar(skyBodyDist * 0.92);
    const moonElevation = Math.max(0, moonDirScratch.dot(v3(up)));
    const nightFactor = 1 - surfaceDaylightFactor;
    moonMesh.visible = surfaceInfluence > 0.02 && moonElevation > 0.01;
    moonLight.position.copy(moonDirScratch).multiplyScalar(shadowDist);
    moonLight.target.position.set(0, 0, 0);
    // Soft curve so moonlight ramps up quickly once the moon clears the horizon.
    // Kept well below sun intensity (~1.65) so night reads as night.
    moonLight.intensity = 0.7 * Math.pow(moonElevation, 0.6) * nightFactor * surfaceInfluence;
    configureShadowCamera(moonLight, renderMode, renderScale);

    // Only one shadow map per frame: whichever body is meaningfully lighting
    // the scene. Without this, the moonlit side of terrain is uniformly flat.
    moonLight.castShadow = shadowsEnabled && moonLight.intensity > 0.05;
    sun.castShadow = shadowsEnabled && rawDaylight > -0.1;
  } else {
    sun.castShadow = shadowsEnabled;
  }

  return {
    sunDir: sunDirScratch.clone(),
    daylightFactor,
    rawDaylight,
    surfaceDaylightFactor,
    surfaceRawDaylight,
    dayNightInfluence: surfaceInfluence,
    planetCenter,
  };
}

export function updateSunIntensity(
  sun: THREE.DirectionalLight,
  rawDaylight: number,
  spaceFactor: number,
): void {
  sun.intensity = (1.65 + spaceFactor * 0.55) * clamp01(rawDaylight * 2.0 + 0.2);
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
