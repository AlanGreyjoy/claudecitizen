import * as THREE from 'three';
import type { WebGPURenderer } from 'three/webgpu';
import type {
  Planet,
  RenderStats,
  SpikeRenderWorld,
  PlanetSpawnCatalog,
  SsaoSettings,
  SurfaceSpawnMeshCollision,
  Vec3,
} from '../../types';
import { createCharacterAvatar } from './scene/character-avatar';
import { createCloudShell, createPlanetSurfaceWaterManager } from '../effects';
import { createPlanetTileManager, PLANET_RENDER_SCALE } from '../planet_tiles';
import {
  createPlanetVegetationManager,
  DEFAULT_VEGETATION_SETTINGS,
  normalizeVegetationSettings,
} from '../vegetation';
import { createWebGpuWindMaterial } from '../vegetation/render/wind-node-material';
import { createWebGpuParticleMaterial } from '../particles/node-material';
import { createSurfaceSpawnManager } from '../surface_spawns';
import { applyRenderQualitySettings } from './domain/apply-render-quality';
import { SURFACE_MAX_PIXEL_RATIO } from './domain/constants';
import { resolveSkyPalette, resolveSkyRecipe } from './domain/sky-recipe';
import type { SpikeRenderer, TimeOverride } from './domain/types';
import { getStationFrame, type StationFrame } from '../../world/station';
import type { PrefabDocument } from '../../world/prefabs/schema';
import {
  DEFAULT_SCENE_ENVIRONMENT,
  type SceneEnvironmentConfig,
} from '../../world/scenes/scene-runtime';
import {
  disposeOwnedGpuResources,
  disposeSubtreeShadowMaps,
} from '../assets/gpu-dispose';
import { buildAtmosphereMesh } from './scene/atmosphere-mesh';
import { createWebGpuMainPostStack } from './post/webgpu-post-stack';
import { createShipRenderPool } from './scene/ship-render-pool';
import { createRemotePresenceRenderer } from './scene/remote-presence';
import { createStationNpcRenderer } from './scene/station-npcs';
import { createStationModel } from './scene/station-model';
import { createSecondaryStationLoader } from './scene/secondary-stations';
import { createPrefabStationGroup } from '../prefabs/prefab-renderer';
import {
  applyShadowQuality,
  createMainCamera,
  createMainScene,
  createSceneLighting,
  type SceneLighting,
} from './scene/scene-lighting';
import type { MainPostStack } from './post/types';
import { createWebGpuRenderer } from './scene/webgpu-renderer';
import { createWebGpuSurfaceWaterMaterial } from '../effects/lake_water/render/node-material';
import { createWebGpuCloudShellMaterial } from '../effects/clouds/shell-node-material';
import { createWebGpuHyperspaceMaterial } from '../effects/quantum-bubble-node-material';
import {
  resolveRenderQuality,
  type RenderQualitySettings,
} from './domain/render-quality';
import {
  resolveColorCorrectionSettings,
  saveColorCorrectionSettings,
} from './domain/color-correction';
import { createQuantumBubble } from '../effects/quantum-bubble';
import type { PlayerCharacterAppearanceV1 } from '../../player/character_creator/player-character-appearance';
import {
  GAME_SETTINGS_CHANGED_EVENT,
  loadGameSettings,
  type CloudModeSetting,
  type GameSettings,
} from '../../settings/game-settings';
import { createMuzzleFlashRenderer } from '../effects/muzzle-flash';
import { createHitDecalRenderer } from '../effects/hit-decals';
import { createImpactBurstRenderer } from '../effects/impact-burst';
import { createTracerRenderer } from '../effects/tracers';
import {
  executeSpikeRenderFrame,
  type PlanetRenderStack,
  type SpikeRenderFrameDeps,
  type SpikeRenderFrameState,
  QUANTUM_RENDER_LAYER,
  enableRenderLayer,
} from './render-spike-frame';

/**
 * The video settings whose effect is baked into the render graph rather than a
 * uniform: quality preset (pixel ratio, SMAA, LOD, vegetation budgets), shadow
 * map size, and the AO branch. A change to any of them costs a post-stack
 * rebuild, so they are compared as one string instead of applied blindly.
 */
function renderQualitySignature(settings: GameSettings): string {
  return [
    settings.renderQuality,
    settings.shadowQuality,
    settings.ambientOcclusion ? 'ao' : 'no-ao',
  ].join('|');
}

