import * as THREE from 'three';
import { GLTFLoader } from 'three/examples/jsm/loaders/GLTFLoader';
import type { CharacterRenderState, FogSettings, Planet, RenderStats, SpikeRenderWorld, Vec3 } from '../types';
import { normalize } from '../math/vec3';
import { createCharacterAvatar } from '../player/avatar';
import { resolveCharacterCameraRig, resolveOrbitCamera } from '../player/character_controller';
import { createCloudShell } from './cloud_shell';
import { createPlanetTileManager } from './planet_tile_manager';
import { createPlanetLakeWaterManager } from './planet_lake_water';
import { createPlanetVegetationManager } from './planet_vegetation';
import { normalizeVegetationSettings } from './vegetation_settings';
import { createStarField } from './star_field';
import { createVolumetricCloudManager } from './volumetric_clouds';
import { VolumetricFogEffect } from './volumetric_fog';
import { radialUp } from '../world/coordinates';
import {
  getRenderableSurfaceCacheStats,
  sampleRenderablePlanetSurface,
} from '../world/planet_surface';
import {
  EffectComposer,
  EffectPass,
  RenderPass,
  NormalPass,
  BloomEffect,
  ToneMappingEffect,
  VignetteEffect,
  SMAAEffect,
  Effect,
  EffectAttribute,
  ToneMappingMode,
} from 'postprocessing';

type RenderMode = SpikeRenderWorld['mode'] | 'on-ship-deck';

const SpeedBlurShader = `
  uniform float uStrength;
  uniform vec2 uCenter;

  void mainImage(const in vec4 inputColor, const in vec2 uv, out vec4 outputColor) {
    if (uStrength <= 0.0) {
      outputColor = inputColor;
      return;
    }
    
    vec2 toCenter = uCenter - uv;
    vec4 accumColor = vec4(0.0);
    float totalWeight = 0.0;
    
    const int SAMPLES = 8;
    for (int i = 0; i < SAMPLES; i++) {
      float t = float(i) / float(SAMPLES - 1);
      vec2 offsetUv = uv + toCenter * uStrength * t;
      offsetUv = clamp(offsetUv, 0.0, 1.0);
      
      float weight = 1.0 - (t * 0.5);
      accumColor += texture2D(inputBuffer, offsetUv) * weight;
      totalWeight += weight;
    }
    
    outputColor = accumColor / totalWeight;
  }
`;

class SpeedBlurEffect extends Effect {
  constructor() {
    super('SpeedBlurEffect', SpeedBlurShader, {
      attributes: EffectAttribute.CONVOLUTION,
      uniforms: new Map<string, THREE.Uniform>([
        ['uStrength', new THREE.Uniform(0.0)],
        ['uCenter', new THREE.Uniform(new THREE.Vector2(0.5, 0.5))],
      ]),
    });
  }

  setStrength(value: number): void {
    this.uniforms.get('uStrength')!.value = value;
  }

  setCenter(x: number, y: number): void {
    this.uniforms.get('uCenter')!.value.set(x, y);
  }
}

const SKY_LOW_COLOR = new THREE.Color(0x6ca5e0);
const SKY_MID_COLOR = new THREE.Color(0x284f88);
const SKY_HIGH_COLOR = new THREE.Color(0x01040b);
const HAZE_LOW_COLOR = new THREE.Color(0xb8daf2);
const SPACE_FOG_COLOR = new THREE.Color(0x050915);
const DAY_LENGTH_SECONDS = 240;
const NIGHT_SKY_COLOR = new THREE.Color(0x010205);
const NIGHT_FOG_COLOR = new THREE.Color(0x030610);
const PLANET_FOG_MAX_ALTITUDE_METERS = 72_000;
const shipLookTarget = new THREE.Vector3();
const backgroundColor = new THREE.Color();
const fogColor = new THREE.Color();

type RendererMode = 'log-depth' | 'default-depth' | 'compatibility';

export interface SpikeRenderer {
  rendererMode: RendererMode;
  render: (world: SpikeRenderWorld) => RenderStats;
  resize: (width: number, height: number) => void;
  setVegetationSettings: (nextSettings: Partial<import('../types').VegetationSettings>) => void;
  setFogSettings: (settings: FogSettings) => void;
  dispose: () => void;
}

function v3(v: Vec3): THREE.Vector3 {
  return new THREE.Vector3(v.x, v.y, v.z);
}

