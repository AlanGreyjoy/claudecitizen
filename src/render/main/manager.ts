import * as THREE from 'three';
import type {
  Planet,
  PlanetSurfaceSample,
  RenderStats,
  SpikeRenderWorld,
  SsaoSettings,
  Vec3,
} from '../../types';
import { normalize } from '../../math/vec3';
import { createCharacterAvatar } from './scene/character_avatar';
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
import { getStationFrame } from '../../world/station';
import { getShipLayout } from '../../player/ship_layout';
import {
  createPrefabStationGroup,
  updateLocalLightShadowCull,
} from '../prefabs/prefab_renderer';
import type { PrefabDocument } from '../../world/prefabs/schema';
import { buildAtmosphereMesh } from './scene/atmosphere_mesh';
import { createComposerStack } from './scene/composer_stack';
import { createShipRenderPool } from './scene/ship_render_pool';
import { createRemotePresenceRenderer } from './scene/remote_presence';
import { createStationModel } from './scene/station_model';
import { createMainCamera, createMainScene, createSceneLighting } from './scene/scene_lighting';
import { createWebGlRenderer } from './scene/webgl_renderer';
import { resolveRenderQuality } from './domain/render_quality';
import {
  resolveColorCorrectionSettings,
  saveColorCorrectionSettings,
} from './domain/color_correction';
import { updateCameraRig, updateSpeedBlur } from './update/camera_rig';
import { setFogSettings as applyFogSettings, updateEnvironment } from './update/environment';
import { updateShipPlacement, updateSunIntensity, updateSunSystem } from './update/sun_system';
import { createQuantumBubble } from '../effects/quantum_bubble';
import {
  evaluateQuantumEligibility,
  createQuantumTravelState,
  listNavDestinationMarkers,
  resolveNavDestinationId,
} from '../../flight/quantum_travel';
import type { PlayerCharacterAppearanceV1 } from '../../player/character_creator/player_character_appearance';

const DAY_NIGHT_FADE_START_METERS = 18_000;
const QUANTUM_RENDER_LAYER = 1;
const QUANTUM_BACKGROUND = new THREE.Color(0x01030a);

function enableRenderLayer(root: THREE.Object3D, layer: number): void {
  root.traverse((object) => object.layers.enable(layer));
}

function renderQuantumIsolation(
  renderer: THREE.WebGLRenderer,
  scene: THREE.Scene,
  camera: THREE.PerspectiveCamera,
  quantumRoot: THREE.Object3D,
  visibleBranchRoot: THREE.Object3D,
  preservedSceneRoots: readonly THREE.Object3D[],
): void {
  const previousLayerMask = camera.layers.mask;
  const previousBackground = scene.background;
  const previousFog = scene.fog;
  const previousMatrixWorldAutoUpdate = scene.matrixWorldAutoUpdate;
  const hiddenSiblings: THREE.Object3D[] = [];
  const preservedRoots = new Set(preservedSceneRoots);

  // Layers prevent draw submission, but Three.js still traverses every child
  // on a mismatched layer. Temporarily hiding siblings along the bubble's
  // ancestry makes the renderer visit the capsule branch and nothing else.
  let branch: THREE.Object3D | null = quantumRoot;
  while (branch?.parent) {
    // Keep the active ship/cockpit beside the capsule, then prune everything
    // else once the traversal reaches the main scene.
    if (branch.parent !== visibleBranchRoot) {
      for (const sibling of branch.parent.children) {
        if (
          sibling !== branch &&
          !preservedRoots.has(sibling) &&
          sibling.visible
        ) {
          sibling.visible = false;
          hiddenSiblings.push(sibling);
        }
      }
    }
    branch = branch.parent;
  }

  camera.layers.set(QUANTUM_RENDER_LAYER);
  scene.background = QUANTUM_BACKGROUND;
  scene.fog = null;
  visibleBranchRoot.updateWorldMatrix(true, true);
  for (const preservedRoot of preservedSceneRoots) {
    preservedRoot.updateWorldMatrix(true, true);
  }
  scene.matrixWorldAutoUpdate = false;
  try {
    renderer.render(scene, camera);
  } finally {
    scene.matrixWorldAutoUpdate = previousMatrixWorldAutoUpdate;
    camera.layers.mask = previousLayerMask;
    scene.background = previousBackground;
    scene.fog = previousFog;
    for (const sibling of hiddenSiblings) sibling.visible = true;
  }
}