/**
 * Re-applies the stored video settings to a live renderer, replacing what used
 * to be a page reload.
 *
 * Tile LOD and vegetation budgets are module globals read lazily per tile
 * build, and the budgets are already part of the vegetation cache key, so
 * re-applying them is enough — tiles already on screen keep their old density
 * until they are rebuilt, and no cache is invalidated.
 */
function applyLiveRenderQuality(
  lighting: SceneLighting,
  postStack: MainPostStack,
): RenderQualitySettings {
  applyRenderQualitySettings();
  const quality = resolveRenderQuality();
  applyShadowQuality(lighting, quality.shadowMapSize);
  postStack.rebuild();
  return quality;
}

// A full protected station can carry multiple gigabytes of decoded atlas data.

/**
 * Six cube-face views used to warm render pipelines over the whole sphere.
 *
 * `up` cannot be parallel to `forward` or `lookAt` degenerates, so the two
 * vertical views tilt their up vector onto Z the way a cube camera does.
 */
const PIPELINE_WARM_VIEWS: ReadonlyArray<{ forward: Vec3; up: Vec3 }> = [
  { forward: { x: 1, y: 0, z: 0 }, up: { x: 0, y: 1, z: 0 } },
  { forward: { x: -1, y: 0, z: 0 }, up: { x: 0, y: 1, z: 0 } },
  { forward: { x: 0, y: 0, z: 1 }, up: { x: 0, y: 1, z: 0 } },
  { forward: { x: 0, y: 0, z: -1 }, up: { x: 0, y: 1, z: 0 } },
  { forward: { x: 0, y: 1, z: 0 }, up: { x: 0, y: 0, z: 1 } },
  { forward: { x: 0, y: -1, z: 0 }, up: { x: 0, y: 0, z: 1 } },
];

/**
 * Builds render pipelines for everything around the camera, off the critical path.
 *
 * Without this, three takes the synchronous `device.createRenderPipeline` path
 * (`compileAsync` is the only thing that opts into the async branch), so the
 * first frame that brings a material variant into view blocks the render thread
 * on a driver shader compile — a ~300 ms freeze while the frame counter still
 * reads healthy.
 *
 * The sweep is the point. `compileAsync` runs the *same frustum cull as a real
 * render* (`Renderer._projectObject` gates on
 * `frustum.intersectsObject( object, camera )`), so warming with the live camera
 * compiles only what is already on screen and leaves everything behind the
 * player cold. The symptom is unmistakable: panning left stalls once, panning
 * back and forth across that arc is then free, a little further left stalls
 * again, and after a full turn the scene is finally smooth — each stall being
 * one direction's pipelines compiling for the first time.
 *
 * Six 90-degree views from the camera's position cover the whole sphere, so a
 * turn finds everything compiled. The renderer caches pipelines, so the five
 * extra passes only pay for what the earlier ones did not reach.
 *
 * Shadow-caster variants are still not covered: `compileAsync` walks only the
 * opaque and transparent lists for the given camera and never traverses shadow
 * maps, and three exposes no public API to precompile them.
 */
async function warmPipelinesAround(
  renderer: WebGPURenderer,
  scene: THREE.Scene,
  camera: THREE.PerspectiveCamera,
): Promise<void> {
  const warmCamera = new THREE.PerspectiveCamera(90, 1, camera.near, camera.far);
  // The layer mask must match, or `_projectObject`'s `object.layers.test` drops
  // exactly the objects the live camera would have drawn.
  warmCamera.layers.mask = camera.layers.mask;
  try {
    for (const view of PIPELINE_WARM_VIEWS) {
      warmCamera.position.copy(camera.position);
      warmCamera.up.set(view.up.x, view.up.y, view.up.z);
      warmCamera.lookAt(
        camera.position.x + view.forward.x,
        camera.position.y + view.forward.y,
        camera.position.z + view.forward.z,
      );
      warmCamera.updateMatrixWorld(true);
      await renderer.compileAsync(scene, warmCamera);
    }
  } catch (error) {
    // Never let a warm-up failure block entering the world; the pipelines will
    // just compile lazily as they did before.
    console.warn('ClaudeCitizen pipeline warm-up failed', error);
  }
}