function clamp01(value: number): number {
  return Math.max(0, Math.min(1, value));
}

function buildAtmosphereMesh(planet: Planet, renderScale: number): THREE.Mesh {
  return new THREE.Mesh(
    new THREE.SphereGeometry(
      (planet.radiusMeters + planet.atmosphereHeightMeters) * renderScale,
      80,
      56,
    ),
    new THREE.MeshBasicMaterial({
      blending: THREE.AdditiveBlending,
      color: 0x69aef8,
      depthWrite: false,
      opacity: 0.14,
      side: THREE.BackSide,
      transparent: true,
    }),
  );
}

const SHIP_URL = new URL('../assets/ships/Ship_Large.gltf', import.meta.url).href;

function createShipModel(renderScale: number): THREE.Group {
  const group = new THREE.Group();

  const loader = new GLTFLoader();
  const bbox = new THREE.Box3();
  const center = new THREE.Vector3();

  loader.load(
    SHIP_URL,
    (gltf) => {
      const sceneRoot = gltf.scene;
      sceneRoot.rotation.y = Math.PI / 2;
      sceneRoot.scale.setScalar(renderScale);
      sceneRoot.traverse((object) => {
        object.frustumCulled = false;
        if (object instanceof THREE.Mesh) {
          object.castShadow = true;
          object.receiveShadow = true;
        }
      });
      bbox.setFromObject(sceneRoot);
      bbox.getCenter(center);
      sceneRoot.position.sub(center);
      group.add(sceneRoot);
    },
    undefined,
    (error) => {
      console.error('ClaudeCitizen ship load failed.', error);
    },
  );

  return group;
}