function smoothstep01(value: number, edge0: number, edge1: number): number {
  const t = clamp01((value - edge0) / Math.max(edge1 - edge0, 0.000001));
  return t * t * (3 - 2 * t);
}

function resolveDayNightInfluence(altitudeMeters: number, atmosphereHeightMeters: number): number {
  const fadeStart = Math.min(DAY_NIGHT_FADE_START_METERS, atmosphereHeightMeters * 0.35);
  return 1 - smoothstep01(altitudeMeters, fadeStart, atmosphereHeightMeters);
}

export interface SpikeRendererOptions {
  /** Dev preview: render this prefab as the orbital station instead of the procedural model. */
  stationPrefab?: PrefabDocument | null;
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
  stationMesh.frustumCulled = false;
  scene.add(stationMesh);

  const avatar = createCharacterAvatar(
    scene,
    tileManager.renderScale,
    options?.characterAppearance ?? null,
  );
  const remotePresence = createRemotePresenceRenderer(scene, tileManager.renderScale);
  const quantumBubble = createQuantumBubble(scene, tileManager.renderScale);
  quantumBubble.enableRenderLayer(QUANTUM_RENDER_LAYER);

  let lastTime = 0;
  let timeOverride: TimeOverride = 'auto';
  let quantumPreloadKey: string | null = null;
  let quantumPreloadPosition: Vec3 | null = null;
  let quantumPreloadSurface: PlanetSurfaceSample | null = null;
  let quantumPreloadTileState: ReturnType<typeof tileManager.update> | null = null;
  let lastQuantumPreloadUpdateSeconds = -Infinity;
  let wasQuantumTraveling = false;

