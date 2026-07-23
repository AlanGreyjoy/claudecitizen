import * as THREE from 'three';
import type {
  Planet,
  PlanetSurfaceSample,
  RenderStats,
  SpikeRenderWorld,
  Vec3,
} from '../../types';
import { normalize } from '../../math/vec3';
import { radialUp } from '../../world/coordinates';
import {
  getRenderableSurfaceCacheStats,
  sampleRenderablePlanetSurface,
} from '../../world/planet_surface';
import { clamp01 } from './domain/math';
import type { RenderMode } from './domain/types';
import type { StationFrame } from '../../world/station';
import { getShipLayout } from '../../player/ship_layout';
import { updateLocalLightShadowCull } from '../prefabs/prefab_renderer';
import type { PrefabDocument } from '../../world/prefabs/schema';
import { updateCameraRig, updateSpeedBlur } from './update/camera_rig';
import { updateEnvironment } from './update/environment';
import { updateShipPlacement, updateSunIntensity, updateSunSystem } from './update/sun_system';
import {
  evaluateQuantumEligibility,
  createQuantumTravelState,
  listNavDestinationMarkers,
  resolveNavDestinationId,
} from '../../flight/quantum_travel';
import { planApproachPrefetch } from '../planet_tiles/domain/approach_prefetch';
import type { CloudModeSetting } from '../../settings/game_settings';
import type { createPlanetTileManager } from '../planet_tiles';
import type { createPlanetVegetationManager } from '../vegetation';
import type { createSurfaceSpawnManager } from '../surface_spawns';
import type { createCloudShell, createPlanetSurfaceWaterManager } from '../effects';
import type { createComposerStack } from './scene/composer_stack';
import type { createShipRenderPool } from './scene/ship_render_pool';
import type { createCharacterAvatar } from './scene/character_avatar';
import type { createRemotePresenceRenderer } from './scene/remote_presence';
import type { createStationNpcRenderer } from './scene/station_npcs';
import type { createQuantumBubble } from '../effects/quantum_bubble';
import type { createMuzzleFlashRenderer } from '../effects/muzzle_flash';
import type { createHitDecalRenderer } from '../effects/hit_decals';
import type { createTracerRenderer } from '../effects/tracers';
import type { createSceneLighting } from './scene/scene_lighting';

const DAY_NIGHT_FADE_START_METERS = 18_000;
const QUANTUM_RENDER_LAYER = 1;
const QUANTUM_BACKGROUND = new THREE.Color(0x01030a);

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

function smoothstep01(value: number, edge0: number, edge1: number): number {
  const t = clamp01((value - edge0) / Math.max(edge1 - edge0, 0.000001));
  return t * t * (3 - 2 * t);
}

function resolveDayNightInfluence(altitudeMeters: number, atmosphereHeightMeters: number): number {
  const fadeStart = Math.min(DAY_NIGHT_FADE_START_METERS, atmosphereHeightMeters * 0.35);
  return 1 - smoothstep01(altitudeMeters, fadeStart, atmosphereHeightMeters);
}

export function enableRenderLayer(root: THREE.Object3D, layer: number): void {
  root.traverse((object) => object.layers.enable(layer));
}

