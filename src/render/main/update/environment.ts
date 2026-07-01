import * as THREE from 'three';
import type { Planet } from '../../../types';
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
  volumetricEnabled: boolean;
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
    volumetricEnabled,
  } = input;

  const { ambient, sun } = lighting;
  const { normalPass, atmospherePass, volumetricFogPass, volumetricFogEffect, volumetricClouds, starField } =
    composerStack;
  const { sunDir, daylightFactor, planetCenter } = sunState;

  volumetricClouds.update(dt, altitudeMeters, volumetricEnabled);
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

  scene.background = volumetricSkyActive ? null : backgroundColor;
  scene.fog = volumetricSkyActive || planetFogActive ? null : defaultFog;
  if (scene.fog) {
    scene.fog.color.copy(fogColor);
    scene.fog.near = (40 + altitudeFactor * 1_200) * renderScale;
    scene.fog.far = (900 + altitudeFactor * 60_000) * renderScale;
  }

  normalPass.setEnabled(volumetricSkyActive);
  atmospherePass.setEnabled(volumetricSkyActive);
  volumetricFogPass.setEnabled(planetFogActive);

  ambient.intensity = (1.3 - spaceFactor * 0.62) * (0.3 + daylightFactor * 0.7);

  starField.update({
    camera,
    daylightFactor,
    spaceFactor,
  });

  atmosphereMesh.position.copy(planetCenter);
  const atmosphereMaterial = atmosphereMesh.material as THREE.MeshBasicMaterial;
  atmosphereMaterial.opacity = volumetricSkyActive
    ? 0.04 * (1 - spaceFactor * 0.8)
    : 0.22 * (1 - spaceFactor * 0.86);

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
