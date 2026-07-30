import type * as THREE from 'three';
import type { SceneBackgroundMode, SceneLightingMode } from '../../../world/prefabs/schema';
import type { SceneEnvironmentConfig } from '../../../world/scenes/scene-runtime';
import type { SceneLighting } from './scene-lighting';

/**
 * Decide whether the space equirect skybox should replace the solid
 * background color this frame.
 */
export function resolveSpaceSkyboxActive(input: {
  backgroundMode: SceneBackgroundMode;
  altitudeMeters: number;
  atmosphereHeightMeters: number;
  /** WebGL volumetric clouds own the sky; they exclude the equirect. */
  volumetricSkyActive: boolean;
}): boolean {
  if (input.backgroundMode === 'solid') return false;
  if (input.volumetricSkyActive) return false;
  if (input.backgroundMode === 'space-skybox') return true;
  return input.altitudeMeters >= input.atmosphereHeightMeters;
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
