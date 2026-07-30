import * as THREE from 'three';
import type { WebGPURenderer } from 'three/webgpu';
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
} from '../../world/planet-surface';
import { clamp01 } from './domain/math';
import type { RenderMode } from './domain/types';
import type { StationFrame } from '../../world/station';
import { getShipLayout } from '../../player/ship-layout';
import { updateLocalLightShadowCull } from '../prefabs/prefab-renderer';
import { getTextureDedupSnapshot } from '../assets/texture-dedup';
import { drainSourceReleases, getPendingSourceReleaseCount } from '../assets/texture-upload';
import { getAssetResidencySnapshot } from '../../cache/asset-residency';

/** Textures released per frame. Small enough that a fresh scene cannot stall a frame. */
const SOURCE_RELEASE_BUDGET_PER_FRAME = 8;
import type { PrefabDocument } from '../../world/prefabs/schema';
import type { SceneEnvironmentConfig } from '../../world/scenes/scene-runtime';
import { updateCameraRig, updateSpeedBlur } from './update/camera-rig';
import { updateEnvironment } from './update/environment';
import { updateShipPlacement, updateSunIntensity, updateSunSystem } from './update/sun-system';
import {
  evaluateQuantumEligibility,
  createQuantumTravelState,
  listNavDestinationMarkers,
  resolveNavDestinationId,
} from '../../flight/quantum-travel';
import { planApproachPrefetch } from '../planet_tiles/domain/approach-prefetch';
import type { CloudModeSetting } from '../../settings/game-settings';
import type { createPlanetTileManager } from '../planet_tiles';
import type { createPlanetVegetationManager } from '../vegetation';
import type { createSurfaceSpawnManager } from '../surface_spawns';
import type { createCloudShell, createPlanetSurfaceWaterManager } from '../effects';
import type { MainPostStack } from './post/types';
import type { createShipRenderPool } from './scene/ship-render-pool';
import type { createCharacterAvatar } from './scene/character-avatar';
import type { createRemotePresenceRenderer } from './scene/remote-presence';
import type { createStationNpcRenderer } from './scene/station-npcs';
import type { createQuantumBubble } from '../effects/quantum-bubble';
import type { createMuzzleFlashRenderer } from '../effects/muzzle-flash';
import type { createHitDecalRenderer } from '../effects/hit-decals';
import type { createTracerRenderer } from '../effects/tracers';
import type { createSceneLighting } from './scene/scene-lighting';

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

const IDLE_TERRAIN_STATS = {
  ...IDLE_VEGETATION_STATS,
  buildMsAverage: 0,
  buildMsPeak: 0,
  pendingTiles: 0,
  queuedThisFrame: 0,
  workerBuildsEnabled: false,
};

/**
 * Stand-in surface sample for scenes with no planet. Lighting, fog, and the
 * skybox gate all key off altitude, so reporting a point well above the
 * atmosphere gives an interior scene space lighting without sampling terrain.
 */
function interiorSurfaceSample(planet: Planet): PlanetSurfaceSample {
  return {
    altitudeMeters: planet.atmosphereHeightMeters * 3,
    biome: 'rock',
    fertility: 0,
    grassDensity: 0,
    heightMeters: 0,
    lakeDepth: 0,
    lakeStrength: 0,
    lakeWaterLevelMeters: null,
    moisture: 0,
    mountainRegion: 0,
    normalizedHeight: 0,
    riverWaterLevelMeters: null,
    surfaceRadiusMeters: planet.radiusMeters,
    temperature: 0,
    treeDensity: 0,
    waterBody: null,
    waterLevelMeters: null,
  };
}

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
  renderer: WebGPURenderer,
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

type TileFrameState = ReturnType<ReturnType<typeof createPlanetTileManager>['update']>;

/**
 * The planet-only half of the renderer. Scenes that never reference a planet
 * (a station interior, a prefab stage) run with this set to `null`, which is
 * what keeps their terrain, vegetation, and surface-spawn workers from ever
 * starting.
 */
export interface PlanetRenderStack {
  tileManager: ReturnType<typeof createPlanetTileManager>;
  vegetationManager: ReturnType<typeof createPlanetVegetationManager>;
  surfaceSpawnManager: ReturnType<typeof createSurfaceSpawnManager>;
  cloudShell: ReturnType<typeof createCloudShell>;
  surfaceWaterManager: ReturnType<typeof createPlanetSurfaceWaterManager>;
  atmosphereMesh: THREE.Mesh;
  quantumBubble: ReturnType<typeof createQuantumBubble>;
}

export interface SpikeRenderFrameState {
  lastTime: number;
  quantumPreloadKey: string | null;
  quantumPreloadPosition: Vec3 | null;
  quantumPreloadSurface: PlanetSurfaceSample | null;
  quantumPreloadTileState: TileFrameState | null;
  lastVegetationApproachPrefetchSeconds: number;
  lastQuantumPreloadUpdateSeconds: number;
  wasQuantumTraveling: boolean;
  lastFocusPosition: Vec3;
}