export function renderQuantumIsolation(
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

  let branch: THREE.Object3D | null = quantumRoot;
  while (branch?.parent) {
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

export interface SpikeRenderFrameState {
  lastTime: number;
  quantumPreloadKey: string | null;
  quantumPreloadPosition: Vec3 | null;
  quantumPreloadSurface: PlanetSurfaceSample | null;
  quantumPreloadTileState: ReturnType<ReturnType<typeof createPlanetTileManager>['update']> | null;
  lastVegetationApproachPrefetchSeconds: number;
  lastQuantumPreloadUpdateSeconds: number;
  wasQuantumTraveling: boolean;
  lastFocusPosition: Vec3;
}

export interface SpikeRenderFrameDeps {
  planet: Planet;
  seed: number;
  getCloudMode: () => CloudModeSetting;
  tileManager: ReturnType<typeof createPlanetTileManager>;
  vegetationManager: ReturnType<typeof createPlanetVegetationManager>;
  surfaceSpawnManager: ReturnType<typeof createSurfaceSpawnManager>;
  cloudShell: ReturnType<typeof createCloudShell>;
  surfaceWaterManager: ReturnType<typeof createPlanetSurfaceWaterManager>;
  composerStack: ReturnType<typeof createComposerStack>;
  shipRenderPool: ReturnType<typeof createShipRenderPool>;
  avatar: ReturnType<typeof createCharacterAvatar>;
  remotePresence: ReturnType<typeof createRemotePresenceRenderer>;
  stationNpcs: ReturnType<typeof createStationNpcRenderer>;
  quantumBubble: ReturnType<typeof createQuantumBubble>;
  muzzleFlashRenderer: ReturnType<typeof createMuzzleFlashRenderer>;
  hitDecalRenderer: ReturnType<typeof createHitDecalRenderer>;
  tracerRenderer: ReturnType<typeof createTracerRenderer>;
  lighting: ReturnType<typeof createSceneLighting>;
  renderer: THREE.WebGLRenderer;
  scene: THREE.Scene;
  camera: THREE.PerspectiveCamera;
  cameraTarget: THREE.Vector3;
  stationFrame: StationFrame;
  stationMesh: THREE.Group;
  additionalStationMeshes: Array<{
    prefab: PrefabDocument;
    frame: StationFrame;
    mesh: THREE.Group | null;
  }>;
  atmosphereMesh: THREE.Mesh;
  defaultFog: THREE.Fog;
  quantumLightingRoots: readonly THREE.Object3D[];
  resolveSunTimeSeconds: (nowSeconds: number, up: Vec3) => number;
  syncSurfacePixelRatio: (altitudeMeters: number) => void;
  ensureAdditionalStationMesh: (
    entry: SpikeRenderFrameDeps['additionalStationMeshes'][number],
    focusPosition: Vec3,
  ) => THREE.Group | null;
}

interface RenderFocus {
  focusBody: NonNullable<SpikeRenderWorld['ship']> | NonNullable<SpikeRenderWorld['character']>;
  renderMode: RenderMode;
  dt: number;
  nowSeconds: number;
  quantumState: ReturnType<typeof createQuantumTravelState>;
  quantumTraveling: boolean;
  quantumBusy: boolean;
}

function resolveRenderFocus(
  world: SpikeRenderWorld,
  state: SpikeRenderFrameState,
): RenderFocus {
  const {
    character = null,
    mode = 'in-ship',
    ship,
    timeSeconds: nowSeconds = 0,
  } = world;
  const renderMode = mode as RenderMode;
  const dt = Math.max(0.0001, Math.min(nowSeconds - state.lastTime, 0.1));
  state.lastTime = nowSeconds;
  const focusBody = mode === 'in-ship' || mode === 'in-bed' || !character ? ship : character;
  state.lastFocusPosition.x = focusBody.position.x;
  state.lastFocusPosition.y = focusBody.position.y;
  state.lastFocusPosition.z = focusBody.position.z;
  const quantumState = world.quantum ?? createQuantumTravelState();
  const quantumTraveling = quantumState.phase === 'traveling';
  const quantumBusy =
    quantumState.phase === 'spooling' ||
    quantumTraveling ||
    quantumState.phase === 'dropOut';
  return {
    focusBody,
    renderMode,
    dt,
    nowSeconds,
    quantumState,
    quantumTraveling,
    quantumBusy,
  };
}

function syncQuantumPreload(
  deps: SpikeRenderFrameDeps,
  state: SpikeRenderFrameState,
  quantumTraveling: boolean,
  quantumState: ReturnType<typeof createQuantumTravelState>,
): void {
  if (!quantumTraveling || !quantumState.route) return;
  const preloadKey = quantumState.destinationId ?? 'quantum-destination';
  if (preloadKey === state.quantumPreloadKey) return;
  const radius = deps.planet.radiusMeters + quantumState.route.endAlt;
  state.quantumPreloadKey = preloadKey;
  state.quantumPreloadPosition = {
    x: quantumState.route.endDir.x * radius,
    y: quantumState.route.endDir.y * radius,
    z: quantumState.route.endDir.z * radius,
  };
  state.quantumPreloadSurface = sampleRenderablePlanetSurface(
    deps.planet,
    deps.seed,
    state.quantumPreloadPosition,
  );
}

interface LightingFrame {
  surface: PlanetSurfaceSample;
  altitudeFactor: number;
  spaceFactor: number;
  sunState: ReturnType<typeof updateSunSystem>;
  shipUp: Vec3;
  shipForward: Vec3;
  renderScale: number;
}

function updateLightingAndCamera(
  deps: SpikeRenderFrameDeps,
  world: SpikeRenderWorld,
  focus: RenderFocus,
  state: SpikeRenderFrameState,
): LightingFrame {
  const { focusBody, dt, nowSeconds, quantumTraveling } = focus;
  const surface =
    quantumTraveling && state.quantumPreloadSurface
      ? state.quantumPreloadSurface
      : sampleRenderablePlanetSurface(deps.planet, deps.seed, focusBody.position);
  deps.syncSurfacePixelRatio(surface.altitudeMeters);
  const up = radialUp(focusBody.position);
  const shipUp = normalize(world.ship.up ?? radialUp(world.ship.position));
  const shipForward = normalize(world.ship.forward);
  const altitudeFactor = clamp01(surface.altitudeMeters / deps.planet.atmosphereHeightMeters);
  const spaceFactor = clamp01(
    (surface.altitudeMeters - 18_000) / (deps.planet.atmosphereHeightMeters * 1.6),
  );
  const dayNightInfluence = resolveDayNightInfluence(
    surface.altitudeMeters,
    deps.planet.atmosphereHeightMeters,
  );
  const renderScale = deps.tileManager.renderScale;
  const sunState = updateSunSystem(
    deps.resolveSunTimeSeconds(nowSeconds, up),
    focusBody.position,
    renderScale,
    focus.renderMode,
    up,
    dayNightInfluence,
    {
      sun: deps.lighting.sun,
      sunMesh: deps.lighting.sunMesh,
      moonMesh: deps.lighting.moonMesh,
      moonLight: deps.lighting.moonLight,
    },
  );
  updateSunIntensity(deps.lighting.sun, sunState.rawDaylight, spaceFactor);
  updateCameraRig(
    deps.camera,
    deps.cameraTarget,
    world,
    renderScale,
    altitudeFactor,
    shipUp,
    shipForward,
    {
      station: { frame: deps.stationFrame, roomId: world.stationRoomId ?? null },
      dt,
    },
  );
  return { surface, altitudeFactor, spaceFactor, sunState, shipUp, shipForward, renderScale };
}

function updateTerrainStreaming(
  deps: SpikeRenderFrameDeps,
  focus: RenderFocus,
  lighting: LightingFrame,
  state: SpikeRenderFrameState,
  world: SpikeRenderWorld,
) {
  const { focusBody, nowSeconds, quantumTraveling } = focus;
  const focusVelocity = world.ship.velocity;
  let tileState: ReturnType<typeof deps.tileManager.update>;
  if (quantumTraveling && state.quantumPreloadPosition && state.quantumPreloadSurface) {
    if (!state.wasQuantumTraveling) {
      state.quantumPreloadTileState = null;
      state.lastQuantumPreloadUpdateSeconds = -Infinity;
    }
    if (
      !state.quantumPreloadTileState ||
      nowSeconds - state.lastQuantumPreloadUpdateSeconds >= 1 / 12
    ) {
      state.quantumPreloadTileState = deps.tileManager.update(
        state.quantumPreloadPosition,
        state.quantumPreloadSurface,
        { view: null, velocity: null },
      );
      state.lastQuantumPreloadUpdateSeconds = nowSeconds;
    }
    tileState = state.quantumPreloadTileState;
  } else {
    tileState = deps.tileManager.update(focusBody.position, lighting.surface, {
      view: null,
      velocity: focusVelocity,
    });
  }
  return { tileState, focusVelocity };
}

function maybePrefetchVegetation(
  deps: SpikeRenderFrameDeps,
  focus: RenderFocus,
  lighting: LightingFrame,
  state: SpikeRenderFrameState,
  focusVelocity: Vec3,
): void {
  const { focusBody, nowSeconds, quantumTraveling } = focus;
  if (quantumTraveling) return;
  if (
    lighting.surface.altitudeMeters >= 8_000 ||
    lighting.surface.altitudeMeters < 1_500 ||
    nowSeconds - state.lastVegetationApproachPrefetchSeconds < 0.35
  ) {
    return;
  }
  const vegPlan = planApproachPrefetch(
    deps.planet,
    focusBody.position,
    focusVelocity,
    lighting.surface.altitudeMeters,
  );
  if (!vegPlan || vegPlan.maxLevel < 14) return;
  state.lastVegetationApproachPrefetchSeconds = nowSeconds;
  for (const vegFocus of vegPlan.focuses) {
    deps.vegetationManager.prefetchAround(vegFocus, Math.min(vegPlan.radiusMeters, 800), {
      maxStarts: 4,
      minLevel: Math.max(14, vegPlan.minLevel),
      maxLevel: Math.min(16, vegPlan.maxLevel),
    });
  }
}

function updateWorldStreaming(
  deps: SpikeRenderFrameDeps,
  focus: RenderFocus,
  lighting: LightingFrame,
  state: SpikeRenderFrameState,
  world: SpikeRenderWorld,
) {
  const { focusBody, nowSeconds, quantumTraveling } = focus;
  const { tileState, focusVelocity } = updateTerrainStreaming(deps, focus, lighting, state, world);
  deps.tileManager.setVisible(!quantumTraveling);
  deps.surfaceWaterManager.setVisible(!quantumTraveling);
  deps.cloudShell.setVisible(!quantumTraveling && deps.getCloudMode() === 'shell');
  deps.vegetationManager.setVisible(!quantumTraveling);
  deps.surfaceSpawnManager.setVisible(!quantumTraveling);
  const vegetationStats = quantumTraveling
    ? IDLE_VEGETATION_STATS
    : deps.vegetationManager.update(
        focusBody.position,
        tileState.selectedTiles,
        lighting.surface.altitudeMeters,
        nowSeconds,
      );
  if (!quantumTraveling) {
    deps.surfaceSpawnManager.update(
      focusBody.position,
      tileState.selectedTiles,
      lighting.surface.altitudeMeters,
    );
    maybePrefetchVegetation(deps, focus, lighting, state, focusVelocity);
  }
  if (!quantumTraveling && deps.getCloudMode() === 'shell') {
    deps.cloudShell.update(
      focusBody.position,
      nowSeconds,
      lighting.spaceFactor,
      lighting.surface.altitudeMeters,
      {
        x: deps.camera.position.x,
        y: deps.camera.position.y,
        z: deps.camera.position.z,
      },
    );
  }
  return { tileState, vegetationStats };
}

function resolveQuantumHighlightId(
  deps: SpikeRenderFrameDeps,
  world: SpikeRenderWorld,
  focus: RenderFocus,
): string | null {
  const { quantumState } = focus;
  const flightMode = world.flightMode ?? 'traverse';
  if (flightMode === 'nav' && quantumState.phase === 'idle') {
    const eligibility = evaluateQuantumEligibility({
      body: world.ship,
      flightMode,
      quantum: quantumState,
      planet: deps.planet,
      seed: deps.seed,
    });
    return eligibility.ok
      ? eligibility.destinationId
      : resolveNavDestinationId(world.ship, deps.planet, deps.seed);
  }
  return quantumState.destinationId ?? null;
}

function updateShipsAndStations(
  deps: SpikeRenderFrameDeps,
  focus: RenderFocus,
  lighting: LightingFrame,
  world: SpikeRenderWorld,
) {
  const { focusBody, nowSeconds, quantumTraveling } = focus;
  const renderInstances =
    world.ships ??
    [
      {
        id: 'legacy',
        prefabId: getShipLayout().hullUrl ? 'active' : 'phobos-starhopper',
        body: world.ship,
        rig: world.shipRig ?? { gear01: 1, ramp01: 0, doors: {} },
      },
    ];
  deps.shipRenderPool.sync(
    renderInstances,
    world.activeShipId,
    focusBody.position,
    lighting.renderScale,
  );
  const activeShipGroup = deps.shipRenderPool.getActiveGroup();
  deps.quantumBubble.attachToShip(activeShipGroup);
  if (quantumTraveling) {
    enableRenderLayer(activeShipGroup, QUANTUM_RENDER_LAYER);
  }
  const highlightedId = resolveQuantumHighlightId(deps, world, focus);
  const markers = quantumTraveling
    ? []
    : listNavDestinationMarkers(deps.planet, deps.seed).map((marker) => ({
        ...marker,
        highlighted: marker.id === highlightedId,
      }));
  deps.quantumBubble.update({
    quantum: focus.quantumState,
    flightMode: world.flightMode ?? 'traverse',
    focusPosition: focusBody.position,
    markers,
    timeSeconds: nowSeconds,
  });
  if (!quantumTraveling) {
    updateShipPlacement(
      deps.stationMesh,
      {
        position: deps.stationFrame.origin,
        up: deps.stationFrame.up,
        forward: deps.stationFrame.forward,
      },
      focusBody.position,
      lighting.renderScale,
    );
    for (const extra of deps.additionalStationMeshes) {
      const mesh = deps.ensureAdditionalStationMesh(extra, focusBody.position);
      if (!mesh) continue;
      updateShipPlacement(
        mesh,
        {
          position: extra.frame.origin,
          up: extra.frame.up,
          forward: extra.frame.forward,
        },
        focusBody.position,
        lighting.renderScale,
      );
    }
  }
  deps.stationMesh.visible = !quantumTraveling;
  for (const extra of deps.additionalStationMeshes) {
    if (extra.mesh) extra.mesh.visible = !quantumTraveling;
  }
  return activeShipGroup;
}

function updateNormalPlayPresentation(
  deps: SpikeRenderFrameDeps,
  focus: RenderFocus,
  lighting: LightingFrame,
  world: SpikeRenderWorld,
  tileState: ReturnType<ReturnType<typeof createPlanetTileManager>['update']>,
): THREE.Color {
  const { focusBody, dt, nowSeconds, quantumBusy, quantumTraveling } = focus;
  const { character = null } = world;
  const volumetricEnabled = deps.getCloudMode() === 'volumetric';
  if (quantumTraveling) return QUANTUM_BACKGROUND;
  const { backgroundColor } = updateEnvironment({
    scene: deps.scene,
    defaultFog: deps.defaultFog,
    atmosphereMesh: deps.atmosphereMesh,
    lighting: deps.lighting,
    composerStack: deps.composerStack,
    planet: deps.planet,
    camera: deps.camera,
    sunState: lighting.sunState,
    altitudeMeters: lighting.surface.altitudeMeters,
    altitudeFactor: lighting.altitudeFactor,
    spaceFactor: lighting.spaceFactor,
    dt,
    nowSeconds,
    renderScale: lighting.renderScale,
    focusPosition: focusBody.position,
    volumetricEnabled: volumetricEnabled && !quantumBusy,
    stationInteriorActive:
      focus.renderMode === 'in-station' || focus.renderMode === 'riding-elevator',
  });
  deps.avatar.update(
    character,
    focusBody.position,
    nowSeconds,
    {
      headLook: character && !world.weaponAimActive
        ? (world.characterHeadLook ?? null)
        : null,
    },
  );
  deps.remotePresence.update(world.networkEntities ?? [], focusBody.position, nowSeconds);
  deps.stationNpcs.update(world.stationNpcs ?? [], focusBody.position, nowSeconds);
  deps.surfaceWaterManager.update(
    focusBody.position,
    tileState.selectedTiles,
    lighting.sunState.sunDir,
    dt,
    backgroundColor,
  );
  updateSpeedBlur(deps.composerStack.speedBlurEffect, world);
  return backgroundColor;
}

function configureComposerPasses(
  deps: SpikeRenderFrameDeps,
  focus: RenderFocus,
  lighting: LightingFrame,
  state: SpikeRenderFrameState,
): void {
  const { focusBody, quantumBusy, quantumTraveling } = focus;
  if (quantumBusy) {
    deps.composerStack.normalPass.setEnabled(false);
    deps.composerStack.n8aoPass?.setEnabled(false);
    deps.composerStack.volumetricFogPass.setEnabled(false);
    deps.composerStack.speedBlurPass.setEnabled(false);
    deps.composerStack.motionBlurPass.setEnabled(false);
    deps.lighting.sun.castShadow = false;
    deps.lighting.moonLight.castShadow = false;
    if (quantumTraveling && !state.wasQuantumTraveling) {
      deps.composerStack.motionBlurEffect.reset();
    }
  } else {
    deps.composerStack.n8aoPass?.setEnabled(deps.composerStack.ambientOcclusionEnabled);
    deps.composerStack.speedBlurPass.setEnabled(true);
    deps.composerStack.motionBlurPass.setEnabled(deps.composerStack.motionBlurEnabledByQuality);
    if (state.wasQuantumTraveling) {
      deps.composerStack.motionBlurEffect.reset();
    }
    deps.composerStack.motionBlurEffect.updateCamera(
      deps.camera,
      new THREE.Vector3(focusBody.position.x, focusBody.position.y, focusBody.position.z),
      lighting.renderScale,
    );
  }
  state.wasQuantumTraveling = quantumTraveling;
  if (!quantumTraveling) {
    updateLocalLightShadowCull(
      deps.stationMesh,
      deps.camera.position,
      80 * lighting.renderScale,
      2,
    );
  }
}

function presentRenderOutput(
  deps: SpikeRenderFrameDeps,
  focus: RenderFocus,
  activeShipGroup: THREE.Group,
): void {
  const { dt, quantumTraveling, quantumState } = focus;
  if (quantumTraveling) {
    renderQuantumIsolation(
      deps.renderer,
      deps.scene,
      deps.camera,
      deps.quantumBubble.getRenderRoot(),
      activeShipGroup,
      deps.quantumLightingRoots,
    );
    return;
  }
  if (quantumState.phase === 'dropOut') {
    deps.renderer.render(deps.scene, deps.camera);
    return;
  }
  deps.composerStack.composer.render(dt);
}

export function executeSpikeRenderFrame(
  deps: SpikeRenderFrameDeps,
  state: SpikeRenderFrameState,
  world: SpikeRenderWorld,
): RenderStats {
  const focus = resolveRenderFocus(world, state);
  deps.muzzleFlashRenderer.update(focus.dt, focus.focusBody.position, !focus.quantumTraveling);
  deps.hitDecalRenderer.update(focus.focusBody.position, !focus.quantumTraveling);
  deps.tracerRenderer.update(focus.dt, focus.focusBody.position, !focus.quantumTraveling);
  syncQuantumPreload(deps, state, focus.quantumTraveling, focus.quantumState);
  const lighting = updateLightingAndCamera(deps, world, focus, state);
  const { tileState, vegetationStats } = updateWorldStreaming(deps, focus, lighting, state, world);
  const activeShipGroup = updateShipsAndStations(deps, focus, lighting, world);
  updateNormalPlayPresentation(deps, focus, lighting, world, tileState);
  configureComposerPasses(deps, focus, lighting, state);
  presentRenderOutput(deps, focus, activeShipGroup);
  const renderStats: RenderStats = {
    surfaceCache: getRenderableSurfaceCacheStats(),
    terrain: tileState.stats,
    vegetation: vegetationStats,
  };
  window.__claudecitizenRenderStats = renderStats;
  return renderStats;
}

export { QUANTUM_BACKGROUND, QUANTUM_RENDER_LAYER };
