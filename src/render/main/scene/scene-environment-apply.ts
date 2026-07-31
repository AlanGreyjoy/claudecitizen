import type * as THREE from 'three';
import type { SceneBackgroundMode, SceneLightingMode } from '../../../world/prefabs/schema';
import type { SceneEnvironmentConfig } from '../../../world/scenes/scene-runtime';
import type { SceneLighting } from './scene-lighting';

/**
 * Decide whether the space equirect skybox should replace the solid
 * background color this frame.
 */
/**
 * Whether the star-field equirect replaces the sky.
 *
 * **Altitude decides this, not the authored background mode.** Inside an
 * atmosphere the sky belongs to the atmosphere renderer — takram's `SkyNode` on
 * WebGPU, volumetric clouds on the WebGL path this replaced — and painting the
 * equirect there produces a black daytime sky over lit ground.
 *
 * An earlier revision short-circuited on `backgroundMode === 'space-skybox'`,
 * which is how that regression shipped: a surface scene authored with that mode
 * got the skybox at ground level. The WebGL original never consulted the mode
 * here at all, only `altitudeMeters >= planet.atmosphereHeightMeters`. Scenes
 * that genuinely want the skybox — Open Space, orbit — are above the atmosphere
 * anyway and still get it.
 */
export function resolveSpaceSkyboxActive(input: {
  backgroundMode: SceneBackgroundMode;
  altitudeMeters: number;
  atmosphereHeightMeters: number;
}): boolean {
  if (input.backgroundMode === 'solid') return false;
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