export interface SpikeRenderFrameDeps {
  planet: Planet;
  seed: number;
  getCloudMode: () => CloudModeSetting;
  /** Null for scenes that declared no planet. */
  planetStack: PlanetRenderStack | null;
  renderScale: number;
  postStack: MainPostStack;
  shipRenderPool: ReturnType<typeof createShipRenderPool>;
  avatar: ReturnType<typeof createCharacterAvatar>;
  remotePresence: ReturnType<typeof createRemotePresenceRenderer>;
  stationNpcs: ReturnType<typeof createStationNpcRenderer>;
  muzzleFlashRenderer: ReturnType<typeof createMuzzleFlashRenderer>;
  hitDecalRenderer: ReturnType<typeof createHitDecalRenderer>;
  tracerRenderer: ReturnType<typeof createTracerRenderer>;
  lighting: ReturnType<typeof createSceneLighting>;
  renderer: WebGPURenderer;
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
  defaultFog: THREE.Fog;
  quantumLightingRoots: readonly THREE.Object3D[];
  resolveSunTimeSeconds: (nowSeconds: number, up: Vec3) => number;
  syncSurfacePixelRatio: (altitudeMeters: number) => void;
  ensureAdditionalStationMesh: (
    entry: SpikeRenderFrameDeps['additionalStationMeshes'][number],
    focusPosition: Vec3,
  ) => THREE.Group | null;
  sceneEnvironment: SceneEnvironmentConfig;
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
  if (!deps.planetStack || !quantumTraveling || !quantumState.route) return;
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
  let surface: PlanetSurfaceSample;
  if (!deps.planetStack) {
    surface = interiorSurfaceSample(deps.planet);
  } else if (quantumTraveling && state.quantumPreloadSurface) {
    surface = state.quantumPreloadSurface;
  } else {
    surface = sampleRenderablePlanetSurface(deps.planet, deps.seed, focusBody.position);
  }
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
  const renderScale = deps.renderScale;
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
  planetStack: PlanetRenderStack,
  focus: RenderFocus,
  lighting: LightingFrame,
  state: SpikeRenderFrameState,
  world: SpikeRenderWorld,
) {
  const { focusBody, nowSeconds, quantumTraveling } = focus;
  const focusVelocity = world.ship.velocity;
  let tileState: TileFrameState;
  if (quantumTraveling && state.quantumPreloadPosition && state.quantumPreloadSurface) {
    if (!state.wasQuantumTraveling) {
      state.quantumPreloadTileState = null;
      state.lastQuantumPreloadUpdateSeconds = -Infinity;
    }
    if (
      !state.quantumPreloadTileState ||
      nowSeconds - state.lastQuantumPreloadUpdateSeconds >= 1 / 12
    ) {
      state.quantumPreloadTileState = planetStack.tileManager.update(
        state.quantumPreloadPosition,
        state.quantumPreloadSurface,
        { view: null, velocity: null },
      );
      state.lastQuantumPreloadUpdateSeconds = nowSeconds;
    }
    tileState = state.quantumPreloadTileState;
  } else {
    tileState = planetStack.tileManager.update(focusBody.position, lighting.surface, {
      view: null,
      velocity: focusVelocity,
    });
  }
  return { tileState, focusVelocity };
}

