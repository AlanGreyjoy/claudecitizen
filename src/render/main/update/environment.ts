import * as THREE from 'three';
import type { Planet, Vec3 } from '../../../types';
import { VolumetricFogEffect } from '../../effects';
import {
  HAZE_LOW_COLOR,
  NIGHT_FOG_COLOR,
  NIGHT_SKY_COLOR,
  PLANET_FOG_MAX_ALTITUDE_METERS,
  SKY_HIGH_COLOR,
  SKY_LOW_COLOR,
  SKY_MID_COLOR,
  SPACE_FOG_COLOR,
} from '../domain/constants';
import { clamp01 } from '../domain/math';
import type { ComposerStack } from '../scene/composer_stack';
import type { SceneLighting } from '../scene/scene_lighting';
import type { SunSystemState } from './sun_system';

const backgroundColor = new THREE.Color();
const fogColor = new THREE.Color();

const AMBIENT_SKY_DAY = new THREE.Color(0xc4e2ff);
const AMBIENT_SKY_NIGHT = new THREE.Color(0x6e86bd);
const AMBIENT_GROUND_DAY = new THREE.Color(0x473b28);
const AMBIENT_GROUND_NIGHT = new THREE.Color(0x1f2740);

// Classic THREE.Fog only runs above the volumetric fog band (>72 km), so it
// models the air column seen from near-space rather than ground haze: its
// near edge tracks the top of that column and its span widens toward zero
// density as spaceFactor climbs. With the old fixed ~61 km far plane the
// whole planet sat past full fog from orbit and rendered as a flat ball.
const SPACE_HAZE_DEPTH_METERS = 45_000;
const SPACE_FOG_SPAN_METERS = 61_000;

export interface EnvironmentUpdateInput {
  scene: THREE.Scene;
  defaultFog: THREE.Fog;
  atmosphereMesh: THREE.Mesh;
  lighting: SceneLighting;
  composerStack: ComposerStack;
  planet: Planet;
  camera: THREE.PerspectiveCamera;
  sunState: SunSystemState;
  altitudeMeters: number;
  altitudeFactor: number;
  spaceFactor: number;
  dt: number;
  nowSeconds: number;
  renderScale: number;
  focusPosition: Vec3;
  volumetricEnabled: boolean;
  stationInteriorActive?: boolean;
}