// Interior scenes have no surface-spawn manager, so the debug/query surface of
// the renderer answers with empties instead of forcing every caller to branch.
const EMPTY_SPAWN_MESH_COLLISIONS = new Map<string, SurfaceSpawnMeshCollision>();

function emptySurfaceSpawnCatalog(): PlanetSpawnCatalog {
  return { samplesPerTile: 0, density: 0, entries: [] };
}

function emptySurfaceSpawnDebugStats(): ReturnType<SpikeRenderer['getSurfaceSpawnDebugStats']> {
  return {
    layerCount: 0,
    enabledLayers: 0,
    entryCount: 0,
    uniqueAssets: 0,
    batchMeshes: 0,
    estimatedDrawCalls: 0,
    cachedTiles: 0,
    readyTiles: 0,
    pendingTiles: 0,
    totalInstances: 0,
    loadedAssets: 0,
    failedAssets: 0,
    meshCounts: [],
    rootVisible: false,
    rootInScene: false,
    sampleRenderPos: null,
    rootPos: { x: 0, y: 0, z: 0 },
    rootScale: 0,
  };
}

export interface SpikeRendererOptions {
  /** Dev preview: render this prefab as the orbital station instead of the procedural model. */
  stationPrefab?: PrefabDocument | null;
  /**
   * Extra station prefab roots for other System Map instances around the active
   * planet. Visual + placement only — primary station still owns walk physics.
   */
  additionalStations?: Array<{ prefab: PrefabDocument; frame: StationFrame }> | null;
  characterAppearance?: PlayerCharacterAppearanceV1 | null;
  /**
   * `interior` skips the whole planet stack — terrain, vegetation, surface
   * spawns, water, clouds, atmosphere, and quantum travel — for scenes whose
   * GameObjects never reference a planet. Defaults to `planet`.
   */
  environment?: 'planet' | 'interior';
  /** Per-scene lighting / skybox overrides from `scene-environment`. */
  sceneEnvironment?: SceneEnvironmentConfig;
}

function resolveSpikeEnvironmentOptions(options?: SpikeRendererOptions): {
  planetEnabled: boolean;
  sceneEnvironment: SceneEnvironmentConfig;
} {
  return {
    planetEnabled: (options?.environment ?? 'planet') === 'planet',
    sceneEnvironment: options?.sceneEnvironment ?? DEFAULT_SCENE_ENVIRONMENT,
  };
}

/**
 * Builds the planet half of the renderer: terrain streaming, vegetation,
 * surface spawns, water, clouds, the atmosphere shell, and quantum travel.
 * Scenes with no planet skip this entirely, which is what keeps their terrain
 * and surface-spawn workers from starting.
 */
function createPlanetRenderStack(
  scene: THREE.Scene,
  cloudScene: THREE.Scene,
  planet: Planet,
  seed: number,
  renderScale: number,
): PlanetRenderStack {
  const atmosphereMesh = buildAtmosphereMesh(planet, renderScale);
  scene.add(atmosphereMesh);
  // Every custom shader site below renders through WebGPURenderer, which only
  // consumes node materials — a raw ShaderMaterial silently draws as a blank
  // node material. Injecting the TSL factory is not optional here.
  const quantumBubble = createQuantumBubble(scene, renderScale, {
    hyperspaceMaterialFactory: createWebGpuHyperspaceMaterial,
  });
  quantumBubble.enableRenderLayer(QUANTUM_RENDER_LAYER);
  return {
    tileManager: createPlanetTileManager(scene, planet, seed),
    vegetationManager: createPlanetVegetationManager(
      scene,
      planet,
      seed,
      renderScale,
      DEFAULT_VEGETATION_SETTINGS,
      createWebGpuWindMaterial,
    ),
    surfaceSpawnManager: createSurfaceSpawnManager(scene, planet, seed, renderScale),
    // Into `cloudScene`, not `scene` — the deck is composited into the sky by
    // the post stack's `cloud-deck` pass. See the note on the material.
    cloudShell: createCloudShell(cloudScene, seed, renderScale, {
      materialFactory: createWebGpuCloudShellMaterial,
      clouds: resolveSkyRecipe().clouds,
      luminanceScale: resolveSkyPalette(resolveSkyRecipe()).cloudLuminanceScale,
      hazeExtinctionPerMeter:
        resolveSkyPalette(resolveSkyRecipe()).hazeExtinctionPerMeter,
      planetRadiusMeters: planet.radiusMeters,
    }),
    surfaceWaterManager: createPlanetSurfaceWaterManager(scene, planet, seed, renderScale, {
      materialFactory: createWebGpuSurfaceWaterMaterial,
    }),
    atmosphereMesh,
    quantumBubble,
  };
}