function maybePrefetchVegetation(
  deps: SpikeRenderFrameDeps,
  planetStack: PlanetRenderStack,
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
    planetStack.vegetationManager.prefetchAround(vegFocus, Math.min(vegPlan.radiusMeters, 800), {
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
): { tileState: TileFrameState | null; vegetationStats: typeof IDLE_VEGETATION_STATS } {
  const planetStack = deps.planetStack;
  if (!planetStack) return { tileState: null, vegetationStats: IDLE_VEGETATION_STATS };
  const { focusBody, nowSeconds, quantumTraveling } = focus;
  const { tileState, focusVelocity } = updateTerrainStreaming(
    planetStack,
    focus,
    lighting,
    state,
    world,
  );
  planetStack.tileManager.setVisible(!quantumTraveling);
  planetStack.surfaceWaterManager.setVisible(!quantumTraveling);
  planetStack.cloudShell.setVisible(!quantumTraveling && deps.getCloudMode() === 'shell');
  planetStack.vegetationManager.setVisible(!quantumTraveling);
  planetStack.surfaceSpawnManager.setVisible(!quantumTraveling);
  const vegetationStats = quantumTraveling
    ? IDLE_VEGETATION_STATS
    : planetStack.vegetationManager.update(
        focusBody.position,
        tileState.selectedTiles,
        lighting.surface.altitudeMeters,
        nowSeconds,
      );
  if (!quantumTraveling) {
    planetStack.surfaceSpawnManager.update(
      focusBody.position,
      tileState.selectedTiles,
      lighting.surface.altitudeMeters,
    );
    maybePrefetchVegetation(deps, planetStack, focus, lighting, state, focusVelocity);
  }
  if (!quantumTraveling && deps.getCloudMode() === 'shell') {
    planetStack.cloudShell.update(
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
        rig: world.shipRig ?? { gear01: 1, ramp01: 0, canopy01: 0, doors: {} },
      },
    ];
  deps.shipRenderPool.sync(
    renderInstances,
    world.activeShipId,
    focusBody.position,
    lighting.renderScale,
  );
  const activeShipGroup = deps.shipRenderPool.getActiveGroup();
  const quantumBubble = deps.planetStack?.quantumBubble ?? null;
  if (quantumBubble) {
    quantumBubble.attachToShip(activeShipGroup);
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
    quantumBubble.update({
      quantum: focus.quantumState,
      flightMode: world.flightMode ?? 'traverse',
      focusPosition: focusBody.position,
      markers,
      timeSeconds: nowSeconds,
    });
  }
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
  tileState: TileFrameState | null,
): THREE.Color {
  const { focusBody, dt, nowSeconds, quantumBusy, quantumTraveling } = focus;
  const { character = null } = world;
  const volumetricEnabled = deps.getCloudMode() === 'volumetric';
  if (quantumTraveling) return QUANTUM_BACKGROUND;
  const { backgroundColor } = updateEnvironment({
    scene: deps.scene,
    defaultFog: deps.defaultFog,
    atmosphereMesh: deps.planetStack?.atmosphereMesh ?? null,
    lighting: deps.lighting,
    postStack: deps.postStack,
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
      focus.renderMode === 'in-station',
    sceneEnvironment: deps.sceneEnvironment,
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
  if (deps.planetStack && tileState) {
    deps.planetStack.surfaceWaterManager.update(
      focusBody.position,
      tileState.selectedTiles,
      lighting.sunState.sunDir,
      dt,
      backgroundColor,
    );
  }
  updateSpeedBlur(deps.postStack.setSpeedBlurStrength, world);
  return backgroundColor;
}

function configurePostStack(
  deps: SpikeRenderFrameDeps,
  focus: RenderFocus,
  lighting: LightingFrame,
  state: SpikeRenderFrameState,
): void {
  const { focusBody, quantumBusy, quantumTraveling } = focus;
  deps.postStack.setEffectsEnabled(!quantumBusy);
  if (quantumBusy) {
    deps.lighting.sun.castShadow = false;
    deps.lighting.moonLight.castShadow = false;
    if (quantumTraveling && !state.wasQuantumTraveling) {
      deps.postStack.resetMotionBlur();
    }
  } else {
    if (state.wasQuantumTraveling) {
      deps.postStack.resetMotionBlur();
    }
    deps.postStack.updateMotionBlurCamera(
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
  const quantumBubble = deps.planetStack?.quantumBubble ?? null;
  if (quantumTraveling && quantumBubble) {
    renderQuantumIsolation(
      deps.renderer,
      deps.scene,
      deps.camera,
      quantumBubble.getRenderRoot(),
      activeShipGroup,
      deps.quantumLightingRoots,
    );
    return;
  }
  if (quantumState.phase === 'dropOut') {
    deps.renderer.render(deps.scene, deps.camera);
    return;
  }
  deps.postStack.render(dt);
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
  configurePostStack(deps, focus, lighting, state);
  presentRenderOutput(deps, focus, activeShipGroup);
  // After present: uploads are settled for this frame, so freeing the decoded
  // CPU bitmaps is safe. Budgeted so a freshly loaded scene cannot stall a frame.
  drainSourceReleases(deps.renderer, SOURCE_RELEASE_BUDGET_PER_FRAME);
  const dedup = getTextureDedupSnapshot();
  const residency = getAssetResidencySnapshot();
  const renderStats: RenderStats = {
    assets: {
      canonicalTextures: dedup.entries,
      dedupExamined: dedup.examined,
      dedupReused: dedup.reused,
      entries: residency.entries,
      generation: residency.generation,
    },
    gpu: {
      estimatedTextureBytes: dedup.estimatedBytes,
      geometries: deps.renderer.info.memory.geometries,
      pendingSourceReleases: getPendingSourceReleaseCount(),
      // WebGPU's Info tracks no compiled-program count. Draw calls are the
      // closest per-frame pipeline signal the HUD can show instead.
      programs: deps.renderer.info.render.drawCalls,
      textures: deps.renderer.info.memory.textures,
    },
    surfaceCache: getRenderableSurfaceCacheStats(),
    terrain: tileState?.stats ?? IDLE_TERRAIN_STATS,
    vegetation: vegetationStats,
  };
  window.__claudecitizenRenderStats = renderStats;
  return renderStats;
}

export { QUANTUM_BACKGROUND, QUANTUM_RENDER_LAYER };
