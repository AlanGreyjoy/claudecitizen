import * as THREE from 'three';
import type { Planet, Vec3 } from '../../../types';
import type { SceneEnvironmentConfig } from '../../../world/scenes/scene-runtime';
import { DEFAULT_SCENE_ENVIRONMENT } from '../../../world/scenes/scene-runtime';
import {
  HAZE_LOW_COLOR,
  PLANET_FOG_MAX_ALTITUDE_METERS,
  SKY_HIGH_COLOR,
  SKY_LOW_COLOR,
  SKY_MID_COLOR,
  SPACE_FOG_COLOR,
} from '../domain/constants';
import { clamp01 } from '../domain/math';
import { resolveSkyPalette, resolveSkyRecipe } from '../domain/sky-recipe';
import type { MainPostStack } from '../post/types';
import {
  applyAmbientOverrides,
  applySceneLightingMode,
  resolveAtmosphereSkyActive,
} from '../scene/scene-environment-apply';
import type { SceneLighting } from '../scene/scene-lighting';
import type { SunSystemState } from './sun-system';

const backgroundColor = new THREE.Color();
const fogColor = new THREE.Color();

const AMBIENT_SKY_DAY = new THREE.Color(0xc4e2ff);
const AMBIENT_GROUND_DAY = new THREE.Color(0x473b28);

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
  /** Null for scenes with no planet, which have no atmosphere shell to fade. */
  atmosphereMesh: THREE.Mesh | null;
  lighting: SceneLighting;
  postStack: MainPostStack;
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
  /** Normalized scene overrides; outdoor + auto when the scene never authored one. */
  sceneEnvironment?: SceneEnvironmentConfig;
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
    postStack,
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
    sceneEnvironment = DEFAULT_SCENE_ENVIRONMENT,
  } = input;

  const { sun } = lighting;
  const { sunDir, daylightFactor, planetCenter } = sunState;
  const skyRecipe = resolveSkyRecipe();
  const skyPalette = resolveSkyPalette(skyRecipe);
  // Deliberately not gated on `lightingMode`: an interior-lit scene can still
  // sit under an authored sky, and the post stack's suppression test has never
  // looked at the lighting mode. Mesh visibility is where the mode matters,
  // and `applySceneLightingMode` already owns that.
  const atmosphereSkyActive = resolveAtmosphereSkyActive({
    backgroundMode: sceneEnvironment.backgroundMode,
    altitudeMeters,
    atmosphereHeightMeters: planet.atmosphereHeightMeters,
  });

  const planetFogActive =
    altitudeMeters < PLANET_FOG_MAX_ALTITUDE_METERS && spaceFactor < 0.9
    && sceneEnvironment.backgroundMode === 'auto'
    && sceneEnvironment.lightingMode === 'outdoor';

  backgroundColor
    .copy(SKY_LOW_COLOR)
    .lerp(SKY_MID_COLOR, clamp01(altitudeMeters / 14_000))
    .lerp(SKY_HIGH_COLOR, spaceFactor);
  backgroundColor.lerp(
    skyPalette.nightAirglow,
    (1 - daylightFactor) * (1 - spaceFactor),
  );
  if (sceneEnvironment.backgroundMode === 'solid') {
    backgroundColor.set(sceneEnvironment.backgroundColor);
  }

  fogColor.copy(HAZE_LOW_COLOR).lerp(SKY_LOW_COLOR, 0.18);
  fogColor.lerp(SPACE_FOG_COLOR, spaceFactor * 0.82);
  fogColor.lerp(skyPalette.nightFog, (1 - daylightFactor) * (1 - spaceFactor));

  const { background, volumetricSkyActive } = postStack.updateEnvironment({
    camera,
    dt,
    altitudeMeters,
    atmosphereHeightMeters: planet.atmosphereHeightMeters,
    focusPosition,
    volumetricEnabled,
    planetFogActive,
    stationInteriorActive:
      stationInteriorActive || sceneEnvironment.lightingMode === 'interior',
    renderScale,
    planetCenter,
    planetRadiusMeters: planet.radiusMeters,
    sunDirection: sunDir,
    moonDirection: sunState.moonDir,
    moonOrbitNormal: sunState.moonOrbitNormal,
    atmosphereSkyActive,
    backgroundColor,
    fogColorDay: fogColor,
    fogColorNight: skyPalette.nightFog,
    sunColor: sun.color,
    nowSeconds,
    daylightFactor,
    spaceFactor,
    backgroundMode: sceneEnvironment.backgroundMode,
  });

  // Keep a sky fill while volumetric clouds composite; aerial sky is disabled
  // until WGS84/sphere height parity is solid.
  scene.background = background;
  scene.fog = volumetricSkyActive || planetFogActive ? null : defaultFog;
  if (
    sceneEnvironment.backgroundMode === 'solid'
    || sceneEnvironment.backgroundMode === 'space-skybox'
  ) {
    scene.fog = null;
  }
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

  applyCelestialAmbient({
    lighting,
    sunState,
    spaceFactor,
    stationInteriorActive,
    sceneEnvironment,
  });
  applySceneLightingMode(lighting, sceneEnvironment.lightingMode);

  // One sun and one moon per frame. Under the atmosphere the SkyNode draws both
  // — scattered, reddened at the horizon, and phase-shaded — so the scene-space
  // bodies must go; above it (and for authored skybox backgrounds) the SkyNode
  // is off and these meshes are the only sun and moon there is.
  lighting.sunMesh.visible = lighting.sunMesh.visible && !atmosphereSkyActive;
  lighting.moonMesh.visible =
    lighting.moonMesh.visible && !atmosphereSkyActive && skyRecipe.moon.enabled;

  applyAtmosphereShell(atmosphereMesh, {
    planetCenter,
    atmosphereSkyActive,
    sceneEnvironment,
    daylightFactor,
    spaceFactor,
    volumetricSkyActive,
  });

  return { volumetricSkyActive, planetFogActive, backgroundColor, fogColor };
}

