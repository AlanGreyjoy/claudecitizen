import * as THREE from 'three';
import type {
  Planet,
  RenderStats,
  SpikeRenderWorld,
  SsaoSettings,
  Vec3,
} from '../../types';
import { distance } from '../../math/vec3';
import { createCharacterAvatar } from './scene/character_avatar';
import { createCloudShell, createPlanetSurfaceWaterManager } from '../effects';
import { createPlanetTileManager } from '../planet_tiles';
import { createPlanetVegetationManager, normalizeVegetationSettings } from '../vegetation';
import { createSurfaceSpawnManager } from '../surface_spawns';
import { applyRenderQualitySettings } from './domain/apply_render_quality';
import { DAY_LENGTH_SECONDS, SURFACE_MAX_PIXEL_RATIO } from './domain/constants';
import type { SpikeRenderer, TimeOverride } from './domain/types';
import { getStationFrame, type StationFrame } from '../../world/station';
import {
  createPrefabStationGroup,
} from '../prefabs/prefab_renderer';
import type { PrefabDocument } from '../../world/prefabs/schema';
import { buildAtmosphereMesh } from './scene/atmosphere_mesh';
import { createComposerStack } from './scene/composer_stack';
import { createShipRenderPool } from './scene/ship_render_pool';
import { createRemotePresenceRenderer } from './scene/remote_presence';
import { createStationNpcRenderer } from './scene/station_npcs';
import { createStationModel } from './scene/station_model';
import { createMainCamera, createMainScene, createSceneLighting } from './scene/scene_lighting';
import { createWebGlRenderer } from './scene/webgl_renderer';
import { resolveRenderQuality } from './domain/render_quality';
import {
  resolveColorCorrectionSettings,
  saveColorCorrectionSettings,
} from './domain/color_correction';
import { setFogSettings as applyFogSettings } from './update/environment';
import { createQuantumBubble } from '../effects/quantum_bubble';
import type { PlayerCharacterAppearanceV1 } from '../../player/character_creator/player_character_appearance';
import {
  GAME_SETTINGS_CHANGED_EVENT,
  loadGameSettings,
  type CloudModeSetting,
  type GameSettings,
} from '../../settings/game_settings';
import { createMuzzleFlashRenderer } from '../effects/muzzle_flash';
import { createHitDecalRenderer } from '../effects/hit_decals';
import { createTracerRenderer } from '../effects/tracers';
import {
  executeSpikeRenderFrame,
  type SpikeRenderFrameDeps,
  type SpikeRenderFrameState,
  QUANTUM_RENDER_LAYER,
  enableRenderLayer,
} from './render_spike_frame';

// A full protected station can carry multiple gigabytes of decoded atlas data.
// Distant stations already have System Map/nav markers, so load their detailed
// prefab only once the player is close enough for the mesh to matter.
const SECONDARY_STATION_LOAD_DISTANCE_METERS = 75_000;

export interface SpikeRendererOptions {
  /** Dev preview: render this prefab as the orbital station instead of the procedural model. */
  stationPrefab?: PrefabDocument | null;
  /**
   * Extra station prefab roots for other System Map instances around the active
   * planet. Visual + placement only — primary station still owns walk physics.
   */
  additionalStations?: Array<{ prefab: PrefabDocument; frame: StationFrame }> | null;
  characterAppearance?: PlayerCharacterAppearanceV1 | null;
}

