import * as THREE from 'three';
import type { Vec3 } from '../../../types';
import { normalize } from '../../../math/vec3';
import { radialUp } from '../../../world/coordinates';
import { clamp01, v3 } from '../domain/math';
import type { RenderMode } from '../domain/types';
import { MOON_MESH_RADIUS, SUN_MESH_RADIUS } from '../domain/constants';
import { resolveSkyPalette, resolveSkyRecipe } from '../domain/sky-recipe';

export interface SunSystemState {
  sunDir: THREE.Vector3;
  daylightFactor: number;
  rawDaylight: number;
  surfaceDaylightFactor: number;
  surfaceRawDaylight: number;
  dayNightInfluence: number;
  planetCenter: THREE.Vector3;
  /** Planet-center-to-moon unit direction for the authored orbit. */
  moonDir: THREE.Vector3;
  /** Constant normal of the moon's orbit plane — the moon's rotation axis. */
  moonOrbitNormal: THREE.Vector3;
  /** cos(zenith angle) of the moon, clamped to 0 below the horizon. */
  moonElevation: number;
  /** Lit fraction of the moon's disc: 0 new, 1 full. */
  moonIllumination: number;
  /** True while the moon is above the local horizon on the surface. */
  moonAboveHorizon: boolean;
}

const cycleSunDirScratch = new THREE.Vector3();
const sunDirScratch = new THREE.Vector3();
const moonDirScratch = new THREE.Vector3();
const moonOrbitNormalScratch = new THREE.Vector3();
const spaceSunDir = new THREE.Vector3(0.72, 0.34, 0.6).normalize();

/**
 * Places the moon on its own inclined circular orbit.
 *
 * A moon pinned exactly opposite the sun is always full at local midnight,
 * which is why the old sky never showed a crescent. Walking the orbit at a
 * slightly different rate than the day (`synodicPeriodDays`) makes the phase
 * drift, and the separate `orbitTiltDegrees` keeps the moon off the sun's
 * great circle so the two bodies do not trace the same arc.
 *
 * Writes into module scratch vectors and returns them; the caller clones.
 */