  const IDLE_VEGETATION_STATS = {
    activeTiles: 0,
    builtThisFrame: 0,
    cacheLimit: 0,
    cachedTiles: 0,
    diskHits: 0,
    diskMisses: 0,
    evictedThisFrame: 0,
    peakCachedTiles: 0,
    totalBuilds: 0,
    totalEvictions: 0,
  };

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
      cameraView = 'first-person',
      character = null,
      mode = 'in-ship',
      ship,
      timeSeconds: nowSeconds = 0,
    } = world;

    // First person only applies while the player walks; transitions and flight
    // keep the third-person framing so animated poses stay visible.
    const firstPersonActive =
      cameraView === 'first-person' &&
      character != null &&
      (mode === 'on-foot' || mode === 'on-ship-deck' || mode === 'in-station' || mode === 'riding-elevator');

    const renderMode = mode as RenderMode;
    const dt = Math.max(0.0001, Math.min(nowSeconds - lastTime, 0.1));
    lastTime = nowSeconds;

    const focusBody = mode === 'in-ship' || mode === 'in-bed' || !character ? ship : character;
    const volumetricEnabled = true;
    const quantumState = world.quantum ?? createQuantumTravelState();
    const quantumTraveling = quantumState.phase === 'traveling';
    const quantumBusy =
      quantumState.phase === 'spooling' ||
      quantumTraveling ||
      quantumState.phase === 'dropOut';

    // Resolve this once at travel entry. During the tunnel, all world systems
    // can work against the destination instead of sampling every point along
    // a route the isolated camera cannot see.
    if (quantumTraveling && quantumState.route) {
      const preloadKey = quantumState.destinationId ?? 'quantum-destination';
      if (preloadKey !== quantumPreloadKey) {
        const radius = planet.radiusMeters + quantumState.route.endAlt;
        quantumPreloadKey = preloadKey;
        quantumPreloadPosition = {
          x: quantumState.route.endDir.x * radius,
          y: quantumState.route.endDir.y * radius,
          z: quantumState.route.endDir.z * radius,
        };
        quantumPreloadSurface = sampleRenderablePlanetSurface(
          planet,
          seed,
          quantumPreloadPosition,
        );
      }
    }

    const surface =
      quantumTraveling && quantumPreloadSurface
        ? quantumPreloadSurface
        : sampleRenderablePlanetSurface(planet, seed, focusBody.position);
    const up = radialUp(focusBody.position);
    const shipUp = normalize(ship.up ?? radialUp(ship.position));
    const shipForward = normalize(ship.forward);
    const altitudeFactor = clamp01(surface.altitudeMeters / planet.atmosphereHeightMeters);
    const spaceFactor = clamp01(
      (surface.altitudeMeters - 18_000) / (planet.atmosphereHeightMeters * 1.6),
    );
    const dayNightInfluence = resolveDayNightInfluence(
      surface.altitudeMeters,
      planet.atmosphereHeightMeters,
    );
    const renderScale = tileManager.renderScale;

    const sunState = updateSunSystem(
      resolveSunTimeSeconds(nowSeconds, up),
      focusBody.position,
      renderScale,
      renderMode,
      up,
      dayNightInfluence,
      lighting.sun,
      lighting.sunMesh,
      lighting.moonMesh,
      lighting.moonLight,
    );
    updateSunIntensity(lighting.sun, sunState.rawDaylight, spaceFactor);

    let tileState: ReturnType<typeof tileManager.update>;
    if (quantumTraveling && quantumPreloadPosition && quantumPreloadSurface) {
      if (!wasQuantumTraveling) {
        quantumPreloadTileState = null;
        lastQuantumPreloadUpdateSeconds = -Infinity;
      }
      // Poll terrain streaming at 12 Hz while the capsule itself renders at
      // the display rate. Workers still get a steady destination queue, but
      // selection/cache bookkeeping cannot dominate every tunnel frame.
      if (
        !quantumPreloadTileState ||
        nowSeconds - lastQuantumPreloadUpdateSeconds >= 1 / 12
      ) {
        quantumPreloadTileState = tileManager.update(
          quantumPreloadPosition,
          quantumPreloadSurface,
        );
        lastQuantumPreloadUpdateSeconds = nowSeconds;
      }
      tileState = quantumPreloadTileState;
    } else {
      tileState = tileManager.update(focusBody.position, surface);
    }
    tileManager.setVisible(!quantumTraveling);
    lakeWaterManager.setVisible(!quantumTraveling);
    cloudShell.setVisible(!quantumTraveling);

    // Skipping the vegetation update alone leaves the previously active
    // instanced grass/trees beside the camera. Hide the parent so those meshes
    // do not keep rendering throughout warp.
    vegetationManager.setVisible(!quantumTraveling);
    const vegetationStats = quantumTraveling
      ? IDLE_VEGETATION_STATS
      : vegetationManager.update(
          focusBody.position,
          tileState.selectedTiles,
          surface.altitudeMeters,
          nowSeconds,
        );
    if (!quantumTraveling) {
      cloudShell.update(focusBody.position, nowSeconds, spaceFactor, surface.altitudeMeters);
    }

    const renderInstances =
      world.ships ??
      [
        {
          id: 'legacy',
          prefabId: getShipLayout().hullUrl ? 'active' : 'phobos-starhopper',
          body: ship,
          rig: world.shipRig ?? { gear01: 1, ramp01: 0, doors: {} },
        },
      ];
    shipRenderPool.sync(
      renderInstances,
      world.activeShipId,
      focusBody.position,
      renderScale,
    );
    const activeShipGroup = shipRenderPool.getActiveGroup();
    quantumBubble.attachToShip(activeShipGroup);
    if (quantumTraveling) {
      enableRenderLayer(activeShipGroup, QUANTUM_RENDER_LAYER);
    }
    const flightMode = world.flightMode ?? 'traverse';
    let highlightedId: string | null = null;
    if (flightMode === 'nav' && quantumState.phase === 'idle') {
      const eligibility = evaluateQuantumEligibility({
        body: ship,
        flightMode,
        quantum: quantumState,
        planet,
        seed,
      });
      highlightedId = eligibility.ok
        ? eligibility.destinationId
        : resolveNavDestinationId(ship, planet, seed);
    } else if (quantumState.destinationId) {
      highlightedId = quantumState.destinationId;
    }
    const markers =
      quantumTraveling
        ? []
        : listNavDestinationMarkers(planet, seed).map((marker) => ({
            ...marker,
            highlighted: marker.id === highlightedId,
          }));
    quantumBubble.update({
      quantum: quantumState,
      flightMode,
      focusPosition: focusBody.position,
      markers,
      timeSeconds: nowSeconds,
    });
    if (!quantumTraveling) {
      updateShipPlacement(
        stationMesh,
        { position: stationFrame.origin, up: stationFrame.up, forward: stationFrame.forward },
        focusBody.position,
        renderScale,
      );
    }
    // Prefab/procedural station meshes intentionally disable frustum culling.
    // Once warp carries them off-screen they would otherwise keep submitting
    // every draw call, even though none can contribute to the image.
    stationMesh.visible = !quantumTraveling;

    let backgroundColor = QUANTUM_BACKGROUND;
    if (!quantumTraveling) {
      ({ backgroundColor } = updateEnvironment({
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
        volumetricEnabled: volumetricEnabled && !quantumBusy,
        stationInteriorActive:
          renderMode === 'in-station' || renderMode === 'riding-elevator',
      }));

      avatar.update(character, focusBody.position, nowSeconds, firstPersonActive);
      remotePresence.update(world.networkEntities ?? [], focusBody.position, nowSeconds);
    }

    if (!quantumTraveling) {
      lakeWaterManager.update(
        focusBody.position,
        tileState.selectedTiles,
        sunState.sunDir,
        dt,
        backgroundColor,
      );
    }

    updateCameraRig(
      camera,
      cameraTarget,
      world,
      renderScale,
      altitudeFactor,
      shipUp,
      shipForward,
      firstPersonActive,
      { frame: stationFrame, roomId: world.stationRoomId ?? null },
      dt,
    );
    if (!quantumTraveling) {
      updateSpeedBlur(composerStack.speedBlurEffect, world);
    }

    if (quantumBusy) {
      // Warp already has its own bubble/fade treatment. Skip the expensive
      // scene re-render and full-screen sampling passes that add little while
      // the camera traverses thousands of kilometres per frame.
      composerStack.normalPass.setEnabled(false);
      composerStack.n8aoPass?.setEnabled(false);
      composerStack.volumetricFogPass.setEnabled(false);
      composerStack.speedBlurPass.setEnabled(false);
      composerStack.motionBlurPass.setEnabled(false);
      lighting.sun.castShadow = false;
      lighting.moonLight.castShadow = false;
      if (quantumTraveling && !wasQuantumTraveling) {
        composerStack.motionBlurEffect.reset();
      }
    } else {
      composerStack.n8aoPass?.setEnabled(composerStack.ambientOcclusionEnabled);
      composerStack.speedBlurPass.setEnabled(true);
      composerStack.motionBlurPass.setEnabled(composerStack.motionBlurEnabledByQuality);
      if (wasQuantumTraveling) {
        composerStack.motionBlurEffect.reset();
      }
      composerStack.motionBlurEffect.updateCamera(
        camera,
        new THREE.Vector3(focusBody.position.x, focusBody.position.y, focusBody.position.z),
        renderScale,
      );
    }
    wasQuantumTraveling = quantumTraveling;
    if (!quantumTraveling) {
      updateLocalLightShadowCull(
        stationMesh,
        camera.position,
        80 * renderScale,
        2,
      );
    }

    if (quantumTraveling) {
      renderQuantumIsolation(
        renderer,
        scene,
        camera,
        quantumBubble.getRenderRoot(),
        activeShipGroup,
        quantumLightingRoots,
      );
    } else if (quantumState.phase === 'dropOut') {
      // Reveal the destination without restarting the post stack yet. The
      // black fade and retracting shell cover this one-pass loading window.
      renderer.render(scene, camera);
    } else {
      composerStack.composer.render(dt);
    }

    const renderStats: RenderStats = {
      surfaceCache: getRenderableSurfaceCacheStats(),
      terrain: tileState.stats,
      vegetation: vegetationStats,
    };
    window.__claudecitizenRenderStats = renderStats;
    return renderStats;
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
    setEquippedInventory(inventory) {
      avatar.setEquippedInventory(inventory);
    },
    dispose() {
      cloudShell.dispose();
      lakeWaterManager.dispose();
      vegetationManager.dispose();
      remotePresence.dispose();
      quantumBubble.dispose();
      avatar.dispose();
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
