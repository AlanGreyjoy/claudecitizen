import type * as THREE from 'three';
import type { SceneBackgroundMode, SceneLightingMode } from '../../../world/prefabs/schema';
import type { SceneEnvironmentConfig } from '../../../world/scenes/scene-runtime';
import type { SceneLighting } from './scene-lighting';

/**
 * Whether the star-field equirect replaces the sky fill.
 *
 * - `solid` — never
 * - `space-skybox` — always (station/hab/open-space authoring; matches editor viewport)
 * - `auto` — only above the atmosphere (orbit / open space)
 *
 * When this is true, the gameplay post stack must also suppress takram's
 * `SkyNode` on far pixels — otherwise aerial perspective paints atmosphere (or
 * black LUTs) over the nebula and Play looks skybox-less while the editor,
 * which has no atmosphere pass, shows it fine.
 */
export function resolveSpaceSkyboxActive(input: {
  backgroundMode: SceneBackgroundMode;
  altitudeMeters: number;
  atmosphereHeightMeters: number;
}): boolean {
  if (input.backgroundMode === 'solid') return false;
  if (input.backgroundMode === 'space-skybox') return true;
  return input.altitudeMeters >= input.atmosphereHeightMeters;
}

/**
 * Whether takram's `SkyNode` owns far pixels this frame.
 *
 * When it does, the sky draws its own scattered sun disc and phase-shaded
 * moon, so the scene-space `sunMesh` / `moonMesh` bodies must be hidden or the
 * player sees each body twice at different sizes. The exact inverse of the
 * suppression test in `createWebGpuAtmospherePost`; both read it from here so
 * the two decisions cannot drift apart.
 */
export function resolveAtmosphereSkyActive(input: {
  backgroundMode: SceneBackgroundMode;
  altitudeMeters: number;
  atmosphereHeightMeters: number;
}): boolean {
  if (input.backgroundMode === 'solid') return false;
  if (input.backgroundMode === 'space-skybox') return false;
  return input.altitudeMeters < input.atmosphereHeightMeters;
}

/** Mute / restore celestial lights after the outdoor sun-system pass. */
export function applySceneLightingMode(
  lighting: SceneLighting,
  lightingMode: SceneLightingMode,
): void {
  const celestialVisible = lightingMode === 'outdoor';
  lighting.sunMesh.visible = celestialVisible;
  lighting.moonMesh.visible = celestialVisible;
  if (lightingMode === 'outdoor') return;

  lighting.sun.intensity = 0;
  lighting.sun.castShadow = false;
  lighting.moonLight.intensity = 0;
  lighting.moonLight.castShadow = false;
}

export function applyAmbientOverrides(
  ambient: THREE.HemisphereLight,
  environment: SceneEnvironmentConfig,
  options: { forceInteriorFloor: boolean },
): void {
  if (environment.lightingMode === 'off') {
    ambient.intensity = 0;
    return;
  }

  if (options.forceInteriorFloor || environment.lightingMode === 'interior') {
    ambient.intensity = Math.max(ambient.intensity, 0.48);
  }

  ambient.intensity *= environment.ambientIntensityScale;

  if (environment.ambientSkyColor) {
    ambient.color.set(environment.ambientSkyColor);
  }
  if (environment.ambientGroundColor) {
    ambient.groundColor.set(environment.ambientGroundColor);
  }
}