function computeMoonDirection(
  nowSeconds: number,
  dayLengthSeconds: number,
  synodicPeriodDays: number,
  phaseOffsetRadians: number,
  orbitTiltRadians: number,
): { direction: THREE.Vector3; orbitNormal: THREE.Vector3 } {
  const dayAngle = (nowSeconds / dayLengthSeconds) * Math.PI * 2;
  const phaseDrift =
    (nowSeconds / (dayLengthSeconds * synodicPeriodDays)) * Math.PI * 2;
  const theta = dayAngle - phaseDrift + phaseOffsetRadians + Math.PI;
  const sinTilt = Math.sin(orbitTiltRadians);
  const cosTilt = Math.cos(orbitTiltRadians);
  moonDirScratch
    .set(Math.cos(theta), Math.sin(theta) * sinTilt, Math.sin(theta) * cosTilt)
    .normalize();
  // d(P)/dθ × P is constant for this parameterization; derived once here so the
  // moon-fixed texture frame can be built without a per-frame cross product.
  moonOrbitNormalScratch.set(0, -cosTilt, sinTilt).normalize();
  return { direction: moonDirScratch, orbitNormal: moonOrbitNormalScratch };
}

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
    renderMode === 'in-station'
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
  lighting: {
    sun: THREE.DirectionalLight;
    sunMesh: THREE.Mesh;
    moonMesh?: THREE.Mesh;
    moonLight?: THREE.DirectionalLight;
  },
): SunSystemState {
  const { sun, sunMesh, moonMesh, moonLight } = lighting;
  const skyRecipe = resolveSkyRecipe();
  const skyPalette = resolveSkyPalette(skyRecipe);
  const theta = (nowSeconds / skyRecipe.dayLengthSeconds) * Math.PI * 2;
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
  // The sphere is authored at radius 12000; scale it so the disc subtends the
  // authored angle instead of the ~7-degree blob the fixed radius produced.
  sunMesh.scale.setScalar(
    (skyBodyDist * Math.tan(skyPalette.sunAngularRadius)) / SUN_MESH_RADIUS,
  );
  (sunMesh.material as THREE.MeshBasicMaterial).color.copy(skyPalette.sun);
  sun.color.copy(skyPalette.sun);

  const shadowDist =
    (renderMode === 'on-foot' ||
    renderMode === 'on-ship-deck' ||
    renderMode === 'in-station'
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

  const moon = computeMoonDirection(
    nowSeconds,
    skyRecipe.dayLengthSeconds,
    skyRecipe.moon.synodicPeriodDays,
    skyPalette.moonPhaseOffset,
    skyPalette.moonOrbitTilt,
  );
  const moonElevation = Math.max(0, moon.direction.dot(v3(up)));
  // Lit fraction as seen from the surface: opposite the sun is full, aligned
  // with it is new.
  const moonIllumination = clamp01(
    (1 - moon.direction.dot(cycleSunDirScratch)) * 0.5,
  );
  const moonAboveHorizon =
    skyRecipe.moon.enabled && surfaceInfluence > 0.02 && moonElevation > 0.01;

  if (moonMesh && moonLight) {
    moonMesh.position.copy(moon.direction).multiplyScalar(skyBodyDist * 0.92);
    moonMesh.scale.setScalar(
      (skyBodyDist * 0.92 * Math.tan(skyPalette.moonAngularRadius)) /
        MOON_MESH_RADIUS,
    );
    (moonMesh.material as THREE.MeshBasicMaterial).color.copy(
      skyPalette.moonSurface,
    );
    const nightFactor = 1 - surfaceDaylightFactor;
    moonLight.position.copy(moon.direction).multiplyScalar(shadowDist);
    moonLight.target.position.set(0, 0, 0);
    moonLight.color.copy(skyPalette.moonLight);
    // Soft curve so moonlight ramps up quickly once the moon clears the
    // horizon, scaled by how much of the disc is actually lit. Kept well below
    // sun intensity so night still reads as night.
    moonLight.intensity =
      skyRecipe.moon.lightIntensity *
      Math.pow(moonElevation, 0.6) *
      (0.25 + moonIllumination * 0.75) *
      nightFactor *
      surfaceInfluence *
      (skyRecipe.moon.enabled ? 1 : 0);
    configureShadowCamera(moonLight, renderMode, renderScale);

    // Only one body should *contribute* shadows per frame (both casting made
    // moonlit terrain read flat), and only one should *render* a shadow map.
    //
    // Do NOT toggle `castShadow` for that — Three's AnalyticLightNode disposes
    // the ShadowNode when castShadow goes false, and the next frame's
    // updateBefore then reads `shadowMap.depthTexture` on null (console spam on
    // every Day↔Night debug toggle).
    //
    // `shadow.intensity` alone is not enough either: it only scales the shader
    // contribution. ShadowNode.updateBefore gates the actual shadow-map render
    // on `shadow.needsUpdate || shadow.autoUpdate`, so a muted light still
    // rasterises the whole scene into its depth map every frame — two full
    // shadow passes instead of one. Keep castShadow stable, mute with
    // intensity, and stop the pass with autoUpdate.
    const moonShadowActive = shadowsEnabled && moonLight.intensity > 0.05;
    const sunShadowActive = shadowsEnabled && rawDaylight > -0.1;
    const moonShadowVisible = moonShadowActive && !sunShadowActive;
    moonLight.castShadow = shadowsEnabled;
    sun.castShadow = shadowsEnabled;
    moonLight.shadow.intensity = moonShadowVisible ? 0.85 : 0;
    sun.shadow.intensity = sunShadowActive ? 0.82 : 0;
    moonLight.shadow.autoUpdate = shadowsEnabled && moonShadowVisible;
    sun.shadow.autoUpdate = shadowsEnabled && sunShadowActive;
  } else {
    sun.castShadow = shadowsEnabled;
    sun.shadow.intensity = shadowsEnabled ? 0.82 : 0;
    sun.shadow.autoUpdate = shadowsEnabled;
  }

  return {
    sunDir: sunDirScratch.clone(),
    daylightFactor,
    rawDaylight,
    surfaceDaylightFactor,
    surfaceRawDaylight,
    dayNightInfluence: surfaceInfluence,
    planetCenter,
    moonDir: moon.direction.clone(),
    moonOrbitNormal: moon.orbitNormal.clone(),
    moonElevation,
    moonIllumination,
    moonAboveHorizon,
  };
}

export function updateSunIntensity(
  sun: THREE.DirectionalLight,
  rawDaylight: number,
  spaceFactor: number,
): void {
  const { intensity } = resolveSkyRecipe().sun;
  sun.intensity =
    (intensity + spaceFactor * intensity * 0.33) *
    clamp01(rawDaylight * 2.0 + 0.2);
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
