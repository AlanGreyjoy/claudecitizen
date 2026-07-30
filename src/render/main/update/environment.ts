import * as THREE from 'three';
import type { Planet, Vec3 } from '../../../types';
import type { SceneEnvironmentConfig } from '../../../world/scenes/scene-runtime';
import { DEFAULT_SCENE_ENVIRONMENT } from '../../../world/scenes/scene-runtime';
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
import type { MainPostStack } from '../post/types';
import {
  applyAmbientOverrides,
  applySceneLightingMode,
} from '../scene/scene-environment-apply';
import type { SceneLighting } from '../scene/scene-lighting';
import type { SunSystemState } from './sun-system';

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

  const { ambient, sun } = lighting;
  const { sunDir, daylightFactor, rawDaylight, planetCenter } = sunState;

  const planetFogActive =
    altitudeMeters < PLANET_FOG_MAX_ALTITUDE_METERS && spaceFactor < 0.9
    && sceneEnvironment.backgroundMode === 'auto'
    && sceneEnvironment.lightingMode === 'outdoor';

  backgroundColor
    .copy(SKY_LOW_COLOR)
    .lerp(SKY_MID_COLOR, clamp01(altitudeMeters / 14_000))
    .lerp(SKY_HIGH_COLOR, spaceFactor);
  backgroundColor.lerp(NIGHT_SKY_COLOR, (1 - daylightFactor) * (1 - spaceFactor));
  if (sceneEnvironment.backgroundMode === 'solid') {
    backgroundColor.set(sceneEnvironment.backgroundColor);
  }

  fogColor.copy(HAZE_LOW_COLOR).lerp(SKY_LOW_COLOR, 0.18);
  fogColor.lerp(SPACE_FOG_COLOR, spaceFactor * 0.82);
  fogColor.lerp(NIGHT_FOG_COLOR, (1 - daylightFactor) * (1 - spaceFactor));

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
    backgroundColor,
    fogColorDay: fogColor,
    fogColorNight: NIGHT_FOG_COLOR,
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
  if (sceneEnvironment.backgroundMode === 'solid') {
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
  }
  applyAmbientOverrides(ambient, sceneEnvironment, {
    forceInteriorFloor: false,
  });
  applySceneLightingMode(lighting, sceneEnvironment.lightingMode);

  if (atmosphereMesh) {
    atmosphereMesh.position.copy(planetCenter);
    const atmosphereMaterial = atmosphereMesh.material as THREE.MeshBasicMaterial;
    if (
      sceneEnvironment.lightingMode !== 'outdoor'
      || sceneEnvironment.backgroundMode === 'solid'
    ) {
      atmosphereMaterial.opacity = 0;
    } else {
      // Additive atmosphere haze must fade out at night or it washes the whole
      // sky bright blue and drowns out the stars.
      const atmosphereDaylight = 0.03 + 0.97 * daylightFactor;
      atmosphereMaterial.opacity =
        (volumetricSkyActive
          ? 0.04 * (1 - spaceFactor * 0.8)
          : 0.22 * (1 - spaceFactor * 0.86)) * atmosphereDaylight;
    }
  }

  return { volumetricSkyActive, planetFogActive, backgroundColor, fogColor };
}