export function createSpikeRenderer(
  canvas: HTMLCanvasElement,
  planet: Planet,
  seed: number,
): SpikeRenderer {
  let rendererMode: RendererMode = 'log-depth';
  let renderer: THREE.WebGLRenderer;
  try {
    renderer = new THREE.WebGLRenderer({
      antialias: true,
      canvas,
      logarithmicDepthBuffer: true,
      powerPreference: 'high-performance',
    });
  } catch {
    try {
      rendererMode = 'default-depth';
      renderer = new THREE.WebGLRenderer({
        antialias: true,
        canvas,
        powerPreference: 'high-performance',
      });
    } catch {
      rendererMode = 'compatibility';
      renderer = new THREE.WebGLRenderer({
        antialias: false,
        canvas,
      });
    }
  }
  renderer.setPixelRatio(Math.min(window.devicePixelRatio || 1, 2));
  renderer.outputColorSpace = THREE.SRGBColorSpace;
  renderer.shadowMap.enabled = true;
  renderer.shadowMap.type = THREE.PCFSoftShadowMap;

  const scene = new THREE.Scene();
  scene.background = SKY_HIGH_COLOR.clone();
  scene.fog = new THREE.Fog(0xb8daf2, 240, 2600);
  const defaultFog = scene.fog;
  // TEMP DIAGNOSTIC: expose scene + camera for live inspection.
  window.__spikeScene = scene;

  const camera = new THREE.PerspectiveCamera(72, 1, 0.0001, 500_000);
  const cameraTarget = new THREE.Vector3();

  const ambient = new THREE.HemisphereLight(0xc4e2ff, 0x261b12, 1.05);
  scene.add(ambient);

  const sun = new THREE.DirectionalLight(0xfff1d2, 1.8);
  sun.castShadow = true;
  sun.shadow.mapSize.width = 2048;
  sun.shadow.mapSize.height = 2048;
  sun.shadow.bias = -0.0003;
  scene.add(sun);
  scene.add(sun.target);

  const sunMesh = new THREE.Mesh(
    new THREE.SphereGeometry(12000, 32, 32),
    new THREE.MeshBasicMaterial({ color: 0xfff1d2, fog: false }),
  );
  scene.add(sunMesh);

  const tileManager = createPlanetTileManager(scene, planet, seed);
  const lakeWaterManager = createPlanetLakeWaterManager(
    scene,
    planet,
    seed,
    tileManager.renderScale,
  );
  const vegetationManager = createPlanetVegetationManager(
    scene,
    planet,
    seed,
    tileManager.renderScale,
  );
  const cloudShell = createCloudShell(scene, planet, seed, tileManager.renderScale);

  // Setup main EffectComposer
  const composer = new EffectComposer(renderer, {
    frameBufferType: THREE.HalfFloatType,
    multisampling: 0,
  });

  const renderPass = new RenderPass(scene, camera);
  composer.addPass(renderPass);

  const normalPass = new NormalPass(scene, camera);
  composer.addPass(normalPass);

  const volumetricClouds = createVolumetricCloudManager(renderer, scene, camera, planet, sun, normalPass);
  const starField = createStarField(scene);

  const atmospherePass = new EffectPass(
    camera,
    volumetricClouds.cloudsEffect,
    volumetricClouds.aerialPerspectiveEffect,
  );
  composer.addPass(atmospherePass);

  const volumetricFogEffect = new VolumetricFogEffect(camera, {
    useLogarithmicDepth: renderer.capabilities.logarithmicDepthBuffer,
  });
  const volumetricFogPass = new EffectPass(camera, volumetricFogEffect);
  composer.addPass(volumetricFogPass);

  const bloomEffect = new BloomEffect({
    intensity: 1.2,
    luminanceThreshold: 0.85,
    mipmapBlur: true,
  });
  const bloomPass = new EffectPass(camera, bloomEffect);
  composer.addPass(bloomPass);

  const speedBlurEffect = new SpeedBlurEffect();
  const speedBlurPass = new EffectPass(camera, speedBlurEffect);
  composer.addPass(speedBlurPass);

  const toneMappingEffect = new ToneMappingEffect({
    mode: ToneMappingMode.ACES_FILMIC,
  });
  const vignetteEffect = new VignetteEffect({
    darkness: 0.45,
    offset: 0.25,
  });
  const lensPass = new EffectPass(camera, toneMappingEffect, vignetteEffect);
  composer.addPass(lensPass);

  const smaaEffect = new SMAAEffect();
  const smaaPass = new EffectPass(camera, smaaEffect);
  smaaPass.renderToScreen = true;
  composer.addPass(smaaPass);

  const atmosphereMesh = buildAtmosphereMesh(planet, tileManager.renderScale);
  scene.add(atmosphereMesh);

  const shipMesh = createShipModel(tileManager.renderScale);
  shipMesh.frustumCulled = false;
  scene.add(shipMesh);

  const avatar = createCharacterAvatar(scene, tileManager.renderScale);

  let lastTime = 0;

  function resize(width: number, height: number): void {
    renderer.setSize(width, height, false);
    camera.aspect = width / height;
    camera.updateProjectionMatrix();
    composer.setSize(width, height);
    const pixelRatio = renderer.getPixelRatio();
    normalPass.setSize(width * pixelRatio, height * pixelRatio);
  }

  function placeShip(
    ship: SpikeRenderWorld['ship'],
    focusPosition: Vec3,
    renderScale: number,
  ): void {
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

  function render(world: SpikeRenderWorld): RenderStats {
    const {
      cameraOrbit = { pitchRadians: -0.35, yawRadians: 0, zoomDistance: 7.4 },
      character = null,
      mode = 'in-ship',
      ship,
      shipCameraZoom = 1.0,
      timeSeconds: nowSeconds = 0,
    } = world;

    const renderMode = mode as RenderMode;
    const dt = Math.max(0.0001, Math.min(nowSeconds - lastTime, 0.1));
    lastTime = nowSeconds;

    const focusBody =
      mode === 'in-ship' || !character ? ship : character;
    const volumetricEnabled = true;
    const surface = sampleRenderablePlanetSurface(planet, seed, focusBody.position);
    const up = radialUp(focusBody.position);
    const shipUp = normalize(ship.up ?? radialUp(ship.position));
    const shipForward = normalize(ship.forward);
    const altitudeFactor = clamp01(surface.altitudeMeters / planet.atmosphereHeightMeters);
    const spaceFactor = clamp01(
      (surface.altitudeMeters - 18_000) / (planet.atmosphereHeightMeters * 1.6),
    );
    const renderScale = tileManager.renderScale;

    const theta = (nowSeconds / DAY_LENGTH_SECONDS) * Math.PI * 2;
    const sunDist = 120_000 * renderScale;
    const sunDir = new THREE.Vector3(
      Math.cos(theta),
      Math.sin(theta) * 0.364,
      Math.sin(theta) * 0.939,
    ).normalize();
    const planetCenter = new THREE.Vector3(
      -focusBody.position.x * renderScale,
      -focusBody.position.y * renderScale,
      -focusBody.position.z * renderScale,
    );
    sunMesh.position.copy(planetCenter).add(sunDir.clone().multiplyScalar(sunDist));

    // Position sun light dynamically relative to camera for shadow map resolution
    const shadowDist = (renderMode === 'on-foot' || renderMode === 'on-ship-deck' ? 200 : 1500) * renderScale;
    sun.position.copy(sunDir).multiplyScalar(shadowDist);
    sun.target.position.set(0, 0, 0);

    if (renderMode === 'on-foot' || renderMode === 'on-ship-deck') {
      const shadowSize = 35 * renderScale; // 35 meters around character
      sun.shadow.camera.left = -shadowSize;
      sun.shadow.camera.right = shadowSize;
      sun.shadow.camera.top = shadowSize;
      sun.shadow.camera.bottom = -shadowSize;
      sun.shadow.camera.near = 0.1;
      sun.shadow.camera.far = 1000 * renderScale;
    } else {
      const shadowSize = 500 * renderScale; // 500 meters around ship
      sun.shadow.camera.left = -shadowSize;
      sun.shadow.camera.right = shadowSize;
      sun.shadow.camera.top = shadowSize;
      sun.shadow.camera.bottom = -shadowSize;
      sun.shadow.camera.near = 0.1;
      sun.shadow.camera.far = 3000 * renderScale;
    }
    sun.shadow.camera.updateProjectionMatrix();

    const rawDaylight = sunDir.dot(up);
    const daylightFactor = clamp01(rawDaylight + 0.2);

    const tileState = tileManager.update(focusBody.position, surface);
    const vegetationStats = vegetationManager.update(
      focusBody.position,
      tileState.selectedTiles,
      surface.altitudeMeters,
    );
    cloudShell.update(focusBody.position, nowSeconds, spaceFactor, surface.altitudeMeters);
    atmosphereMesh.position.copy(planetCenter);

    placeShip(ship, focusBody.position, renderScale);
    avatar.update(character, focusBody.position, nowSeconds);

    backgroundColor
      .copy(SKY_LOW_COLOR)
      .lerp(SKY_MID_COLOR, clamp01(surface.altitudeMeters / 14_000))
      .lerp(SKY_HIGH_COLOR, spaceFactor);
    backgroundColor.lerp(NIGHT_SKY_COLOR, (1 - daylightFactor) * (1 - spaceFactor));

    fogColor.copy(HAZE_LOW_COLOR).lerp(SKY_LOW_COLOR, 0.18);
    fogColor.lerp(SPACE_FOG_COLOR, spaceFactor * 0.82);
    fogColor.lerp(NIGHT_FOG_COLOR, (1 - daylightFactor) * (1 - spaceFactor));

    lakeWaterManager.update(
      focusBody.position,
      tileState.selectedTiles,
      sunDir,
      dt,
      backgroundColor,
    );

    volumetricClouds.update(dt, surface.altitudeMeters, volumetricEnabled);
    const volumetricSkyActive = volumetricClouds.isActive(
      surface.altitudeMeters,
      volumetricEnabled,
    );
    const planetFogActive =
      surface.altitudeMeters < PLANET_FOG_MAX_ALTITUDE_METERS && spaceFactor < 0.9;

    scene.background = volumetricSkyActive ? null : backgroundColor;
    // Volumetric fog handles planet haze; scene fog double-stacks and washes to white.
    scene.fog = volumetricSkyActive || planetFogActive ? null : defaultFog;
    if (scene.fog) {
      scene.fog.color.copy(fogColor);
      scene.fog.near = (40 + altitudeFactor * 1_200) * renderScale;
      scene.fog.far = (900 + altitudeFactor * 60_000) * renderScale;
    }

    // Toggle atmosphere passes
    normalPass.setEnabled(volumetricSkyActive);
    atmospherePass.setEnabled(volumetricSkyActive);

    // Volumetric fog pass toggled after camera is positioned below.
    volumetricFogPass.setEnabled(planetFogActive);

    ambient.intensity = (1.3 - spaceFactor * 0.62) * (0.3 + daylightFactor * 0.7);
    sun.intensity = (1.65 + spaceFactor * 0.55) * clamp01(rawDaylight * 2.0 + 0.2);
    starField.update({
      camera,
      daylightFactor,
      spaceFactor,
    });
    const atmosphereMaterial = atmosphereMesh.material as THREE.MeshBasicMaterial;
    atmosphereMaterial.opacity = volumetricSkyActive
      ? 0.04 * (1 - spaceFactor * 0.8)
      : 0.22 * (1 - spaceFactor * 0.86);

    if (mode === 'in-ship' || !character) {
      const zoom = shipCameraZoom ?? 1.0;
      const cameraBackMeters = (58 + altitudeFactor * 180) * zoom;
      const cameraUpMeters = (9 + altitudeFactor * 136) * zoom;
      const cameraOffset = new THREE.Vector3(
        (-shipForward.x * cameraBackMeters + shipUp.x * cameraUpMeters) * renderScale,
        (-shipForward.y * cameraBackMeters + shipUp.y * cameraUpMeters) * renderScale,
        (-shipForward.z * cameraBackMeters + shipUp.z * cameraUpMeters) * renderScale,
      );
      camera.position.lerp(cameraOffset, 0.12);
      cameraTarget.lerp(
        new THREE.Vector3(
          (shipForward.x * (170 + altitudeFactor * 340) + shipUp.x * (-6 + altitudeFactor * 52)) *
            renderScale,
          (shipForward.y * (170 + altitudeFactor * 340) + shipUp.y * (-6 + altitudeFactor * 52)) *
            renderScale,
          (shipForward.z * (170 + altitudeFactor * 340) + shipUp.z * (-6 + altitudeFactor * 52)) *
            renderScale,
        ),
        0.16,
      );
      camera.up.copy(v3(shipUp));
    } else {
      const orbit = resolveOrbitCamera(
        character.position,
        cameraOrbit.yawRadians,
        cameraOrbit.pitchRadians,
      );
      const zoomDistance = cameraOrbit.zoomDistance ?? 7.4;
      const rig = resolveCharacterCameraRig(orbit, zoomDistance);
      const cameraOffset = new THREE.Vector3(
        rig.positionOffset.x * renderScale,
        rig.positionOffset.y * renderScale,
        rig.positionOffset.z * renderScale,
      );
      camera.position.lerp(cameraOffset, 0.18);
      cameraTarget.lerp(
        new THREE.Vector3(
          rig.targetOffset.x * renderScale,
          rig.targetOffset.y * renderScale,
          rig.targetOffset.z * renderScale,
        ),
        0.24,
      );
      camera.up.copy(v3(orbit.up));
    }
    camera.lookAt(cameraTarget);
    camera.updateMatrixWorld();

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

    // Update SpeedBlur
    const focusVelocity =
      mode === 'in-ship'
        ? ship.velocity
        : (character as CharacterRenderState & { velocity?: Vec3 })!.velocity;
    const speed = focusVelocity ? Math.hypot(focusVelocity.x, focusVelocity.y, focusVelocity.z) : 0;
    if (mode === 'in-ship') {
      const t = clamp01((speed - 120) / 1000);
      speedBlurEffect.setStrength(t * 0.045);
    } else {
      const t = clamp01((speed - 6) / 10);
      speedBlurEffect.setStrength(t * 0.012);
    }

    composer.render(dt);

    const renderStats: RenderStats = {
      surfaceCache: getRenderableSurfaceCacheStats(),
      terrain: tileState.stats,
      vegetation: vegetationStats,
    };
    window.__claudecitizenRenderStats = renderStats;
    return renderStats;
  }

  return {
    rendererMode,
    render,
    resize,
    setVegetationSettings(nextSettings) {
      vegetationManager.setSettings(normalizeVegetationSettings(nextSettings));
    },
    setFogSettings(settings) {
      if (volumetricFogEffect && volumetricFogEffect.uniforms.has('uFogDensity')) {
        volumetricFogEffect.uniforms.get('uFogDensity')!.value = settings.density;
        volumetricFogEffect.uniforms.get('uFogMaxHeight')!.value = settings.maxHeight;
        volumetricFogEffect.uniforms.get('uFogHeightFalloff')!.value = settings.heightFalloff;
        volumetricFogEffect.uniforms.get('uNoiseStrength')!.value = settings.noiseStrength;
      }
    },
    dispose() {
      starField.dispose();
      cloudShell.dispose();
      lakeWaterManager.dispose();
      volumetricClouds.dispose();
      vegetationManager.dispose();
      avatar.dispose();
      tileManager.dispose();
      composer.dispose();
      renderer.dispose();
    },
  };
}
