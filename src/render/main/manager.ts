import * as THREE from 'three';
import type { Planet, RenderStats, SpikeRenderWorld } from '../../types';
import { normalize } from '../../math/vec3';
import { createCharacterAvatar } from '../../player/avatar';
import { createCloudShell, createPlanetLakeWaterManager } from '../effects';
import { createPlanetTileManager } from '../planet_tiles';
import { createPlanetVegetationManager, normalizeVegetationSettings } from '../vegetation';
import { radialUp } from '../../world/coordinates';
import {
  getRenderableSurfaceCacheStats,
  sampleRenderablePlanetSurface,
} from '../../world/planet_surface';
import { clamp01 } from './domain/math';
import { applyRenderQualitySettings } from './domain/apply_render_quality';
import { DAY_LENGTH_SECONDS } from './domain/constants';
import type { RenderMode, SpikeRenderer, TimeOverride } from './domain/types';
import { buildAtmosphereMesh } from './scene/atmosphere_mesh';
import { createComposerStack } from './scene/composer_stack';
import { createShipModel } from './scene/ship_model';
import { createMainCamera, createMainScene, createSceneLighting } from './scene/scene_lighting';
import { createWebGlRenderer } from './scene/webgl_renderer';
import { updateCameraRig, updateSpeedBlur } from './update/camera_rig';
import { setFogSettings as applyFogSettings, updateEnvironment } from './update/environment';
import { updateShipPlacement, updateSunIntensity, updateSunSystem } from './update/sun_system';

export function createSpikeRenderer(
  canvas: HTMLCanvasElement,
  planet: Planet,
  seed: number,
): SpikeRenderer {
  applyRenderQualitySettings();

  const { rendererMode, renderer } = createWebGlRenderer(canvas);

  const scene = createMainScene();
  const defaultFog = scene.fog as THREE.Fog;
  // TEMP DIAGNOSTIC: expose scene + camera for live inspection.
  window.__spikeScene = scene;

  const camera = createMainCamera();
  const cameraTarget = new THREE.Vector3();
  const lighting = createSceneLighting(scene);

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

  const composerStack = createComposerStack(renderer, scene, camera, planet, lighting.sun);

  const atmosphereMesh = buildAtmosphereMesh(planet, tileManager.renderScale);
  scene.add(atmosphereMesh);

  const shipMesh = createShipModel(tileManager.renderScale);
  shipMesh.frustumCulled = false;
  scene.add(shipMesh);

  const avatar = createCharacterAvatar(scene, tileManager.renderScale);

  let lastTime = 0;
  let timeOverride: TimeOverride = 'auto';

  // Sun direction is a function of time: dir(theta) ~ (cos(theta), sin(theta) * 0.364,
  // sin(theta) * 0.939). To force day/night we solve for the theta that points the
  // sun (or moon) straight at the player's local up, so the override works
  // anywhere on the planet.
  function resolveSunTimeSeconds(nowSeconds: number, up: { x: number; y: number; z: number }): number {
    if (timeOverride === 'auto') return nowSeconds;
    let theta = Math.atan2(up.y * 0.364 + up.z * 0.939, up.x);
    if (timeOverride === 'night') theta += Math.PI;
    return (theta / (Math.PI * 2)) * DAY_LENGTH_SECONDS;
  }

  function resize(width: number, height: number): void {
    renderer.setSize(width, height, false);
    camera.aspect = width / height;
    camera.updateProjectionMatrix();
    composerStack.resize(width, height, renderer.getPixelRatio());
  }

  function render(world: SpikeRenderWorld): RenderStats {
    const {
      character = null,
      mode = 'in-ship',
      ship,
      timeSeconds: nowSeconds = 0,
    } = world;

    const renderMode = mode as RenderMode;
    const dt = Math.max(0.0001, Math.min(nowSeconds - lastTime, 0.1));
    lastTime = nowSeconds;

    const focusBody = mode === 'in-ship' || !character ? ship : character;
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

    const sunState = updateSunSystem(
      resolveSunTimeSeconds(nowSeconds, up),
      focusBody.position,
      renderScale,
      renderMode,
      up,
      lighting.sun,
      lighting.sunMesh,
      lighting.moonMesh,
      lighting.moonLight,
    );
    updateSunIntensity(lighting.sun, sunState.rawDaylight, spaceFactor);

    const tileState = tileManager.update(focusBody.position, surface);
    const vegetationStats = vegetationManager.update(
      focusBody.position,
      tileState.selectedTiles,
      surface.altitudeMeters,
      nowSeconds,
    );
    cloudShell.update(focusBody.position, nowSeconds, spaceFactor, surface.altitudeMeters);

    updateShipPlacement(shipMesh, ship, focusBody.position, renderScale);

    const { backgroundColor } = updateEnvironment({
      scene,
      defaultFog,
      atmosphereMesh,
      lighting,
      composerStack,
      planet,
      camera,
      sunState,
      altitudeMeters: surface.altitudeMeters,
      altitudeFactor,
      spaceFactor,
      dt,
      nowSeconds,
      renderScale,
      volumetricEnabled,
    });

    avatar.update(character, focusBody.position, nowSeconds);

    lakeWaterManager.update(
      focusBody.position,
      tileState.selectedTiles,
      sunState.sunDir,
      dt,
      backgroundColor,
    );

    updateCameraRig(camera, cameraTarget, world, renderScale, altitudeFactor, shipUp, shipForward);
    updateSpeedBlur(composerStack.speedBlurEffect, world);

    composerStack.composer.render(dt);

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
      applyFogSettings(composerStack.volumetricFogEffect, settings);
    },
    setTimeOverride(mode) {
      timeOverride = mode;
    },
    dispose() {
      cloudShell.dispose();
      lakeWaterManager.dispose();
      vegetationManager.dispose();
      avatar.dispose();
      tileManager.dispose();
      composerStack.dispose();
      renderer.dispose();
    },
  };
}