export function createSpikeRenderer(
  canvas: HTMLCanvasElement,
  planet: Planet,
  seed: number,
  options?: SpikeRendererOptions,
): SpikeRenderer {
  applyRenderQualitySettings();
  const renderQuality = resolveRenderQuality();

  const { rendererMode, renderer } = createWebGlRenderer(canvas);

  const scene = createMainScene();
  const defaultFog = scene.fog as THREE.Fog;
  // TEMP DIAGNOSTIC: expose scene + camera for live inspection.
  window.__spikeScene = scene;

  const camera = createMainCamera();
  const cameraTarget = new THREE.Vector3();
  const weaponMarkerPosition = new THREE.Vector3();
  const weaponMarkerForward = new THREE.Vector3();
  const weaponMarkerQuaternion = new THREE.Quaternion();
  const lighting = createSceneLighting(scene);
  const quantumLightingRoots = [
    lighting.ambient,
    lighting.sun,
    lighting.sun.target,
    lighting.moonLight,
    lighting.moonLight.target,
  ] as const;
  enableRenderLayer(lighting.ambient, QUANTUM_RENDER_LAYER);
  enableRenderLayer(lighting.sun, QUANTUM_RENDER_LAYER);
  enableRenderLayer(lighting.moonLight, QUANTUM_RENDER_LAYER);

  const tileManager = createPlanetTileManager(scene, planet, seed);
  const muzzleFlashRenderer = createMuzzleFlashRenderer(scene, tileManager.renderScale);
  const hitDecalRenderer = createHitDecalRenderer(scene, tileManager.renderScale);
  const tracerRenderer = createTracerRenderer(scene, tileManager.renderScale);
  const surfaceWaterManager = createPlanetSurfaceWaterManager(
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
  const surfaceSpawnManager = createSurfaceSpawnManager(
    scene,
    planet,
    seed,
    tileManager.renderScale,
  );
  const cloudShell = createCloudShell(scene, planet, seed, tileManager.renderScale);

  // Cloud path is player-selectable (Video settings): cheap planet-anchored
  // 2D shell by default, Takram volumetric composite on demand. Live-switches.
  // Grass render distance is the same: live apply, no reload.
  const initialGameSettings = loadGameSettings();
  let cloudMode: CloudModeSetting = initialGameSettings.cloudMode;
  vegetationManager.setGrassRenderDistanceMeters(
    initialGameSettings.grassRenderDistanceMeters,
  );
  const handleGameSettingsChanged = (event: Event) => {
    const next = (event as CustomEvent<GameSettings>).detail ?? loadGameSettings();
    cloudMode = next.cloudMode;
    vegetationManager.setGrassRenderDistanceMeters(next.grassRenderDistanceMeters);
  };
  window.addEventListener(GAME_SETTINGS_CHANGED_EVENT, handleGameSettingsChanged);

  const composerStack = createComposerStack(
    renderer,
    scene,
    camera,
    planet,
    lighting.sun,
    tileManager.renderScale,
  );
  composerStack.colorCorrectionEffect.setSettings(resolveColorCorrectionSettings());

  const atmosphereMesh = buildAtmosphereMesh(planet, tileManager.renderScale);
  scene.add(atmosphereMesh);

  const shipRenderPool = createShipRenderPool(scene, tileManager.renderScale);
  window.__claudecitizenShipModel = shipRenderPool as unknown as typeof window.__claudecitizenShipModel;

  const stationFrame = getStationFrame(planet);
  const stationMesh = options?.stationPrefab
    ? createPrefabStationGroup(options.stationPrefab, tileManager.renderScale, {
        localLightShadowMapSize: renderQuality.localLightShadowMapSize,
        localLightShadowsEnabled: renderQuality.localLightShadowsEnabled,
      })
    : createStationModel(tileManager.renderScale);
  scene.add(stationMesh);

  const additionalStationMeshes = (options?.additionalStations ?? []).map((entry) => ({
    ...entry,
    mesh: null as THREE.Group | null,
  }));

  function ensureAdditionalStationMesh(
    entry: (typeof additionalStationMeshes)[number],
    focusPosition: Vec3,
  ): THREE.Group | null {
    if (entry.mesh) return entry.mesh;
    if (distance(entry.frame.origin, focusPosition) > SECONDARY_STATION_LOAD_DISTANCE_METERS) {
      return null;
    }

    entry.mesh = createPrefabStationGroup(entry.prefab, tileManager.renderScale, {
      localLightShadowMapSize: renderQuality.localLightShadowMapSize,
      localLightShadowsEnabled: renderQuality.localLightShadowsEnabled,
    });
    scene.add(entry.mesh);
    return entry.mesh;
  }

  const avatar = createCharacterAvatar(
    scene,
    tileManager.renderScale,
    options?.characterAppearance ?? null,
  );
  const remotePresence = createRemotePresenceRenderer(scene, tileManager.renderScale);
  const stationNpcs = createStationNpcRenderer(scene, tileManager.renderScale);
  const quantumBubble = createQuantumBubble(scene, tileManager.renderScale);
  quantumBubble.enableRenderLayer(QUANTUM_RENDER_LAYER);

  const renderFrameState: SpikeRenderFrameState = {
    lastTime: 0,
    quantumPreloadKey: null,
    quantumPreloadPosition: null,
    quantumPreloadSurface: null,
    quantumPreloadTileState: null,
    lastVegetationApproachPrefetchSeconds: -Infinity,
    lastQuantumPreloadUpdateSeconds: -Infinity,
    wasQuantumTraveling: false,
    lastFocusPosition: { x: 0, y: 0, z: 0 },
  };

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

  let lastResizeWidth = canvas.clientWidth || 1;
  let lastResizeHeight = canvas.clientHeight || 1;
  let appliedPixelRatio = renderer.getPixelRatio();
  let lastSurfaceAltitudeMeters: number | null = null;

  function applyViewportSize(width: number, height: number, pixelRatio: number): void {
    lastResizeWidth = width;
    lastResizeHeight = height;
    appliedPixelRatio = pixelRatio;
    renderer.setPixelRatio(pixelRatio);
    renderer.setSize(width, height, false);
    camera.aspect = width / height;
    camera.updateProjectionMatrix();
    composerStack.resize(width, height, pixelRatio);
  }

  function syncSurfacePixelRatio(altitudeMeters: number): void {
    lastSurfaceAltitudeMeters = altitudeMeters;
    const onSurface = altitudeMeters < planet.atmosphereHeightMeters;
    const maxPixelRatio = onSurface
      ? Math.min(renderQuality.maxPixelRatio, SURFACE_MAX_PIXEL_RATIO)
      : renderQuality.maxPixelRatio;
    const targetPixelRatio = Math.min(window.devicePixelRatio || 1, maxPixelRatio);
    if (Math.abs(targetPixelRatio - appliedPixelRatio) < 1e-4) return;
    applyViewportSize(lastResizeWidth, lastResizeHeight, targetPixelRatio);
  }

  function resize(width: number, height: number): void {
    const onSurface =
      lastSurfaceAltitudeMeters != null &&
      lastSurfaceAltitudeMeters < planet.atmosphereHeightMeters;
    const maxPixelRatio = onSurface
      ? Math.min(renderQuality.maxPixelRatio, SURFACE_MAX_PIXEL_RATIO)
      : renderQuality.maxPixelRatio;
    applyViewportSize(
      width,
      height,
      Math.min(window.devicePixelRatio || 1, maxPixelRatio),
    );
  }

  const renderFrameDeps: SpikeRenderFrameDeps = {
    planet,
    seed,
    getCloudMode: () => cloudMode,
    tileManager,
    vegetationManager,
    surfaceSpawnManager,
    cloudShell,
    surfaceWaterManager,
    composerStack,
    shipRenderPool,
    avatar,
    remotePresence,
    stationNpcs,
    quantumBubble,
    muzzleFlashRenderer,
    hitDecalRenderer,
    tracerRenderer,
    lighting,
    renderer,
    scene,
    camera,
    cameraTarget,
    stationFrame,
    stationMesh,
    additionalStationMeshes,
    atmosphereMesh,
    defaultFog,
    quantumLightingRoots,
    resolveSunTimeSeconds,
    syncSurfacePixelRatio,
    ensureAdditionalStationMesh,
  };

  function render(world: SpikeRenderWorld): RenderStats {
    return executeSpikeRenderFrame(renderFrameDeps, renderFrameState, world);
  }

  function applySsaoSettings(settings: Partial<SsaoSettings>): void {
    const n8aoPass = composerStack.n8aoPass;
    if (!n8aoPass) return;
    if (settings.intensity !== undefined) {
      composerStack.ssaoBaseIntensity = settings.intensity;
      n8aoPass.configuration.intensity = settings.intensity;
    }
    if (settings.aoRadius !== undefined) {
      composerStack.ssaoBaseRadius = settings.aoRadius;
      n8aoPass.configuration.aoRadius = settings.aoRadius * tileManager.renderScale;
    }
    if (settings.distanceFalloff !== undefined) {
      n8aoPass.configuration.distanceFalloff = settings.distanceFalloff;
    }
  }

  return {
    rendererMode,
    render,
    resize,
    setVegetationSettings(nextSettings) {
      vegetationManager.setSettings(normalizeVegetationSettings(nextSettings));
    },
    setVegetationLayers(layers) {
      vegetationManager.setLayerVisible(layers);
    },
    setSurfaceSpawnCatalog(catalog) {
      surfaceSpawnManager.setCatalog(catalog);
    },
    setSurfaceSpawnLayers(layers) {
      surfaceSpawnManager.setLayers(layers);
    },
    getNearbySurfaceSpawns(focus, radiusMeters) {
      return surfaceSpawnManager.getNearbyInstances(focus, radiusMeters);
    },
    getSurfaceSpawnLayers() {
      return surfaceSpawnManager.getLayers();
    },
    getSurfaceSpawnCatalog() {
      return surfaceSpawnManager.getCatalog();
    },
    getSurfaceSpawnMeshCollisions() {
      return surfaceSpawnManager.getMeshCollisions();
    },
    getSurfaceSpawnDebugStats() {
      return surfaceSpawnManager.getDebugStats();
    },
    async warmSpawnCorridor(focus, options) {
      const radiusMeters = options?.radiusMeters ?? 700;
      const timeoutMs = options?.timeoutMs ?? 8_000;
      const onProgress = options?.onProgress;
      onProgress?.(0.05, 'Prefetching terrain near spawn...');
      const terrainKeys = tileManager.prefetchAround(focus, radiusMeters, {
        minLevel: 12,
        maxLevel: 17,
      });
      onProgress?.(0.25, 'Waiting for spawn terrain...');
      const terrainReady = await tileManager.waitUntilReady(
        terrainKeys,
        timeoutMs * 0.7,
      );
      onProgress?.(0.55, 'Loading vegetation assets...');
      await vegetationManager.waitForAssets(Math.min(timeoutMs, 12_000));
      onProgress?.(0.65, 'Prefetching vegetation near spawn...');
      const vegetationKeys = vegetationManager.prefetchAround(focus, radiusMeters, {
        minLevel: 14,
        maxLevel: 17,
      });
      onProgress?.(0.75, 'Waiting for spawn vegetation...');
      const vegetationReady = await vegetationManager.waitUntilReady(
        vegetationKeys,
        timeoutMs * 0.3,
      );
      onProgress?.(1, 'Spawn corridor ready');
      console.info(
        `ClaudeCitizen spawn warm: terrain ${terrainReady}/${terrainKeys.length}, veg ${vegetationReady}/${vegetationKeys.length}.`,
      );
    },
    setFogSettings(settings) {
      applyFogSettings(composerStack.volumetricFogEffect, settings);
    },
    setColorCorrectionSettings(settings) {
      composerStack.colorCorrectionEffect.setSettings(settings);
      saveColorCorrectionSettings(settings);
    },
    setSsaoSettings(settings: Partial<SsaoSettings>) {
      applySsaoSettings(settings);
    },
    setSsaoIntensity(intensity) {
      applySsaoSettings({ intensity });
    },
    setSsaoColor(color) {
      if (composerStack.n8aoPass) {
        composerStack.n8aoPass.configuration.color = color === null
          ? new THREE.Color(0, 0, 0)
          : new THREE.Color(color);
      }
    },
    setTimeOverride(mode) {
      timeOverride = mode;
    },
    setEquippedInventory(inventory, activeWeaponSlotId = null) {
      avatar.setEquippedInventory(inventory, activeWeaponSlotId);
    },
    getActiveWeaponWorldPose() {
      const attachment = avatar.getActiveWeaponAttachment();
      if (!attachment) return null;
      const resolveMarker = (object: THREE.Object3D | null) => {
        if (!object) return null;
        object.updateWorldMatrix(true, false);
        object.getWorldPosition(weaponMarkerPosition);
        object.getWorldQuaternion(weaponMarkerQuaternion);
        weaponMarkerForward.set(0, 0, 1).applyQuaternion(weaponMarkerQuaternion).normalize();
        return {
          position: {
            x: weaponMarkerPosition.x / tileManager.renderScale + renderFrameState.lastFocusPosition.x,
            y: weaponMarkerPosition.y / tileManager.renderScale + renderFrameState.lastFocusPosition.y,
            z: weaponMarkerPosition.z / tileManager.renderScale + renderFrameState.lastFocusPosition.z,
          },
          forward: {
            x: weaponMarkerForward.x,
            y: weaponMarkerForward.y,
            z: weaponMarkerForward.z,
          },
        };
      };
      return {
        barrelEnd: resolveMarker(attachment.barrelEnd),
        combat: attachment.combat ? { ...attachment.combat } : null,
        muzzleFlash: resolveMarker(attachment.muzzleFlash),
      };
    },
    presentWeaponShot(shot) {
      if (shot.muzzleFlash) muzzleFlashRenderer.spawn(shot.muzzleFlash);
      if (shot.tracer) tracerRenderer.spawn(shot.tracer);
      if (shot.hit) {
        hitDecalRenderer.spawn({
          normal: shot.hit.normal,
          point: shot.hit.point,
          textureUrl: shot.hitDecalUrl,
        });
      }
    },
    dispose() {
      window.removeEventListener(GAME_SETTINGS_CHANGED_EVENT, handleGameSettingsChanged);
      cloudShell.dispose();
      surfaceWaterManager.dispose();
      vegetationManager.dispose();
      surfaceSpawnManager.dispose();
      remotePresence.dispose();
      stationNpcs.dispose();
      quantumBubble.dispose();
      avatar.dispose();
      muzzleFlashRenderer.dispose();
      hitDecalRenderer.dispose();
      tracerRenderer.dispose();
      shipRenderPool.dispose();
      tileManager.dispose();
      composerStack.dispose();
      renderer.dispose();
    },
    getStationRoot() {
      return stationMesh;
    },
    getActiveShipGroup() {
      return shipRenderPool.getActiveGroup();
    },
    getCamera() {
      return camera;
    },
    getRenderScale() {
      return tileManager.renderScale;
    },
  };
}