export async function createSpikeRenderer(
  canvas: HTMLCanvasElement,
  planet: Planet,
  seed: number,
  options?: SpikeRendererOptions,
): Promise<SpikeRenderer> {
  const { planetEnabled, sceneEnvironment } = resolveSpikeEnvironmentOptions(options);
  applyRenderQualitySettings();
  let renderQuality = resolveRenderQuality();

  const { rendererMode, renderer } = await createWebGpuRenderer(canvas);

  const scene = createMainScene();
  // Holds the cloud deck and nothing else. It is rendered by its own post pass
  // and composited into the sky, so it must stay out of the gameplay scene's
  // depth, AO, and fog. `background` stays null: the pass relies on the
  // renderer's transparent-black clear to carry cloud coverage in alpha.
  const cloudScene = new THREE.Scene();
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

  const renderScale = PLANET_RENDER_SCALE;
  const muzzleFlashRenderer = createMuzzleFlashRenderer(scene, renderScale, camera);
  const hitDecalRenderer = createHitDecalRenderer(scene, renderScale);
  const impactBurstRenderer = createImpactBurstRenderer(scene, renderScale, camera);
  const tracerRenderer = createTracerRenderer(scene, renderScale, camera);

  const planetStack = planetEnabled
    ? createPlanetRenderStack(scene, cloudScene, planet, seed, renderScale)
    : null;
  const tileManager = planetStack?.tileManager ?? null;
  const vegetationManager = planetStack?.vegetationManager ?? null;
  const surfaceSpawnManager = planetStack?.surfaceSpawnManager ?? null;

  // Cloud path is player-selectable (Video settings): cheap planet-anchored
  // 2D shell by default, Takram volumetric composite on demand. Live-switches.
  // Grass render distance is the same: live apply, no reload.
  const initialGameSettings = loadGameSettings();
  let cloudMode: CloudModeSetting = initialGameSettings.cloudMode;
  vegetationManager?.setGrassRenderDistanceMeters(
    initialGameSettings.grassRenderDistanceMeters,
  );
  vegetationManager?.setTreeLodDistanceMeters(
    initialGameSettings.vegetationDrawDistanceMeters,
  );

  const postStack = await createWebGpuMainPostStack(
    renderer,
    scene,
    cloudScene,
    camera,
    planet,
    lighting.sun,
    renderScale,
  );
  postStack.setColorCorrectionSettings(resolveColorCorrectionSettings());

  const shipRenderPool = createShipRenderPool(scene, renderScale);
  window.__claudecitizenShipModel = shipRenderPool as unknown as typeof window.__claudecitizenShipModel;

  const stationFrame = getStationFrame(planet);
  const stationMesh = options?.stationPrefab
    ? createPrefabStationGroup(options.stationPrefab, renderScale, {
        localLightShadowMapSize: renderQuality.localLightShadowMapSize,
        localLightShadowsEnabled: renderQuality.localLightShadowsEnabled,
        particleMaterialFactory: createWebGpuParticleMaterial,
      })
    : createStationModel(renderScale);
  scene.add(stationMesh);

  const secondaryStations = createSecondaryStationLoader({
    scene,
    renderScale,
    stations: options?.additionalStations ?? [],
    getShadowSettings: () => ({
      localLightShadowMapSize: renderQuality.localLightShadowMapSize,
      localLightShadowsEnabled: renderQuality.localLightShadowsEnabled,
    }),
    particleMaterialFactory: createWebGpuParticleMaterial,
  });
  const additionalStationMeshes = secondaryStations.entries;
  const ensureAdditionalStationMesh = secondaryStations.ensure;

  const avatar = createCharacterAvatar(
    scene,
    renderScale,
    options?.characterAppearance ?? null,
  );
  const remotePresence = createRemotePresenceRenderer(scene, renderScale);
  const stationNpcs = createStationNpcRenderer(scene, renderScale);

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
    return (theta / (Math.PI * 2)) * resolveSkyRecipe().dayLengthSeconds;
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
    postStack.resize(width, height, pixelRatio);
  }

  /**
   * Hovering exactly at the atmosphere boundary must not toggle the pixel ratio.
   *
   * The surface cap changes the target pixel ratio, and changing that
   * reallocates the whole post chain. On a bare threshold, drifting across
   * `atmosphereHeightMeters` does that every frame. A 4% band means leaving
   * costs an unambiguous climb.
   */
  const SURFACE_PIXEL_RATIO_EXIT_FACTOR = 1.04;
  let treatAsOnSurface = true;

  function syncSurfacePixelRatio(altitudeMeters: number): void {
    lastSurfaceAltitudeMeters = altitudeMeters;
    const exitAltitude =
      planet.atmosphereHeightMeters * SURFACE_PIXEL_RATIO_EXIT_FACTOR;
    treatAsOnSurface = treatAsOnSurface
      ? altitudeMeters < exitAltitude
      : altitudeMeters < planet.atmosphereHeightMeters;
    const onSurface = treatAsOnSurface;
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

  function refreshViewport(): void {
    if (lastSurfaceAltitudeMeters != null) {
      syncSurfacePixelRatio(lastSurfaceAltitudeMeters);
      return;
    }
    resize(lastResizeWidth, lastResizeHeight);
  }

  // Every video setting applies live; none of them reload the page. Cloud mode
  // and grass distance are plain field writes, so they run on every event; the
  // graph-shaping ones are gated on a signature because each costs a shader
  // recompile.
  // Seeded from the *resolved* preset, not the stored one: a hand-typed
  // `?quality=` still outranks storage at boot, and seeding from storage would
  // make the first menu change look like a no-op and skip the rebuild.
  let appliedQualitySignature = renderQualitySignature({
    ...initialGameSettings,
    renderQuality: renderQuality.preset,
  });
  const handleGameSettingsChanged = (event: Event) => {
    const next = (event as CustomEvent<GameSettings>).detail ?? loadGameSettings();
    cloudMode = next.cloudMode;
    vegetationManager?.setGrassRenderDistanceMeters(next.grassRenderDistanceMeters);
    vegetationManager?.setTreeLodDistanceMeters(next.vegetationDrawDistanceMeters);
    const signature = renderQualitySignature(next);
    if (signature === appliedQualitySignature) return;
    appliedQualitySignature = signature;
    renderQuality = applyLiveRenderQuality(lighting, postStack);
    refreshViewport();
  };
  window.addEventListener(GAME_SETTINGS_CHANGED_EVENT, handleGameSettingsChanged);

  const renderFrameDeps: SpikeRenderFrameDeps = {
    planet,
    seed,
    getCloudMode: () => cloudMode,
    planetStack,
    renderScale,
    postStack,
    shipRenderPool,
    avatar,
    remotePresence,
    stationNpcs,
    muzzleFlashRenderer,
    hitDecalRenderer,
    impactBurstRenderer,
    tracerRenderer,
    lighting,
    renderer,
    scene,
    camera,
    cameraTarget,
    stationFrame,
    stationMesh,
    additionalStationMeshes,
    defaultFog,
    quantumLightingRoots,
    resolveSunTimeSeconds,
    syncSurfacePixelRatio,
    ensureAdditionalStationMesh,
    sceneEnvironment,
  };

  function render(world: SpikeRenderWorld): RenderStats {
    return executeSpikeRenderFrame(renderFrameDeps, renderFrameState, world);
  }

  return {
    rendererMode,
    render,
    resize,
    setVegetationSettings(nextSettings) {
      vegetationManager?.setSettings(normalizeVegetationSettings(nextSettings));
    },
    setVegetationLayers(layers) {
      vegetationManager?.setLayerVisible(layers);
    },
    setSurfaceSpawnCatalog(catalog) {
      surfaceSpawnManager?.setCatalog(catalog);
    },
    setSurfaceSpawnLayers(layers) {
      surfaceSpawnManager?.setLayers(layers);
    },
    getNearbySurfaceSpawns(focus, radiusMeters) {
      return surfaceSpawnManager?.getNearbyInstances(focus, radiusMeters) ?? [];
    },
    getSurfaceSpawnRevision() {
      return surfaceSpawnManager?.getInstanceRevision() ?? 0;
    },
    getSurfaceSpawnLayers() {
      return surfaceSpawnManager?.getLayers() ?? [];
    },
    getSurfaceSpawnCatalog() {
      return surfaceSpawnManager?.getCatalog() ?? emptySurfaceSpawnCatalog();
    },
    getSurfaceSpawnMeshCollisions() {
      return surfaceSpawnManager?.getMeshCollisions() ?? EMPTY_SPAWN_MESH_COLLISIONS;
    },
    getSurfaceSpawnDebugStats() {
      return surfaceSpawnManager?.getDebugStats() ?? emptySurfaceSpawnDebugStats();
    },
    async warmSpawnCorridor(focus, options) {
      if (!tileManager || !vegetationManager) return;
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
      onProgress?.(0.9, 'Compiling shaders...');
      await warmPipelinesAround(renderer, scene, camera);
      onProgress?.(1, 'Spawn corridor ready');
      console.info(
        `ClaudeCitizen spawn warm: terrain ${terrainReady}/${terrainKeys.length}, veg ${vegetationReady}/${vegetationKeys.length}.`,
      );
    },
    warmRenderPipelines: () => warmPipelinesAround(renderer, scene, camera),
    setFogSettings(settings) {
      postStack.setFogSettings(settings);
    },
    setColorCorrectionSettings(settings) {
      postStack.setColorCorrectionSettings(settings);
      saveColorCorrectionSettings(settings);
    },
    setSsaoSettings(settings: Partial<SsaoSettings>) {
      postStack.setAmbientOcclusionSettings(settings);
    },
    setSsaoIntensity(intensity) {
      postStack.setAmbientOcclusionSettings({ intensity });
    },
    setSsaoColor(color) {
      postStack.setAmbientOcclusionColor(color);
    },
    setBloomSettings(settings) {
      postStack.setBloomSettings(settings);
    },
    setExposure(exposure) {
      postStack.setExposure(exposure);
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
            x: weaponMarkerPosition.x / renderScale + renderFrameState.lastFocusPosition.x,
            y: weaponMarkerPosition.y / renderScale + renderFrameState.lastFocusPosition.y,
            z: weaponMarkerPosition.z / renderScale + renderFrameState.lastFocusPosition.z,
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
        impactBurstRenderer.spawn({
          normal: shot.hit.normal,
          point: shot.hit.point,
          surfaceKind: shot.hit.surfaceKind ?? 'other',
        });
        hitDecalRenderer.spawn({
          normal: shot.hit.normal,
          point: shot.hit.point,
          textureUrl: shot.hitDecalUrl,
        });
      }
    },
    dispose() {
      secondaryStations.dispose();
      window.removeEventListener(GAME_SETTINGS_CHANGED_EVENT, handleGameSettingsChanged);
      planetStack?.cloudShell.dispose();
      planetStack?.surfaceWaterManager.dispose();
      planetStack?.vegetationManager.dispose();
      planetStack?.surfaceSpawnManager.dispose();
      planetStack?.quantumBubble.dispose();
      planetStack?.tileManager.dispose();
      remotePresence.dispose();
      stationNpcs.dispose();
      avatar.dispose();
      muzzleFlashRenderer.dispose();
      hitDecalRenderer.dispose();
      impactBurstRenderer.dispose();
      tracerRenderer.dispose();
      shipRenderPool.dispose();
      // Station groups were added to the scene and never removed. Their clones
      // share geometry and materials with the prefab model cache, so only the
      // per-instance allocations (override material clones, primitives) and the
      // lazily-allocated shadow maps are freed here; the shared templates are
      // released by the asset-residency sweep.
      for (const entry of additionalStationMeshes) {
        if (!entry.mesh) continue;
        scene.remove(entry.mesh);
        disposeOwnedGpuResources(entry.mesh);
        entry.mesh = null;
      }
      scene.remove(stationMesh);
      disposeOwnedGpuResources(stationMesh);
      disposeSubtreeShadowMaps(scene);
      postStack.dispose();
      renderer.dispose();
      scene.clear();
      // The diagnostic globals set during construction are strong refs. Scene
      // teardown runs before the next scene loads, so leaving them set keeps the
      // outgoing graph alive across the whole switch — exactly the memory peak.
      window.__spikeScene = null;
      window.__claudecitizenShipModel = null;
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
      return renderScale;
    },
  };
}