interface CelestialAmbientInput {
  lighting: SceneLighting;
  sunState: SunSystemState;
  spaceFactor: number;
  stationInteriorActive: boolean;
  sceneEnvironment: SceneEnvironmentConfig;
}

/** Hemisphere fill: authored night floor, moonlight lift, interior override. */
function applyCelestialAmbient(input: CelestialAmbientInput): void {
  const { ambient } = input.lighting;
  const { daylightFactor } = input.sunState;
  const skyRecipe = resolveSkyRecipe();
  const skyPalette = resolveSkyPalette(skyRecipe);

  // Moonlight lifts the night ambient in proportion to how high and how full
  // the moon is, so a new moon really is darker than a full one.
  const moonAmbient = input.sunState.moonAboveHorizon
    ? Math.pow(input.sunState.moonElevation, 0.6)
      * (0.3 + input.sunState.moonIllumination * 0.7)
      * (1 - daylightFactor)
      * 0.2
    : 0;
  // Night ambient stays low so moon shadows read; the moon directional light
  // (which is shadowed) does the work of shaping the terrain. The authored
  // floor is what keeps an unlit night readable instead of pure black.
  const nightAmbient = skyRecipe.night.ambientIntensity;
  ambient.intensity =
    (1.3 - input.spaceFactor * 0.62)
    * (nightAmbient + daylightFactor * (1 - nightAmbient) + moonAmbient);
  // Shift the ambient fill toward moonlight blue at night so the scene stays
  // readable but clearly reads as night instead of a dim day.
  ambient.color
    .copy(skyPalette.nightAmbientSky)
    .lerp(AMBIENT_SKY_DAY, daylightFactor);
  ambient.groundColor
    .copy(skyPalette.nightAmbientGround)
    .lerp(AMBIENT_GROUND_DAY, daylightFactor);
  if (input.stationInteriorActive) {
    ambient.intensity = Math.max(ambient.intensity, 0.48);
    ambient.color.lerp(AMBIENT_SKY_DAY, 0.16);
    ambient.groundColor.lerp(AMBIENT_GROUND_DAY, 0.2);
  }
  applyAmbientOverrides(ambient, input.sceneEnvironment, {
    forceInteriorFloor: false,
  });
}

interface AtmosphereShellInput {
  planetCenter: THREE.Vector3;
  atmosphereSkyActive: boolean;
  sceneEnvironment: SceneEnvironmentConfig;
  daylightFactor: number;
  spaceFactor: number;
  volumetricSkyActive: boolean;
}

/** The additive limb shell — an orbital-only effect since the sky pass landed. */
function applyAtmosphereShell(
  atmosphereMesh: THREE.Mesh | null,
  input: AtmosphereShellInput,
): void {
  if (!atmosphereMesh) return;
  atmosphereMesh.position.copy(input.planetCenter);
  const material = atmosphereMesh.material as THREE.MeshBasicMaterial;
  const suppressed =
    input.atmosphereSkyActive
    || input.sceneEnvironment.lightingMode !== 'outdoor'
    || input.sceneEnvironment.backgroundMode === 'solid'
    || input.sceneEnvironment.backgroundMode === 'space-skybox';
  if (suppressed) {
    // Inside the atmosphere this additive shell is a second, non-physical blue
    // wash on top of the scattering solve — it is what flattened the daytime
    // sky. Only the orbital limb needs it now.
    material.opacity = 0;
    return;
  }
  // Additive atmosphere haze must fade out at night or it washes the whole sky
  // bright blue and drowns out the stars.
  const atmosphereDaylight = 0.03 + 0.97 * input.daylightFactor;
  material.opacity =
    (input.volumetricSkyActive
      ? 0.04 * (1 - input.spaceFactor * 0.8)
      : 0.22 * (1 - input.spaceFactor * 0.86)) * atmosphereDaylight;
}