export function updateEnvironment(input: EnvironmentUpdateInput): {
  volumetricSkyActive: boolean;
  planetFogActive: boolean;
  backgroundColor: THREE.Color;
  fogColor: THREE.Color;
} {
  const {
    scene,
    defaultFog,
    atmosphereMesh,
    lighting,
    composerStack,
    planet,
    camera,
    sunState,
    altitudeMeters,
    altitudeFactor,
    spaceFactor,
    dt,
    nowSeconds,
    renderScale,
    focusPosition,
    volumetricEnabled,
    stationInteriorActive = false,
  } = input;

  const {
    normalPass,
    n8aoPass,
    ssaoBaseIntensity,
    ssaoBaseRadius,
    atmospherePass,
    volumetricFogPass,
    volumetricFogEffect,
    spaceSkybox,
    volumetricClouds,
    starField,
  } = composerStack;
  const { ambient, sun } = lighting;
  const { sunDir, daylightFactor, rawDaylight, planetCenter } = sunState;

  volumetricClouds.update(dt, altitudeMeters, focusPosition, volumetricEnabled);
  // isActive is false while the Takram composite is skipped, so the blue
  // scene.background and planet fog stay on (avoids black "space" sky on foot).
  const volumetricSkyActive = volumetricClouds.isActive(altitudeMeters, volumetricEnabled);
  const planetFogActive =
    altitudeMeters < PLANET_FOG_MAX_ALTITUDE_METERS && spaceFactor < 0.9;

  backgroundColor
    .copy(SKY_LOW_COLOR)
    .lerp(SKY_MID_COLOR, clamp01(altitudeMeters / 14_000))
    .lerp(SKY_HIGH_COLOR, spaceFactor);
  backgroundColor.lerp(NIGHT_SKY_COLOR, (1 - daylightFactor) * (1 - spaceFactor));

  fogColor.copy(HAZE_LOW_COLOR).lerp(SKY_LOW_COLOR, 0.18);
  fogColor.lerp(SPACE_FOG_COLOR, spaceFactor * 0.82);
  fogColor.lerp(NIGHT_FOG_COLOR, (1 - daylightFactor) * (1 - spaceFactor));

  const spaceSkyboxActive =
    !volumetricSkyActive && altitudeMeters >= planet.atmosphereHeightMeters;
  // Keep a sky fill while volumetric clouds composite; aerial sky is disabled
  // until WGS84/sphere height parity is solid.
  scene.background = spaceSkyboxActive
    ? spaceSkybox.getBackground(backgroundColor)
    : backgroundColor;
  scene.fog = volumetricSkyActive || planetFogActive ? null : defaultFog;
  if (scene.fog) {
    const hazeTopMeters = Math.max(
      40 + altitudeFactor * 1_200,
      altitudeMeters - SPACE_HAZE_DEPTH_METERS,
    );
    // 0 just above the 72 km handoff, 1 by ~170 km: the haze thins out until
    // the planet reads crisp from orbit and only the atmosphere limb remains.
    const vacuumClearing = clamp01((spaceFactor - 0.31) / 0.55);
    const spanMeters = SPACE_FOG_SPAN_METERS / Math.max(1 - vacuumClearing, 0.002);
    scene.fog.color.copy(fogColor);
    scene.fog.near = hazeTopMeters * renderScale;
    scene.fog.far = (hazeTopMeters + spanMeters) * renderScale;
  }

  // N8AO reconstructs normals from depth; NormalPass only feeds volumetric clouds.
  normalPass.setEnabled(volumetricSkyActive);
  atmospherePass.setEnabled(volumetricSkyActive);
  // Takram aerial perspective already carries haze/sky when the volumetric
  // stack is live; stacking our ground fog on top washes the cloud layer into
  // a flat milky gradient.
  volumetricFogPass.setEnabled(planetFogActive && !volumetricSkyActive);

  // The moon sits opposite the sun, so its elevation is the negated raw
  // daylight; a moonlit night gets a cool ambient lift so it isn't pitch black.
  const moonElevation = Math.max(0, -rawDaylight);
  // Night ambient stays low so moon shadows read; the moon directional light
  // (which is shadowed) does the work of shaping the terrain.
  const moonAmbient = Math.pow(moonElevation, 0.6) * (1 - daylightFactor) * 0.15;
  ambient.intensity =
    (1.3 - spaceFactor * 0.62) * (0.27 + daylightFactor * 0.73 + moonAmbient);
  // Shift the ambient fill toward moonlight blue at night so the scene stays
  // readable but clearly reads as night instead of a dim day.
  ambient.color.copy(AMBIENT_SKY_NIGHT).lerp(AMBIENT_SKY_DAY, daylightFactor);
  ambient.groundColor.copy(AMBIENT_GROUND_NIGHT).lerp(AMBIENT_GROUND_DAY, daylightFactor);
  if (stationInteriorActive) {
    ambient.intensity = Math.max(ambient.intensity, 0.48);
    ambient.color.lerp(AMBIENT_SKY_DAY, 0.16);
    ambient.groundColor.lerp(AMBIENT_GROUND_DAY, 0.2);
    // Station interiors have flat slabs and lots of local fill light, which
    // make raw SSAO read noisy and overdrawn. Keep it tighter than the outdoor
    // preset so it reads as contact shadowing instead of a black outline pass.
    if (n8aoPass) {
      n8aoPass.configuration.intensity = ssaoBaseIntensity;
      n8aoPass.configuration.aoRadius = ssaoBaseRadius * renderScale * 0.6;
    }
  } else if (n8aoPass) {
    n8aoPass.configuration.intensity = ssaoBaseIntensity;
    n8aoPass.configuration.aoRadius = ssaoBaseRadius * renderScale;
  }

  starField.update({
    camera,
    daylightFactor,
    spaceFactor,
    nowSeconds,
  });

  atmosphereMesh.position.copy(planetCenter);
  const atmosphereMaterial = atmosphereMesh.material as THREE.MeshBasicMaterial;
  // Additive atmosphere haze must fade out at night or it washes the whole
  // sky bright blue and drowns out the stars.
  const atmosphereDaylight = 0.03 + 0.97 * daylightFactor;
  atmosphereMaterial.opacity =
    (volumetricSkyActive
      ? 0.04 * (1 - spaceFactor * 0.8)
      : 0.22 * (1 - spaceFactor * 0.86)) * atmosphereDaylight;

  if (planetFogActive) {
    volumetricFogEffect.uniforms.get('uProjectionMatrixInverse')!.value.copy(camera.projectionMatrixInverse);
    volumetricFogEffect.uniforms.get('uCameraMatrixWorld')!.value.copy(camera.matrixWorld);
    volumetricFogEffect.uniforms.get('uPlanetCenter')!.value.copy(planetCenter);
    volumetricFogEffect.uniforms.get('uPlanetRadius')!.value = planet.radiusMeters * renderScale;
    volumetricFogEffect.uniforms.get('uRenderScale')!.value = renderScale;
    volumetricFogEffect.uniforms.get('uSunDirection')!.value.copy(sunDir);
    volumetricFogEffect.uniforms.get('uFogColorDay')!.value.copy(fogColor);
    volumetricFogEffect.uniforms.get('uFogColorNight')!.value.copy(NIGHT_FOG_COLOR);
    volumetricFogEffect.uniforms.get('uSunColor')!.value.copy(sun.color);
    volumetricFogEffect.uniforms.get('uTime')!.value = nowSeconds;
    volumetricFogEffect.uniforms.get('uCameraNear')!.value = camera.near;
    volumetricFogEffect.uniforms.get('uCameraFar')!.value = camera.far;
    volumetricFogEffect.uniforms.get('uDaylightFactor')!.value = daylightFactor;
    volumetricFogEffect.uniforms.get('uSpaceFactor')!.value = spaceFactor;
  }

  return { volumetricSkyActive, planetFogActive, backgroundColor, fogColor };
}

export function setFogSettings(
  volumetricFogEffect: VolumetricFogEffect,
  settings: import('../../../types').FogSettings,
): void {
  if (volumetricFogEffect.uniforms.has('uFogDensity')) {
    volumetricFogEffect.uniforms.get('uFogDensity')!.value = settings.density;
    volumetricFogEffect.uniforms.get('uFogMaxHeight')!.value = settings.maxHeight;
    volumetricFogEffect.uniforms.get('uFogHeightFalloff')!.value = settings.heightFalloff;
    volumetricFogEffect.uniforms.get('uNoiseStrength')!.value = settings.noiseStrength;
  }
}
