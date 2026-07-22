import {
  flightOptionsFromSpec,
  integrateFlightBody,
  integrateHoveringShip,
} from "../flight/flight_body";
import {
  recenterAimAsNoseTracks,
  resolveAimForward,
  resolveSeatLookForward,
} from "../flight/flight_aim";
import { projectDirectionToReticleOffset } from "../render/effects/hud/flight_reticle";
import {
  applyCockpitControlAction,
  cockpitControlLabel,
  projectWorldPointToScreenOffset,
  resolveCockpitGazeTarget,
} from "../player/cockpit_gaze";
import { resolveVisibleCockpitSpeedInstruments } from "../player/cockpit_stats";
import {
  createFlightCameraFeelState,
  updateFlightCameraFeel,
} from "../player/flight_camera_feel";
import {
  playCockpitControlToggleSfx,
  playShipRampToggleSfx,
} from "../player/ship_articulation_sfx";
import { resolveBoostMaxSpeedMps } from "../flight/flight_config";
import { cycleFlightMode } from "../flight/flight_modes";
import {
  advanceQuantumTravel,
  buildNavPrompt,
  consumePendingHandoffPlanetId,
  createQuantumTravelState,
  evaluateQuantumEligibility,
  tryBeginQuantumTravel,
} from "../flight/quantum_travel";
import { regenerateShipShields } from "../flight/ship_instance";
import { getShipInstance, listShipInstances, removeShipInstance } from "../flight/ship_world";
import { type createPlayerControls } from "./player_controls";
import type { KeyboardActionId } from "../flight/input_settings";
import {
  MODE_ENTERING_BED,
  MODE_IN_BED,
  MODE_IN_SHIP,
  MODE_IN_STATION,
  MODE_ENTERING_SHIP,
  MODE_LEAVING_BED,
  MODE_LEAVING_PILOT,
  MODE_ON_FOOT,
  MODE_ON_SHIP_DECK,
  MODE_RIDING_ELEVATOR,
} from "../player/modes";
import {
  CHARACTER_GROUND_OFFSET_METERS,
  createCharacterState,
  updateCharacterState,
} from "../player/character_controller";
import { initialCameraYaw } from "../player/spawn";
import {
  bedInteractPrompt,
  createDeckCharacterState,
  DECK_FLOOR_OFFSET_METERS,
  getDeckSpawnFloorHint,
  getDefaultDeckSpawnLocal,
  isOnShipRampDeck,
  isShipInteriorWalkPose,
  nearestBed,
  nearestDoor,
  nearestSeat,
  nearRampPanel,
  resolveDoorInteractAim,
  seatInteractPrompt,
  updateCharacterOnDeck,
  type DeckCharacterState,
} from "../player/ship_deck";
import { getShipLayout, getShipLayoutForPrefab, getShipRestHeightMeters, usesColliderDeck } from "../player/ship_layout";
import {
  getBedEyeLocal,
  isNearParkedShipPad,
  isShipParked,
  isWithinShipPadHorizontal,
  localOffsetToWorld,
  getShipRight,
  nearShipRampOutside,
  worldToShipLocal,
} from "../player/ship_interaction";
import {
  doorBlends,
  updateShipRig,
} from "../player/ship_rig";
import {
  DOOR_OPEN_COLLIDER_DISABLE_THRESHOLD,
  sampleColliderGroundHeight,
} from "../physics/colliders";
import {
  createShipPhysics,
  getShipPlayerLocal,
  getShipPlayerWorldPosition,
  occludeShipCamera,
  syncShipArticulationColliders,
  teleportShipPlayerLocal,
  type ShipPhysics,
} from "../physics/ship_physics";
import {
  createPlanetPhysics,
  planetPhysicsColliderRadiusMeters,
  type PlanetPhysics,
} from "../physics/planet_physics";
import { createLoopingSfxController, playSfx } from "../audio/sfx";
import {
  beginElevatorRide,
  callShipToHangar,
  elevatorDestinationFor,
  resolveStationInteraction,
  updateElevatorRide,
  type StationInteraction,
} from "../player/station_interaction";
import {
  createStationCharacterAt,
  stationYawForDir,
  updateCharacterInStation,
  type StationCharacterState,
} from "../player/station_walk";
import {
  resolveWeaponSlotPress,
  stanceIdForWeaponSlot,
} from "../player/inventory/weapon_select";
import {
  beginGetUpFromBedTransition,
  beginLieTransition,
  beginSitTransition,
  beginStandTransition,
  updateTransition,
} from "../player/transitions";
import { createWorldState, getActiveShip, getActiveShipBody, getActiveShipRig, PLAYER_SHIP_INSTANCE_ID, type WorldState } from "../player/world_state";
import { atmosphere01FromAltitude } from "../player/environment_status";
import { updatePlayerVitals } from "../player/vitals";
import {
  createEntertainmentCameraState,
  updateEntertainmentCameraFeel,
  type EntertainmentCameraFeel,
} from "../player/entertainment_camera";
import {
  entertainmentSystemLabel,
  resolveEntertainmentGazeTarget,
} from "../player/entertainment_gaze";
import type { AvmsTerminalController } from "../render/effects/hud/avms_terminal";
import type { BuildTerminalController } from "../render/effects/hud/build_terminal";
import type { EntertainmentSystemController } from "../render/effects/hud/entertainment_system";
import type { WeaponShopController } from "../render/effects/hud/weapon_shop";
import type { OutfittersController } from "../render/effects/hud/outfitters";
import type { PersonalInventoryController } from "../render/effects/hud/personal_inventory";
import type { PlayerVitalsSessionController } from "./player_vitals_session";
import type { InventoryState, LoadoutState } from "../player/inventory/types";
import { normalizeInventoryState } from "../player/inventory/types";
import {
  createEntertainmentScreen,
  type EntertainmentScreenHandle,
} from "../render/effects/entertainment_screen";
import {
  createWeaponShopScreen,
  type WeaponShopScreenHandle,
} from "../render/effects/weapon_shop_screen";
import {
  createOutfittersScreen,
  type OutfittersScreenHandle,
} from "../render/effects/outfitters_screen";
import {
  resolveStationWalkView,
  resolveWeaponShopGazeTarget,
  stationWalkAimOriginWorld,
  weaponShopLabel,
  weaponShopWorldPosition,
} from "../player/weapon_shop_gaze";
import {
  resolveOutfittersGazeTarget,
  outfittersLabel,
  outfittersWorldPosition,
} from "../player/outfitters_gaze";
import type { HangarBuildController } from "../player/hangar_build/build_controller";
import type { BuildPropColliderRuntime } from "../player/hangar_build/prop_colliders";
import { buildRoomForArea } from "../player/hangar_build/validation";
import type { HangarPropRenderer } from "../render/hangar/prop_instances";
import { pickStationFloorPoint } from "../render/hangar/prop_instances";
import {
  getStationFrame,
  getStationHangars,
  getStationLayoutOverride,
  sampleHangarRest,
  STATION_SPAWN,
  worldToStationLocal,
} from "../world/station";
import { cross, dot, length, normalize, sub } from "../math/vec3";
import { createSoundSceneController, type SoundListenerPose } from "../audio/sound_scene";
import {
  createFootstepController,
  footstepGaitFromAnimation,
  type FootstepActor,
  type FootstepSurface,
} from "../audio/footsteps";
import { createStationNpcPopulation } from "../npc/station_population";
import { resetAssignedHangarBay, setAssignedHangarBay } from "../net/api";
import { sampleFootPlanetSurface, sampleRenderablePlanetSurface } from "../world/planet_surface";
import {
  findSurfaceDestination,
  type SurfaceDestination,
} from "../world/biome_teleport";
import { cartesianFromLatLonAlt, radialUp, surfacePointFromPosition } from "../world/coordinates";
import { warmRenderableHeightRing } from "../world/spawn_warm";
import type { HudUpdateParams } from "../render/effects";
import type { SpikeRenderer } from "../render/main";
import type {
  ColorCorrectionSettings,
  GameMode,
  NetworkRenderEntity,
  Planet,
  SsaoSettings,
  StationNpcRenderState,
  Vec3,
} from "../types";
import type { BuildArea, GameBootstrap } from "../net/api";
import type { WorldClient } from "../net/world_client";
import {
  occludeStationCamera,
  syncDynamicColliders,
  teleportStationPlayer,
  type StationPhysics,
} from "../physics/station_physics";

type PlayerControls = ReturnType<typeof createPlayerControls>;

const STATION_SOUND_MODES = new Set<GameMode>([
  MODE_IN_STATION,
  MODE_RIDING_ELEVATOR,
]);
const SHIP_SOUND_MODES = new Set<GameMode>([
  MODE_IN_SHIP,
  MODE_ON_SHIP_DECK,
  MODE_ENTERING_SHIP,
  MODE_LEAVING_PILOT,
  MODE_ENTERING_BED,
  MODE_IN_BED,
  MODE_LEAVING_BED,
]);

export interface BuildAreaRuntime {
  controller: HangarBuildController;
  propRenderer: HangarPropRenderer;
  propColliders: BuildPropColliderRuntime;
}

export interface BuildRuntime {
  areas: Partial<Record<BuildArea, BuildAreaRuntime>>;
  terminal: BuildTerminalController;
}

import type { PrefabDocument, PrefabEntity } from "../world/prefabs/schema";


export interface GameLoopOptions {
  planet: Planet;
  seed: number;
  /** When `surface`, start on-foot at the landing site (planet authoring playtest). */
  spawn?: 'station' | 'surface';
  planetId?: string;
  systemId?: string;
  activeStationInstanceId?: string | null;
  controls: PlayerControls;
  renderer: SpikeRenderer | null;
  rendererError: unknown;
  network?: WorldClient | null;
  bootstrap?: GameBootstrap | null;
  avmsTerminal?: AvmsTerminalController | null;
  entertainmentSystem?: EntertainmentSystemController | null;
  weaponShop?: WeaponShopController | null;
  outfitters?: OutfittersController | null;
  personalInventory?: PersonalInventoryController | null;
  build?: BuildRuntime | null;
  physics?: StationPhysics | null;
  stationPrefab?: PrefabDocument | null;
  onHudUpdate: (params: HudUpdateParams) => void;
  onResetPeak: () => void;
  isPaused?: () => boolean;
  getInventoryLoadout?: () => LoadoutState;
  getInventory?: () => InventoryState | null;
  vitalsSession?: PlayerVitalsSessionController | null;
}

export function createGameLoop({
  planet,
  seed,
  spawn = 'station',
  planetId = 'asteron',
  systemId = 'default',
  activeStationInstanceId = null,
  controls,
  renderer,
  rendererError,
  network = null,
  bootstrap = null,
  avmsTerminal = null,
  entertainmentSystem = null,
  weaponShop = null,
  outfitters = null,
  personalInventory = null,
  build = null,
  physics = null,
  stationPrefab = null,
  onHudUpdate,
  onResetPeak,
  isPaused,
  getInventoryLoadout = () => ({}),
  getInventory = () => null,
  vitalsSession = null,
}: GameLoopOptions) {
  const esBezelEl =
    document.getElementById("es-bezel") ??
    document.querySelector<HTMLElement>(".sc-es-bezel");
  const esScreen: EntertainmentScreenHandle | null = esBezelEl
    ? createEntertainmentScreen({ panelEl: esBezelEl })
    : null;
  const onEsResize = () => esScreen?.resize();
  window.addEventListener("resize", onEsResize);

  const weaponShopBezelEl =
    document.getElementById("weapon-shop-bezel") ??
    document.querySelector<HTMLElement>(".sc-weapon-shop-bezel");
  const weaponShopScreen: WeaponShopScreenHandle | null = weaponShopBezelEl
    ? createWeaponShopScreen({ panelEl: weaponShopBezelEl })
    : null;
  const onWeaponShopResize = () => weaponShopScreen?.resize();
  window.addEventListener("resize", onWeaponShopResize);

  const outfittersBezelEl =
    document.getElementById("outfitters-bezel") ??
    document.querySelector<HTMLElement>(".sc-outfitters-bezel");
  const outfittersScreen: OutfittersScreenHandle | null = outfittersBezelEl
    ? createOutfittersScreen({ panelEl: outfittersBezelEl })
    : null;
  const onOutfittersResize = () => outfittersScreen?.resize();
  window.addEventListener("resize", onOutfittersResize);

  const buildBtnEl = document.getElementById("hud-build-btn");
  const onBuildBtnClick = () => {
    const runtime = buildRuntimeForCurrentRoom();
    if (!runtime || !build) return;
    build.terminal.open(runtime.controller);
  };
  buildBtnEl?.addEventListener("click", onBuildBtnClick);

  const weaponShopCameraState = createEntertainmentCameraState();
  const outfittersCameraState = createEntertainmentCameraState();
  let world: WorldState = createWorldState(planet, seed, {
    spawn,
    planetId,
    systemId,
    activeStationInstanceId,
    vitals: vitalsSession?.getVitals() ?? bootstrap?.player.vitals,
  });
  /** Local drawn weapon bar slot (`rifle-primary` / `rifle-secondary` / `handgun`) or holstered. */
  let activeWeaponSlotId: string | null = null;
  let shipPhysics: ShipPhysics | null = null;
  let shipPhysicsWarming = false;
  let planetPhysics: PlanetPhysics | null = null;
  const flightCameraFeelState = createFlightCameraFeelState();
  const esCameraState = createEntertainmentCameraState();
  let entertainmentCameraFeelFrame: EntertainmentCameraFeel | null = null;
  let flightCameraFeelFrame: {
    fovDeltaDeg: number;
    thrust01: number;
    boost01: number;
    eyeShake: { right: number; up: number; forward: number };
  } | null = null;
  const boostSfx = createLoopingSfxController();
  const thrustSfx = createLoopingSfxController();

  function disposeShipDeckPhysics(): void {
    shipPhysics?.dispose();
    shipPhysics = null;
  }

  async function warmShipDeckPhysics(): Promise<ShipPhysics | null> {
    if (!usesColliderDeck()) return null;
    if (shipPhysics) return shipPhysics;
    if (shipPhysicsWarming) return null;
    shipPhysicsWarming = true;
    try {
      const spawn = getDefaultDeckSpawnLocal();
      const floorHint = getDeckSpawnFloorHint(spawn);
      // No pad plane on planet — exterior feet snap to terrain so the character
      // does not float on a flat ship-local ground disc over hills.
      shipPhysics = await createShipPhysics(
        {
          right: spawn.right,
          up: floorHint + DECK_FLOOR_OFFSET_METERS,
          forward: spawn.forward,
        },
        getShipLayout().colliders,
      );
      return shipPhysics;
    } catch (error) {
      console.warn("Failed to create ship Rapier deck physics.", error);
      shipPhysics = null;
      return null;
    } finally {
      shipPhysicsWarming = false;
    }
  }

  void warmShipDeckPhysics();

  if (bootstrap?.hangar.assignedHangar) {
    world.assignedHangar = bootstrap.hangar.assignedHangar;
  }
  // Scan station prefab for animation components
  const stationAnimationStates: Record<string, { value: number; target: number; rate: number }> = {};
  if (stationPrefab) {
    const visit = (entity: PrefabEntity) => {
      for (const comp of entity.components ?? []) {
        if (comp.type === 'animation') {
          const duration = comp.duration ?? 1.0;
          const rate = duration > 0 ? 1 / duration : 1.5;
          const isOpen = comp.defaultOpen ?? false;
          stationAnimationStates[comp.id] = {
            value: isOpen ? 1 : 0,
            target: isOpen ? 1 : 0,
            rate,
          };
        }
      }
      for (const child of entity.children ?? []) {
        visit(child);
      }
    };
    visit(stationPrefab.root);
  }
  let lastNearbyPrefabInfoId: string | null = null;
  const soundScene = createSoundSceneController();
  const footsteps = createFootstepController();

  function toggleStationAnimation(id: string): void {
    const anim = stationAnimationStates[id];
    if (anim) {
      anim.target = anim.target === 1 ? 0 : 1;
    }
  }

  // Tracks the last setEnabled state per animation id so we only toggle Rapier
  // colliders on threshold crossings, not every frame.
  const doorColliderEnabled: Record<string, boolean> = {};

  function updateStationAnimations(dt: number): void {
    let changed = false;
    for (const anim of Object.values(stationAnimationStates)) {
      if (anim.value !== anim.target) {
        if (anim.value < anim.target) {
          anim.value = Math.min(anim.target, anim.value + anim.rate * dt);
        } else {
          anim.value = Math.max(anim.target, anim.value - anim.rate * dt);
        }
        changed = true;
      }
    }
    if (changed || dt === 0) {
      const blends: Record<string, number> = {};
      for (const [id, anim] of Object.entries(stationAnimationStates)) {
        blends[id] = anim.value;
      }
      renderer?.getStationRoot()?.userData.updateAnimations?.(blends);
    }
    // Toggle Rapier colliders on/off as doors cross the open threshold.
    if (physics) {
      for (const [id, anim] of Object.entries(stationAnimationStates)) {
        const shouldEnable = anim.value < DOOR_OPEN_COLLIDER_DISABLE_THRESHOLD;
        if (doorColliderEnabled[id] !== shouldEnable) {
          doorColliderEnabled[id] = shouldEnable;
          physics.setDoorColliderEnabled(id, shouldEnable);
        }
      }
    }
  }

  // Initial update of animation transforms + collider enabled states
  updateStationAnimations(0);

  let lastMs = performance.now();
  let running = false;
  let frameRendererError: unknown = rendererError;
  const stationFrame = getStationFrame(planet);
  const stationNpcPopulation = createStationNpcPopulation(
    getStationLayoutOverride(),
    stationFrame,
    seed,
  );

  function sceneVectorFromStation(vector: Vec3): Vec3 {
    return {
      x: -dot(vector, stationFrame.right),
      y: dot(vector, stationFrame.up),
      z: dot(vector, stationFrame.forward),
    };
  }

  function scenePointFromStation(point: Vec3): Vec3 {
    const local = worldToStationLocal(stationFrame, point);
    return { x: -local.right, y: local.up, z: local.forward };
  }

  function sceneVectorFromShip(vector: Vec3, ship: ReturnType<typeof getActiveShipBody>): Vec3 {
    const shipForward = normalize(ship.forward);
    return {
      x: -dot(vector, getShipRight(ship)),
      y: dot(vector, ship.up),
      z: dot(vector, shipForward),
    };
  }

  function scenePointFromShip(
    point: Vec3,
    ship: ReturnType<typeof getActiveShipBody>,
  ): Vec3 {
    const local = worldToShipLocal(ship, point);
    return { x: -local.right, y: local.up, z: local.forward };
  }

  /**
   * Camera-collision query handed to the renderer: sphere-cast from the
   * look pivot toward the desired camera position against every Rapier
   * world the character may be walking in, and keep the closest blocking
   * hit. Returns `to` unchanged when nothing blocks the line of sight.
   */
  function resolveCameraOcclusion(from: Vec3, to: Vec3): Vec3 {
    let best = to;
    let bestDistanceSq =
      (to.x - from.x) * (to.x - from.x) +
      (to.y - from.y) * (to.y - from.y) +
      (to.z - from.z) * (to.z - from.z);
    const consider = (candidate: Vec3): void => {
      const dx = candidate.x - from.x;
      const dy = candidate.y - from.y;
      const dz = candidate.z - from.z;
      const distanceSq = dx * dx + dy * dy + dz * dz;
      if (distanceSq < bestDistanceSq) {
        bestDistanceSq = distanceSq;
        best = candidate;
      }
    };
    const mode = world.mode;
    if ((mode === MODE_IN_STATION || mode === MODE_RIDING_ELEVATOR) && physics) {
      consider(occludeStationCamera(physics, stationFrame, from, to));
    }
    // Deck walking, hull/pad exterior walk, and seat/bed transitions all
    // live in the ship-local Rapier world. On foot or in a hangar the
    // parked hull can still block the orbit camera, so cast whenever the
    // ship world exists (a distant ship simply misses the cast).
    if (shipPhysics) {
      consider(occludeShipCamera(shipPhysics, getActiveShipBody(world), from, to));
    }
    if (mode === MODE_ON_FOOT && planetPhysics) {
      consider(planetPhysics.filterCamera(from, to));
    }
    return best;
  }

  function localFootstepActor(
    position: Vec3,
    surface: FootstepSurface,
  ): FootstepActor {
    return {
      id: "local-player",
      position,
      grounded: world.character.grounded,
      gait: footstepGaitFromAnimation(world.character.animation),
      surface,
      spatial: false,
    };
  }

  function stationFootstepActors(
    stationNpcs: readonly StationNpcRenderState[],
    networkEntities: readonly NetworkRenderEntity[],
  ): FootstepActor[] {
    const actors: FootstepActor[] = stationNpcs.map((npc) => ({
      id: `station-npc:${npc.id}`,
      position: scenePointFromStation(npc.position),
      grounded: true,
      gait: footstepGaitFromAnimation(npc.animation),
      surface: "metal",
      spatial: true,
      volume01: 0.72,
    }));
    if (world.mode === MODE_IN_STATION) {
      actors.push(
        localFootstepActor(
          scenePointFromStation(world.character.position),
          "metal",
        ),
      );
    }
    actors.push(
      ...remoteFootstepActors(
        networkEntities,
        "metal",
        scenePointFromStation,
        (entity) => entity.stationRoomId !== null,
      ),
    );
    return actors;
  }

  function remoteFootstepActors(
    networkEntities: readonly NetworkRenderEntity[],
    surface: FootstepSurface,
    transformPosition: (position: Vec3) => Vec3,
    include: (entity: NetworkRenderEntity) => boolean,
  ): FootstepActor[] {
    const actors: FootstepActor[] = [];
    for (const entity of networkEntities) {
      if (!entity.character || !include(entity)) continue;
      actors.push({
        id: `remote-player:${entity.id}`,
        position: transformPosition(entity.character.position),
        grounded: true,
        gait: footstepGaitFromAnimation(entity.character.animation),
        surface,
        spatial: true,
        volume01: 0.85,
      });
    }
    return actors;
  }

  function updateSceneSounds(
    focusPosition: Vec3,
    stationNpcs: readonly StationNpcRenderState[],
    networkEntities: readonly NetworkRenderEntity[],
    dtSeconds: number,
  ): void {
    const camera = renderer?.getCamera();
    const renderScale = renderer?.getRenderScale() ?? 1;
    const listenerWorld = camera
      ? {
          x: focusPosition.x + camera.position.x / renderScale,
          y: focusPosition.y + camera.position.y / renderScale,
          z: focusPosition.z + camera.position.z / renderScale,
        }
      : world.character.position;
    const matrix = camera?.matrixWorld.elements;
    const listenerForward = matrix
      ? { x: -matrix[8], y: -matrix[9], z: -matrix[10] }
      : world.character.forward;
    const listenerUp = matrix
      ? { x: matrix[4], y: matrix[5], z: matrix[6] }
      : world.character.up;

    if (STATION_SOUND_MODES.has(world.mode)) {
      const layout = getStationLayoutOverride();
      const local = worldToStationLocal(stationFrame, listenerWorld);
      const pose: SoundListenerPose = {
        position: { x: -local.right, y: local.up, z: local.forward },
        forward: sceneVectorFromStation(listenerForward),
        up: sceneVectorFromStation(listenerUp),
      };
      soundScene.setScene(
        stationPrefab ? `station:${stationPrefab.id}` : null,
        layout?.sounds ?? [],
      );
      soundScene.update(pose);
      footsteps.update(
        dtSeconds,
        pose,
        stationFootstepActors(stationNpcs, networkEntities),
      );
      return;
    }

    if (SHIP_SOUND_MODES.has(world.mode)) {
      const shipInstance = getActiveShip(world);
      const ship = shipInstance.body;
      const layout = getShipLayoutForPrefab(shipInstance.prefabId);
      const local = worldToShipLocal(ship, listenerWorld);
      soundScene.setScene(
        `ship:${shipInstance.id}:${shipInstance.prefabId}`,
        layout.sounds,
      );
      const pose: SoundListenerPose = {
        position: { x: -local.right, y: local.up, z: local.forward },
        forward: sceneVectorFromShip(listenerForward, ship),
        up: sceneVectorFromShip(listenerUp, ship),
      };
      soundScene.update(pose);
      footsteps.update(
        dtSeconds,
        pose,
        [
          ...(world.mode === MODE_ON_SHIP_DECK
            ? [
                localFootstepActor(
                  scenePointFromShip(world.character.position, ship),
                  "metal",
                ),
              ]
            : []),
          ...remoteFootstepActors(
            networkEntities,
            "metal",
            (position) => scenePointFromShip(position, ship),
            (entity) => entity.shipZoneId !== null,
          ),
        ],
      );
      return;
    }

    soundScene.setScene(null, []);
    const pose: SoundListenerPose = {
      position: listenerWorld,
      forward: listenerForward,
      up: listenerUp,
    };
    footsteps.update(
      dtSeconds,
      pose,
      [
        ...(world.mode === MODE_ON_FOOT
          ? [localFootstepActor(world.character.position, "terrain")]
          : []),
        ...remoteFootstepActors(
          networkEntities,
          "terrain",
          (position) => position,
          (entity) =>
            entity.mode === MODE_ON_FOOT &&
            entity.stationRoomId === null &&
            entity.shipZoneId === null,
        ),
      ],
    );
  }

  const transitionContext = {
    planet,
    seed,
    setControlsMode: controls.setMode.bind(controls),
    onDeckEntered: (
      local: { right: number; forward: number },
      floorUp: number,
    ) => {
      if (!usesColliderDeck()) return;
      if (!shipPhysics) {
        void warmShipDeckPhysics().then((physics) => {
          if (!physics) return;
          teleportShipPlayerLocal(physics, {
            right: local.right,
            up: floorUp + DECK_FLOOR_OFFSET_METERS,
            forward: local.forward,
          });
        });
        return;
      }
      teleportShipPlayerLocal(shipPhysics, {
        right: local.right,
        up: floorUp + DECK_FLOOR_OFFSET_METERS,
        forward: local.forward,
      });
    },
  };

  controls.setOrbitFacing(
    world.cameraOrbit.yawRadians,
    world.cameraOrbit.pitchRadians,
  );

  function keyLabel(action: KeyboardActionId): string {
    return controls.getKeyboardActionLabel(action);
  }

  function pressInteractPrompt(text: string): string {
    return `Press ${keyLabel("interact")} — ${text}`;
  }

  function holdPrompt(action: KeyboardActionId, text: string): string {
    return `Hold ${keyLabel(action)} — ${text}`;
  }

  function currentAnimStance() {
    if (activeWeaponSlotId) {
      const loadout = getInventory()?.loadout ?? getInventoryLoadout() ?? {};
      if (!loadout[activeWeaponSlotId]) activeWeaponSlotId = null;
    }
    return stanceIdForWeaponSlot(activeWeaponSlotId);
  }

  /** RMB aim with a drawn weapon → blend idle into the stance's aim-idle clip. */
  function currentWeaponAiming() {
    return activeWeaponSlotId !== null && controls.isSecondaryClickHeld();
  }

  function applyWeaponSlotPress(press: 1 | 2 | 3 | null): void {
    if (!press) return;
    const loadout =
      getInventory()?.loadout ?? getInventoryLoadout() ?? {};
    activeWeaponSlotId = resolveWeaponSlotPress(press, activeWeaponSlotId, loadout);
    syncEquippedInventory();
  }

  function teleportToSurface(destination: SurfaceDestination): boolean {
    const location = findSurfaceDestination(planet, seed, destination);
    if (!location) return false;

    const probe = cartesianFromLatLonAlt(
      location.latRadians,
      location.lonRadians,
      0,
      planet.radiusMeters,
    );
    if (![probe.x, probe.y, probe.z].every(Number.isFinite)) return false;
    warmRenderableHeightRing(planet, seed, probe, 450, 18);
    const surface = sampleFootPlanetSurface(planet, seed, probe);
    if (
      !Number.isFinite(surface.surfaceRadiusMeters) ||
      !Number.isFinite(surface.heightMeters)
    ) {
      return false;
    }
    const groundPosition = surfacePointFromPosition(
      probe,
      surface.surfaceRadiusMeters + CHARACTER_GROUND_OFFSET_METERS,
    );
    if (![groundPosition.x, groundPosition.y, groundPosition.z].every(Number.isFinite)) {
      return false;
    }
    const character = createCharacterState(groundPosition);
    world.character = character;
    world.mode = MODE_ON_FOOT;
    world.shipExteriorWalk = false;
    world.activeBedId = null;
    world.transition = null;
    world.stationElevator = null;
    world.screenFade = 0;
    world.flightMode = 'traverse';
    world.quantum = createQuantumTravelState();
    world.cameraOrbit = {
      pitchRadians: -0.12,
      yawRadians: initialCameraYaw(character),
      zoomDistance: 5.2,
    };
    controls.setMode(MODE_ON_FOOT);
    controls.setOrbitFacing(
      world.cameraOrbit.yawRadians,
      world.cameraOrbit.pitchRadians,
    );
    planetPhysics?.dispose();
    planetPhysics = null;
    return true;
  }

  // Console-only dev shortcuts (mirrors the __spikeScene diagnostic).
  window.__claudecitizenDev = {
    callShip: async () => {
      const hangar = await callShipToHangar(world, planet, seed, {
        ownedShip: bootstrap?.ships[0],
        playerId: bootstrap?.player.id,
        hangarInstanceId: bootstrap?.spawn.hangarInstanceId,
      });
      return hangar?.index ?? 0;
    },
    teleportToHangar: (index: number) => {
      const hangars = getStationHangars();
      const hangar =
        hangars.find((entry) => entry.index === index) ?? hangars[0];
      if (!hangar) return;
      world.character = createStationCharacterAt(
        stationFrame,
        hangar.roomId,
        { right: hangar.centerRight, forward: -12 },
        { right: 0, forward: 1 },
      );
      world.mode = MODE_IN_STATION;
      world.stationElevator = null;
      world.screenFade = 0;
    },
    face: (yawRadians: number, pitchRadians?: number) =>
      controls.setOrbitFacing(yawRadians, pitchRadians),
    setColorCorrection: (settings: Partial<ColorCorrectionSettings>) =>
      renderer?.setColorCorrectionSettings(settings),
    setSsaoSettings: (settings: Partial<SsaoSettings>) => renderer?.setSsaoSettings(settings),
    setSsaoIntensity: (intensity: number) => renderer?.setSsaoSettings({ intensity }),
    setSsaoColor: (color: string | null) => renderer?.setSsaoColor(color),
    getSurfaceSpawnDebug: () => {
      const focus = world.character.position;
      const layers = renderer?.getSurfaceSpawnLayers() ?? [];
      const nearby = renderer?.getNearbySurfaceSpawns(focus, 120) ?? [];
      const wide = renderer?.getNearbySurfaceSpawns(focus, 5_000) ?? [];
      let minDist = Infinity;
      for (const inst of wide) {
        const dx = inst.position.x - focus.x;
        const dy = inst.position.y - focus.y;
        const dz = inst.position.z - focus.z;
        const d = Math.hypot(dx, dy, dz);
        if (d < minDist) minDist = d;
      }
      return {
        layerCount: layers.length,
        layers: layers.map((layer) => ({
          id: layer.id,
          enabled: layer.enabled,
          assetUrl: layer.assetUrl,
          biomes: layer.biomes,
          minH: layer.minNormalizedHeight,
          maxH: layer.maxNormalizedHeight,
          density: layer.density,
          weight: layer.weight,
          collider: layer.collider,
        })),
        nearbyCount: nearby.length,
        activeColliders: planetPhysics?.getActiveColliderCount() ?? 0,
        meshCollisionAssets: renderer?.getSurfaceSpawnMeshCollisions()?.size ?? 0,
        within5km: wide.length,
        minDistMeters: Number.isFinite(minDist) ? Math.round(minDist) : null,
        sample: nearby.slice(0, 3),
        stats: renderer?.getSurfaceSpawnDebugStats() ?? null,
      };
    },
    teleportToSurface,
  };

  function resetWorld(): void {
    const wasVitalsLocked = world.vitalsSyncLocked;
    world = createWorldState(planet, seed, {
      spawn,
      planetId,
      systemId,
      activeStationInstanceId,
      vitals: vitalsSession?.getVitals() ?? world.vitals,
    });
    world.vitalsSyncLocked = wasVitalsLocked;
    controls.setMode(MODE_ON_FOOT);
    controls.setOrbitFacing(
      world.cameraOrbit.yawRadians,
      world.cameraOrbit.pitchRadians,
    );
    if (bootstrap) {
      network?.transition(
        bootstrap.spawn.apartmentInstanceId,
        bootstrap.spawn.stationRoomId,
      );
    }
    stationNpcPopulation.reset(seed);
    footsteps.reset();
    onResetPeak();
    if (wasVitalsLocked) returnToApartmentForVitalsFailure();
  }

  function setVitalsSyncLocked(locked: boolean): void {
    world.vitalsSyncLocked = locked;
    if (!locked && world.prompt.includes("Vitals sync")) world.prompt = "";
  }

  function syncApartmentInstanceForVitalsRecovery(): void {
    if (!bootstrap) return;
    network?.transition(bootstrap.spawn.apartmentInstanceId, STATION_SPAWN.roomId);
  }

  function returnToApartmentForVitalsFailure(): void {
    world.vitalsSyncLocked = true;
    world.character = createStationCharacterAt(
      stationFrame,
      STATION_SPAWN.roomId,
      { right: STATION_SPAWN.right, forward: STATION_SPAWN.forward },
      STATION_SPAWN.face,
      STATION_SPAWN.up,
    );
    world.mode = MODE_IN_STATION;
    world.shipExteriorWalk = false;
    world.prompt = "";
    world.activeBedId = null;
    world.transition = null;
    world.stationElevator = null;
    world.screenFade = 0;
    world.quantum = createQuantumTravelState();
    controls.setMode(MODE_ON_FOOT);
    controls.setOrbitFacing(
      world.cameraOrbit.yawRadians,
      world.cameraOrbit.pitchRadians,
    );
    disposeShipDeckPhysics();
    planetPhysics?.dispose();
    planetPhysics = null;
    if (physics) {
      teleportStationPlayer(physics, stationFrame, world.character.position);
    }
    syncApartmentInstanceForVitalsRecovery();
    stationNpcPopulation.reset(seed);
    footsteps.reset();
  }

  function cleanupForTitleReturn(): void {
    boostSfx.stop();
    thrustSfx.stop();
    footsteps.reset();
    disposeShipDeckPhysics();
    let clearedHangar = false;
    for (const instance of listShipInstances()) {
      const inPrivateHangar =
        bootstrap !== null && instance.instanceId === bootstrap.spawn.hangarInstanceId;
      const parkedInHangar =
        sampleHangarRest(
          stationFrame,
          instance.body.position,
          getShipRestHeightMeters(),
        ) !== null;
      if (!inPrivateHangar && !parkedInHangar) continue;
      removeShipInstance(instance.id);
      clearedHangar = true;
    }
    if (clearedHangar) world.assignedHangar = null;
    delete window.__claudecitizenWorld;
    delete window.__claudecitizenDev;
    window.__claudecitizenRenderStats = null;
  }

  function avmsPrompt(): string {
    return pressInteractPrompt("AVMS terminal");
  }

  function shipsForAvms(): GameBootstrap["ships"] {
    if (bootstrap?.ships.length) return bootstrap.ships;
    const ship = getActiveShip(world);
    return [
      {
        id: ship.id,
        shipDefinitionId: null,
        prefabId: ship.prefabId,
        displayName: ship.prefabId,
        hp: ship.vitals.hp,
        shields: ship.vitals.shields,
        maxHp: ship.spec.maxHp,
        maxShields: ship.spec.maxShields,
        shieldRegenPerSec: ship.spec.shieldRegenPerSec,
        maxSpeedMps: ship.spec.maxSpeedMps,
        throttleAccelMps2: ship.spec.throttleAccelMps2,
      },
    ];
  }

  function stationPrompt(interaction: StationInteraction | null): string {
    if (interaction) {
      if (isVitalsLockedApartmentExit(interaction)) {
        return "Vitals sync unavailable — apartment exit locked";
      }
      switch (interaction.kind) {
        case "hab-lift-down":
          return pressInteractPrompt("elevator to Lobby");
        case "hab-lift-up":
          return pressInteractPrompt("elevator to Habs");
        case "terminal":
        case "avms-terminal":
          return avmsPrompt();
        case "hangar-bank":
          return world.assignedHangar === null
            ? pressInteractPrompt("elevator to hangars")
            : pressInteractPrompt(
                `elevator to Hangar ${world.assignedHangar} (your ship)`,
              );
        case "hangar-lift-up":
          return pressInteractPrompt("elevator to Lobby");
        case "prefab-elevator":
          return pressInteractPrompt(`elevator to ${interaction.marker.targetFloor}`);
        case "prefab-info": {
          let promptText = interaction.prompt;
          if (interaction.interactionType === 'animation' && interaction.targetAnimationId) {
            const animState = stationAnimationStates[interaction.targetAnimationId];
            const isOpen = animState ? animState.target === 1 : false;
            if (isOpen) {
              promptText = promptText.replace(/\bopen\b/ig, (m) => m === 'open' ? 'close' : 'Close');
            }
          }
          const key = interaction.keyLabel ?? 'F';
          if (key !== 'F') {
            promptText = promptText.replace(/Press F\b/i, `Press ${key}`);
          }
          return promptText;
        }
      }
    }
    return "";
  }

  function isVitalsLockedApartmentExit(
    interaction: StationInteraction,
  ): boolean {
    if (!world.vitalsSyncLocked) return false;
    if (interaction.kind === "hab-lift-down") return true;
    if (interaction.kind === "prefab-elevator") {
      return interaction.marker.targetFloor !== "hab";
    }
    return (
      interaction.kind === "hangar-bank" ||
      interaction.kind === "hangar-lift-up"
    );
  }

  function networkInstanceForInteraction(
    interaction: StationInteraction,
  ): string | null {
    if (!bootstrap) return null;
    switch (interaction.kind) {
      case "hab-lift-down":
      case "hangar-lift-up":
        return "station:public";
      case "hab-lift-up":
        return bootstrap.spawn.apartmentInstanceId;
      case "hangar-bank":
        return bootstrap.spawn.hangarInstanceId;
      case "prefab-elevator":
        if (interaction.marker.targetFloor === "hangar")
          return bootstrap.spawn.hangarInstanceId;
        if (interaction.marker.targetFloor === "hab")
          return bootstrap.spawn.apartmentInstanceId;
        return "station:public";
      case "terminal":
      case "avms-terminal":
      case "prefab-info":
        return null;
    }
  }

  function announceElevatorTransition(
    interaction: StationInteraction,
    destination: { roomId: string } | null,
  ): void {
    const instanceId = networkInstanceForInteraction(interaction);
    if (!instanceId || !destination) return;
    network?.transition(instanceId, destination.roomId);
  }

  function updateShipSystems(dt: number): void {
    const pilotedId =
      world.mode === MODE_IN_SHIP ? getActiveShip(world).id : null;
    for (const instance of listShipInstances()) {
      // Unpiloted hulls still need gear-rest / hangar settle so outdoor
      // parking matches sandbox (ramp outside F + atShipGroundLevel).
      if (instance.id !== pilotedId) {
        instance.body = integrateHoveringShip(
          instance.body,
          dt,
          planet,
          seed,
          flightOptionsFromSpec(instance.spec),
        );
      }
      const rig = instance.rig;
      updateShipRig(rig, dt);
      regenerateShipShields(instance, dt);
    }
  }

  /** Ramp toggle prompt/action near the outside ramp control. */
  function handleRampOutside(interactPressed: boolean): string | null {
    const ship = getActiveShipBody(world);
    const rig = getActiveShipRig(world);
    if (!nearShipRampOutside(world.character, ship)) return null;
    if (interactPressed) {
      rig.rampDown = !rig.rampDown;
      playShipRampToggleSfx(getShipLayout().spec, rig.rampDown);
    }
    return rig.rampDown ? pressInteractPrompt("raise ramp") : pressInteractPrompt("lower ramp");
  }

  /**
   * Enter ship-local Rapier when near a parked ship (pad interest).
   * Continuous walk onto the open ramp — no ramp-tip teleport.
   */
  function tryEnterShipPadInterest(): boolean {
    if (!usesColliderDeck()) return false;
    const ship = getActiveShipBody(world);
    // A parked ship only owns locomotion for players sharing its walkable
    // area. Without this gate the raw ship-local proximity box reaches
    // through station walls/floors: delivering a ship to the hangar (or
    // walking past the lobby lift while a ship is parked) yanked players
    // into the empty ship-local Rapier world and dropped them through the
    // station.
    const hangarRest = sampleHangarRest(
      stationFrame,
      ship.position,
      getShipRestHeightMeters(),
    );
    if (world.mode === MODE_IN_STATION) {
      if (!hangarRest) return false;
      const roomId = (world.character as StationCharacterState).stationRoomId;
      if (roomId !== hangarRest.hangar.roomId) return false;
    } else if (hangarRest) {
      // On foot outdoors: hangar-parked ships are boarded from the hangar
      // deck (station mode), never by world-switching through station walls.
      return false;
    }
    if (!isNearParkedShipPad(world.character, ship)) return false;
    if (!shipPhysics) {
      void warmShipDeckPhysics();
      return false;
    }
    const rig = getActiveShipRig(world);
    const mountRig = {
      gear01: rig.gear01,
      ramp01: rig.ramp01,
      doors: doorBlends(rig),
    };
    const local = worldToShipLocal(ship, world.character.position);
    shipPhysics.setPadEnabled(true);
    shipPhysics.setPadRestHeight(getShipRestHeightMeters());
    teleportShipPlayerLocal(shipPhysics, {
      right: local.right,
      up: local.up,
      forward: local.forward,
    });
    syncShipArticulationColliders(
      shipPhysics,
      mountRig,
      getShipLayout().doors.map((door) => door.id),
    );
    // floorUp is mesh height; createDeckCharacterState adds DECK_FLOOR_OFFSET.
    world.character = createDeckCharacterState(
      ship,
      { right: local.right, forward: local.forward },
      undefined,
      mountRig,
      local.up - DECK_FLOOR_OFFSET_METERS,
    );
    world.mode = MODE_ON_SHIP_DECK;
    world.shipExteriorWalk = true;
    world.prompt = "";
    return true;
  }

  /**
   * Leave ship-local Rapier for planet/station at the character's current feet
   * (walked off the pad / freefall). Keeps ship physics warm for re-entry.
   */
  function leaveShipDeck(): void {
    const ship = getActiveShipBody(world);
    const feet = world.character.position;
    const facing = world.character.forward;
    world.shipExteriorWalk = false;

    const hangarRest = sampleHangarRest(
      stationFrame,
      ship.position,
      getShipRestHeightMeters(),
    );
    if (hangarRest) {
      const local = worldToStationLocal(stationFrame, feet);
      world.character = createStationCharacterAt(
        stationFrame,
        hangarRest.hangar.roomId,
        { right: local.right, forward: local.forward },
        {
          right: dot(facing, stationFrame.right),
          forward: dot(facing, stationFrame.forward),
        },
        hangarRest.surfaceUp,
      );
      if (physics) {
        teleportStationPlayer(physics, stationFrame, world.character.position);
      }
      world.mode = MODE_IN_STATION;
      return;
    }

    const surface = sampleFootPlanetSurface(planet, seed, feet);
    const groundPosition = surfacePointFromPosition(
      feet,
      surface.surfaceRadiusMeters + CHARACTER_GROUND_OFFSET_METERS,
    );
    world.character = createCharacterState(groundPosition, facing);
    world.mode = MODE_ON_FOOT;
  }

  function buildRuntimes(): BuildAreaRuntime[] {
    return [build?.areas.hangar, build?.areas.apartment].filter(
      (runtime): runtime is BuildAreaRuntime => Boolean(runtime),
    );
  }

  function buildRuntimeForArea(area: BuildArea): BuildAreaRuntime | null {
    return build?.areas[area] ?? null;
  }

  function buildAreaForCurrentRoom(): BuildArea | null {
    if (!bootstrap || world.mode !== MODE_IN_STATION) return null;
    const roomId = (world.character as StationCharacterState).stationRoomId;
    if (roomId === "hab" || roomId === "hab-room") return "apartment";
    if (roomId === "hangar" || roomId.startsWith("hangar-")) return "hangar";
    return null;
  }

  function buildRuntimeForCurrentRoom(): BuildAreaRuntime | null {
    const area = buildAreaForCurrentRoom();
    return area ? buildRuntimeForArea(area) : null;
  }

  function updateBuildBtnVisibility(): void {
    if (!buildBtnEl) return;
    const visible =
      Boolean(buildRuntimeForCurrentRoom()) && !(build?.terminal.isOpen() ?? false);
    buildBtnEl.classList.toggle("is-hidden", !visible);
  }

  function activeBuildRuntime(): BuildAreaRuntime | null {
    return (
      buildRuntimes().find((runtime) => runtime.controller.isBuildToolActive()) ?? null
    );
  }

  async function syncBuildPropsVisuals(runtime: BuildAreaRuntime): Promise<void> {
    const context = runtime.controller.getContext();
    const propColliders = runtime.propColliders.getColliders();
    if (physics) {
      await syncDynamicColliders(physics, propColliders);
    }
    await runtime.propRenderer.setPlacements(context.state.placements);
    await runtime.propColliders.setPlacements(context.state.placements);
    const ghost = context.ghost;
    const definition = context.selectedDefinitionId
      ? context.state.catalog.find((entry) => entry.id === context.selectedDefinitionId)
      : null;
    if (ghost && definition && context.toolMode === "place") {
      await runtime.propRenderer.setGhost({
        prefabId: definition.prefabId,
        transform: ghost,
      });
    } else if (context.toolMode === "move" && ghost && context.selectedPlacementId) {
      const placement = context.state.placements.find(
        (entry) => entry.id === context.selectedPlacementId,
      );
      if (placement) {
        await runtime.propRenderer.setGhost({
          prefabId: placement.prefabId,
          transform: ghost,
        });
      }
    } else {
      await runtime.propRenderer.setGhost(null);
    }
  }

  function pickBuildFloorFromPointer(
    runtime: BuildAreaRuntime,
  ): { right: number; up: number; forward: number } | null {
    if (!renderer) return null;
    const context = runtime.controller.getContext();
    const room = buildRoomForArea(context.state.area, context.state.assignedHangar);
    return pickStationFloorPoint(
      renderer.getCamera(),
      runtime.controller.getPointerNdc(),
      renderer.getStationRoot(),
      room.floorUp,
    );
  }

  function updateBuildTool(runtime: BuildAreaRuntime): void {
    if (!runtime.controller.isBuildToolActive()) return;
    const floorPoint = pickBuildFloorFromPointer(runtime);
    runtime.controller.updateGhostFromFloor(floorPoint);
    const context = runtime.controller.getContext();
    if (!context.ghost) {
      if (runtime.propRenderer.getGhost()) {
        void runtime.propRenderer.setGhost(null);
      }
      return;
    }

    const rendererGhost = runtime.propRenderer.getGhost();
    if (context.toolMode === "place") {
      const definition = context.selectedDefinitionId
        ? context.state.catalog.find((entry) => entry.id === context.selectedDefinitionId)
        : null;
      if (!definition) return;
      if (!rendererGhost || rendererGhost.prefabId !== definition.prefabId) {
        void runtime.propRenderer.setGhost({
          prefabId: definition.prefabId,
          transform: context.ghost,
        });
        return;
      }
    } else if (context.toolMode === "move" && context.selectedPlacementId) {
      const placement = context.state.placements.find(
        (entry) => entry.id === context.selectedPlacementId,
      );
      if (!placement) return;
      if (!rendererGhost || rendererGhost.prefabId !== placement.prefabId) {
        void runtime.propRenderer.setGhost({
          prefabId: placement.prefabId,
          transform: context.ghost,
        });
        return;
      }
    } else {
      if (rendererGhost) void runtime.propRenderer.setGhost(null);
      return;
    }

    runtime.propRenderer.updateGhostTransform(context.ghost);
  }

  function updateStationMode(
    characterInput: ReturnType<PlayerControls["sampleCharacterInput"]>,
    actions: ReturnType<PlayerControls["consumeActions"]>,
    dt: number,
  ): void {
    const activeRuntime = activeBuildRuntime();
    if (activeRuntime) {
      world.character = updateCharacterInStation(
        world.character as StationCharacterState,
        stationFrame,
        { ...characterInput, jumpPressed: actions.jumpPressed },
        dt,
        planet.gravityMetersPerSecond2 ?? 9.8,
        physics,
        currentAnimStance(),
        currentWeaponAiming(),
      );
      updateBuildTool(activeRuntime);
      const tool = activeRuntime.controller.getContext().toolMode;
      world.prompt =
        tool === "place"
          ? `Click to place · ${keyLabel("hangarRotate")} rotate · ${keyLabel("hangarCancel")} cancel · ${keyLabel("hangarBuild")} catalog`
          : tool === "move"
            ? `Click prop, move, click confirm · ${keyLabel("hangarCancel")} cancel · ${keyLabel("hangarBuild")} catalog`
            : `Click prop to pick up · ${keyLabel("hangarCancel")} cancel · ${keyLabel("hangarBuild")} catalog`;
      if (actions.hangarBuildPressed) build?.terminal.open(activeRuntime.controller);
      if (actions.hangarRotatePressed) {
        activeRuntime.controller.rotateGhost(Math.PI / 12);
        const ghost = activeRuntime.controller.getContext().ghost;
        if (ghost) activeRuntime.propRenderer.updateGhostTransform(ghost);
      }
      if (actions.hangarCancelPressed) {
        activeRuntime.controller.cancelTool();
        void syncBuildPropsVisuals(activeRuntime);
      }
      return;
    }

    world.character = updateCharacterInStation(
      world.character as StationCharacterState,
      stationFrame,
      { ...characterInput, jumpPressed: actions.jumpPressed },
      dt,
      planet.gravityMetersPerSecond2 ?? 9.8,
      physics,
      currentAnimStance(),
      currentWeaponAiming(),
    );

    if (tryEnterShipPadInterest()) return;

    const rampPrompt = handleRampOutside(actions.interactPressed);
    if (rampPrompt !== null) {
      world.prompt = rampPrompt;
      return;
    }

    const shops = getStationLayoutOverride()?.weaponShops ?? [];
    const outfittersShops = getStationLayoutOverride()?.outfitters ?? [];
    const walkView = resolveStationWalkView(
      stationFrame.forward,
      stationFrame.up,
      world.cameraOrbit.yawRadians,
      world.cameraOrbit.pitchRadians,
    );
    const shopEye = stationWalkAimOriginWorld(
      world.character.position,
      stationFrame.up,
      walkView.forward,
    );
    const shopHit = resolveWeaponShopGazeTarget(
      shops,
      stationFrame,
      shopEye,
      walkView.forward,
    );
    const outfittersHit = resolveOutfittersGazeTarget(
      outfittersShops,
      stationFrame,
      shopEye,
      walkView.forward,
    );

    if (weaponShopScreen && renderer && shops.length > 0) {
      weaponShopScreen.attachTo(renderer.getStationRoot());
      weaponShopScreen.setSpec(shopHit?.shop ?? shops[0]!);
    }
    if (outfittersScreen && renderer && outfittersShops.length > 0) {
      outfittersScreen.attachTo(renderer.getStationRoot());
      outfittersScreen.setSpec(outfittersHit?.shop ?? outfittersShops[0]!);
    }

    if (
      shopHit &&
      actions.interactPressed &&
      weaponShop &&
      !weaponShop.isOpen() &&
      !outfitters?.isOpen()
    ) {
      outfittersScreen?.setInteractive(false);
      outfittersScreen?.setPowered(false);
      weaponShopScreen?.setPowered(true);
      weaponShopScreen?.setInteractive(true);
      weaponShop.open({
        shop: shopHit.shop,
        onClose: () => {
          weaponShopScreen?.setInteractive(false);
          weaponShopScreen?.setPowered(false);
        },
      });
      world.prompt = "";
      return;
    }

    if (
      outfittersHit &&
      actions.interactPressed &&
      outfitters &&
      !outfitters.isOpen() &&
      !weaponShop?.isOpen()
    ) {
      weaponShopScreen?.setInteractive(false);
      weaponShopScreen?.setPowered(false);
      outfittersScreen?.setPowered(true);
      outfittersScreen?.setInteractive(true);
      outfitters.open({
        shop: outfittersHit.shop,
        onClose: () => {
          outfittersScreen?.setInteractive(false);
          outfittersScreen?.setPowered(false);
        },
      });
      world.prompt = "";
      return;
    }

    if (weaponShop?.isOpen() || outfitters?.isOpen()) {
      world.prompt = "";
      return;
    }

    if (shopHit) {
      weaponShopScreen?.setInteractive(false);
      weaponShopScreen?.setPowered(false);
      outfittersScreen?.setInteractive(false);
      outfittersScreen?.setPowered(false);
      world.prompt = pressInteractPrompt(weaponShopLabel(shopHit.shop));
      return;
    }

    if (outfittersHit) {
      weaponShopScreen?.setInteractive(false);
      weaponShopScreen?.setPowered(false);
      outfittersScreen?.setInteractive(false);
      outfittersScreen?.setPowered(false);
      world.prompt = pressInteractPrompt(outfittersLabel(outfittersHit.shop));
      return;
    }

    weaponShopScreen?.setInteractive(false);
    weaponShopScreen?.setPowered(false);
    outfittersScreen?.setInteractive(false);
    outfittersScreen?.setPowered(false);

    const interaction = resolveStationInteraction(
      world.character as StationCharacterState,
      stationFrame,
    );
    if (interaction?.kind === "prefab-info" && interaction.id) {
      if (interaction.id !== lastNearbyPrefabInfoId) {
        lastNearbyPrefabInfoId = interaction.id;
        if (interaction.proximitySoundUrl) playSfx(interaction.proximitySoundUrl);
      }
    } else {
      lastNearbyPrefabInfoId = null;
    }
    world.prompt = stationPrompt(interaction);
    if (!interaction) return;
    if (isVitalsLockedApartmentExit(interaction)) return;

    if (interaction.kind === "terminal" || interaction.kind === "avms-terminal") {
      if (actions.interactPressed) {
        avmsTerminal?.open({
          ships: shipsForAvms(),
          canStore: world.assignedHangar !== null,
          onStore: async () => {
            const ship = getShipInstance(PLAYER_SHIP_INSTANCE_ID);
            if (ship) {
              ship.instanceId = "stored";
              ship.body.position = { x: 0, y: -100000, z: 0 };
              ship.body.velocity = { x: 0, y: 0, z: 0 };
            }
            world.assignedHangar = null;
            world.prompt = "Ship stored.";
            if (bootstrap) {
              try {
                const response = await resetAssignedHangarBay();
                const hangarRuntime = buildRuntimeForArea("hangar");
                hangarRuntime?.controller.syncBootstrap(response, response.arcBalance);
                if (hangarRuntime) await syncBuildPropsVisuals(hangarRuntime);
              } catch (error) {
                console.warn("Failed to persist hangar store.", error);
              }
            }
          },
          onDeliver: async (ship) => {
            const hangar = await callShipToHangar(world, planet, seed, {
              ownedShip: ship,
              playerId: bootstrap?.player.id,
              hangarInstanceId: bootstrap?.spawn.hangarInstanceId,
            });
            if (!hangar) throw new Error("No hangar bays available.");
            world.prompt = `Ship delivered to Hangar ${hangar.index}`;
            if (bootstrap) {
              getActiveShip(world).instanceId = bootstrap.spawn.hangarInstanceId;
              try {
                const response = await setAssignedHangarBay(hangar.index);
                const hangarRuntime = buildRuntimeForArea("hangar");
                hangarRuntime?.controller.syncBootstrap(response, response.arcBalance);
                if (hangarRuntime) await syncBuildPropsVisuals(hangarRuntime);
              } catch (error) {
                console.warn("Failed to persist assigned hangar bay.", error);
              }
            }
          },
        });
      }
      return;
    }

    if (interaction.kind === "hangar-bank") {
      if (actions.interactPressed) {
        const hangarIndex = world.assignedHangar ?? 1;
        const destination = elevatorDestinationFor(interaction, hangarIndex);
        if (destination) {
          beginElevatorRide(world, destination);
          announceElevatorTransition(interaction, destination);
        }
      }
      return;
    }

    if (interaction.kind === 'prefab-info') {
      const key = interaction.keyLabel ?? 'F';
      const keyCode = `Key${key.toUpperCase()}`;
      const pressed = actions.wasKeyPressed ? actions.wasKeyPressed(keyCode) : (key === 'F' ? actions.interactPressed : false);
      if (pressed) {
        if (interaction.interactionType === 'animation' && interaction.targetAnimationId) {
          toggleStationAnimation(interaction.targetAnimationId);
        }
        if (interaction.interactSoundUrl) playSfx(interaction.interactSoundUrl);
      }
      return;
    }

    if (actions.interactPressed) {
      const destination = elevatorDestinationFor(interaction);
      if (destination) {
        beginElevatorRide(world, destination);
        announceElevatorTransition(interaction, destination);
      }
    }
  }

  /** Height above planet foot surface along radial up (meters). */
  function planetFeetHeightAbove(position: Vec3): number {
    const surface = sampleFootPlanetSurface(planet, seed, position);
    const groundWorld = surfacePointFromPosition(
      position,
      surface.surfaceRadiusMeters + CHARACTER_GROUND_OFFSET_METERS,
    );
    return dot(sub(position, groundWorld), radialUp(position));
  }

  function isPlanetFeetGrounded(
    position: Vec3,
    verticalVelocity: number,
  ): boolean {
    if (verticalVelocity > 0.15) return false;
    return planetFeetHeightAbove(position) <= 0.22;
  }

  /**
   * Exterior near-ship: keep Rapier XY (hull collision), stick to / land on
   * planet terrain. Does not kill jumps mid-air.
   */
  function syncShipExteriorFeetToPlanet(): void {
    if (!shipPhysics) return;
    const ship = getActiveShipBody(world);
    const deck = world.character as DeckCharacterState;
    const verticalVel = deck.shipVerticalVelocity ?? 0;
    const local = getShipPlayerLocal(shipPhysics);
    const approxWorld = getShipPlayerWorldPosition(shipPhysics, ship);
    const up = radialUp(approxWorld);
    const heightAbove = planetFeetHeightAbove(approxWorld);

    // Airborne: follow Rapier pose, keep vertical velocity, planet-radial up.
    if (verticalVel > 0.15 || heightAbove > 0.35) {
      world.character = {
        ...deck,
        position: approxWorld,
        up,
        grounded: false,
        airborneOffDeckFrames: 0,
        shipVerticalVelocity: verticalVel,
      };
      return;
    }

    const surface = sampleFootPlanetSurface(planet, seed, approxWorld);
    const groundWorld = surfacePointFromPosition(
      approxWorld,
      surface.surfaceRadiusMeters + CHARACTER_GROUND_OFFSET_METERS,
    );
    const groundLocal = worldToShipLocal(ship, groundWorld);
    teleportShipPlayerLocal(shipPhysics, {
      right: local.right,
      up: groundLocal.up,
      forward: local.forward,
    });
    const position = getShipPlayerWorldPosition(shipPhysics, ship);
    world.character = {
      ...deck,
      position,
      up: radialUp(position),
      grounded: true,
      jumpPhase: "grounded",
      airborneOffDeckFrames: 0,
      shipVerticalVelocity: 0,
    };
  }

  function updateDeckMode(
    characterInput: ReturnType<PlayerControls["sampleCharacterInput"]>,
    actions: ReturnType<PlayerControls["consumeActions"]>,
    dt: number,
  ): void {
    const instance = getActiveShip(world);
    const rig = instance.rig;
    const colliderRig = {
      gear01: rig.gear01,
      ramp01: rig.ramp01,
      doors: doorBlends(rig),
    };
    if (shipPhysics && usesColliderDeck()) {
      syncShipArticulationColliders(
        shipPhysics,
        colliderRig,
        getShipLayout().doors.map((door) => door.id),
      );
    }

    const prior = world.character as DeckCharacterState;
    const priorLocal = worldToShipLocal(instance.body, prior.position);
    const priorStructureFloor = sampleColliderGroundHeight(
      priorLocal.right,
      priorLocal.up + 4,
      priorLocal.forward,
      getShipLayout().colliders,
      colliderRig,
      priorLocal.up + 0.55,
    );
    const priorVertical = prior.shipVerticalVelocity ?? 0;
    const priorInterior =
      priorVertical <= 0.5 &&
      isShipInteriorWalkPose(
        { right: priorLocal.right, forward: priorLocal.forward },
        priorLocal.up,
        priorStructureFloor,
      );
    const likelyExterior =
      isShipParked(instance.body) &&
      isWithinShipPadHorizontal(prior, instance.body) &&
      (world.shipExteriorWalk || !priorInterior);
    // Planet jump only on ground — not while standing on the outer hull.
    const onHullContact =
      priorStructureFloor !== null &&
      priorLocal.up >= priorStructureFloor - 0.12 &&
      priorLocal.up <= priorStructureFloor + 0.85;
    const exteriorPlanetGrounded =
      likelyExterior &&
      !onHullContact &&
      isPlanetFeetGrounded(prior.position, priorVertical);

    const result = updateCharacterOnDeck(
      prior,
      instance.body,
      { ...characterInput, jumpPressed: actions.jumpPressed },
      dt,
      planet.gravityMetersPerSecond2 ?? 9.8,
      colliderRig,
      usesColliderDeck() ? shipPhysics : null,
      {
        exteriorPlanetGrounded,
        suppressDeckExit: likelyExterior,
      },
      currentAnimStance(),
      currentWeaponAiming(),
    );
    world.character = result.state;

    const deckLocal = result.state.deckLocal;
    const local = worldToShipLocal(instance.body, result.state.position);
    const structureFloor = sampleColliderGroundHeight(
      local.right,
      local.up + 4,
      local.forward,
      getShipLayout().colliders,
      colliderRig,
      local.up + 0.55,
    );
    const verticalVel = result.state.shipVerticalVelocity ?? 0;
    const onHullExterior =
      structureFloor !== null &&
      verticalVel <= 0.5 &&
      local.up >= structureFloor - 0.12 &&
      local.up <= structureFloor + 0.85 &&
      !isShipInteriorWalkPose(deckLocal, local.up, structureFloor);
    const onInterior =
      verticalVel <= 0.5 &&
      isShipInteriorWalkPose(deckLocal, local.up, structureFloor);

    if (!onInterior) {
      if (
        !isShipParked(instance.body) ||
        !isWithinShipPadHorizontal(world.character, instance.body)
      ) {
        leaveShipDeck();
        return;
      }
      world.shipExteriorWalk = true;
      if (onHullExterior) {
        // Outer hull / roof: keep Rapier contact, character-orbit camera.
        // Do not snap through the ship to planet ground.
        world.character = {
          ...result.state,
          up: radialUp(result.state.position),
          deckZone: undefined,
        };
        world.prompt = handleRampOutside(actions.interactPressed) ?? "";
        return;
      }
      syncShipExteriorFeetToPlanet();
      world.prompt = handleRampOutside(actions.interactPressed) ?? "";
      return;
    }

    world.shipExteriorWalk = false;

    if (result.dismounted || result.fellOffDeck) {
      leaveShipDeck();
      return;
    }

    const seatNearby = nearestSeat(deckLocal);
    if (seatNearby) {
      world.prompt = seatInteractPrompt(seatNearby, keyLabel("interact"));
      if (actions.interactPressed && seatNearby.role === "pilot")
        beginSitTransition(world);
      return;
    }

    const doorAim = resolveDoorInteractAim(
      instance.body,
      result.state.position,
      world.cameraOrbit.yawRadians,
      world.cameraOrbit.pitchRadians,
      world.cameraOrbit.zoomDistance,
    );
    const bedNearby = nearestBed(deckLocal, doorAim);
    if (bedNearby) {
      world.prompt = bedInteractPrompt(bedNearby, keyLabel("interact"));
      if (actions.interactPressed) beginLieTransition(world, bedNearby.id);
      return;
    }

    const doorNearby = nearestDoor(deckLocal, doorAim);
    if (doorNearby) {
      const door = getShipLayout().doors.find(
        (entry) => entry.id === doorNearby.doorId,
      );
      const doorRig = rig.doors[doorNearby.doorId];
      if (door && doorRig) {
        world.prompt = doorRig.isOpen
          ? pressInteractPrompt(`close ${door.label}`)
          : pressInteractPrompt(`open ${door.label}`);
        if (actions.interactPressed) {
          doorRig.isOpen = !doorRig.isOpen;
          const sfx = doorRig.isOpen ? door.openSoundUrl : door.closeSoundUrl;
          if (sfx) playSfx(sfx);
        }
        return;
      }
    }

    const standingOnRamp = isOnShipRampDeck(deckLocal);
    if (nearRampPanel(deckLocal) && !standingOnRamp) {
      world.prompt = rig.rampDown
        ? pressInteractPrompt("raise ramp")
        : pressInteractPrompt("lower ramp");
      if (actions.interactPressed) {
        rig.rampDown = !rig.rampDown;
        playShipRampToggleSfx(getShipLayout().spec, rig.rampDown);
      }
      return;
    }

    world.prompt = "";
  }

  function syncEquippedInventory(inventory?: InventoryState | null): void {
    const next = inventory
      ? normalizeInventoryState(inventory)
      : normalizeInventoryState(getInventory() ?? { catalog: [], items: [], loadout: getInventoryLoadout() });
    if (activeWeaponSlotId && !next.loadout[activeWeaponSlotId]) {
      activeWeaponSlotId = null;
    }
    renderer?.setEquippedInventory(next, activeWeaponSlotId);
  }

  function setEquippedLoadout(loadout: LoadoutState): void {
    const current = getInventory();
    if (current) {
      syncEquippedInventory({ ...current, loadout });
      return;
    }
    syncEquippedInventory({ catalog: [], items: [], loadout });
  }

  function frame(nowMs: number): void {
    if (!running) return;

    const paused = isPaused?.() ?? false;
    const frameDt = Math.min((nowMs - lastMs) / 1000, 1 / 30);
    const dt = paused ? 0 : frameDt;
    lastMs = nowMs;

    if (paused) {
      boostSfx.stop();
      thrustSfx.stop();
    }

    let camera = controls.sampleCameraState(0);

    if (!paused) {
      controls.setMode(
        world.mode === MODE_IN_SHIP
          ? MODE_IN_SHIP
          : world.mode === MODE_IN_BED
            ? MODE_IN_BED
            : MODE_ON_FOOT,
      );
      const actions = controls.consumeActions();
      applyWeaponSlotPress(actions.weaponSlotPress);
      camera = controls.sampleCameraState(dt);
      world.cameraOrbit = {
        pitchRadians: camera.pitchRadians,
        yawRadians: camera.yawRadians,
        zoomDistance: camera.zoomDistance,
      };
      world.shipCameraView = camera.shipCameraView;
      world.shipCameraZoom = camera.shipZoomDistance;

      const characterInput = controls.sampleCharacterInput();

      updateShipSystems(dt);

      if (world.mode === MODE_ON_FOOT) {
        flightCameraFeelFrame = null;
        boostSfx.stop();
        thrustSfx.stop();
        if (!planetPhysics && renderer) {
          planetPhysics = createPlanetPhysics(world.character.position);
        }
        if (planetPhysics && renderer) {
          const radius = planetPhysicsColliderRadiusMeters();
          const catalog = renderer.getSurfaceSpawnCatalog();
          const entries = catalog.entries;
          planetPhysics.syncNearby(
            world.character.position,
            renderer.getNearbySurfaceSpawns(world.character.position, radius),
            entries,
            {
              meshByAssetUrl: renderer.getSurfaceSpawnMeshCollisions(),
            },
          );
        }
        world.character = updateCharacterState(
          world.character,
          {
            ...characterInput,
            jumpPressed: actions.jumpPressed,
          },
          dt,
          planet,
          seed,
          planetPhysics,
          currentAnimStance(),
          currentWeaponAiming(),
        );
        if (!tryEnterShipPadInterest()) {
          world.prompt = handleRampOutside(actions.interactPressed) ?? "";
        }
      } else if (world.mode === MODE_IN_SHIP) {
        const instance = getActiveShip(world);

        if (actions.cycleFlightModePressed && world.quantum.phase === "idle") {
          world.flightMode = cycleFlightMode(world.flightMode);
        }

        if (actions.quantumEngagePressed && world.quantum.phase === "idle") {
          const eligibility = evaluateQuantumEligibility({
            body: instance.body,
            flightMode: world.flightMode,
            quantum: world.quantum,
            planet,
            seed,
          });
          if (eligibility.ok) {
            world.quantum = tryBeginQuantumTravel(
              world.quantum,
              instance.body,
              planet,
              seed,
              eligibility.destinationId,
            );
          }
        }

        if (world.quantum.phase !== "idle") {
          const quantumResult = advanceQuantumTravel(
            instance.body,
            world.quantum,
            dt,
            planet,
            seed,
          );
          instance.body = quantumResult.body;
          world.quantum = quantumResult.quantum;
          world.screenFade = quantumResult.screenFade;
          if (world.quantum.phase === "idle" && world.quantum.pendingHandoffPlanetId) {
            const handoff = consumePendingHandoffPlanetId(world.quantum);
            world.quantum = handoff.quantum;
            if (handoff.planetId) {
              const params = new URLSearchParams(window.location.search);
              params.set("boot", "play");
              params.set("planetId", handoff.planetId);
              if (!params.get("systemId")) params.set("systemId", world.systemId);
              params.delete("spawn");
              window.location.href = `/?${params.toString()}`;
              return;
            }
          }
          world.prompt =
            world.quantum.phase === "spooling"
              ? "Spooling…"
              : world.quantum.phase === "traveling"
                ? "Quantum travel"
                : world.quantum.phase === "idle"
                  ? ""
                  : "Drop out";
          flightCameraFeelFrame = updateFlightCameraFeel(
            flightCameraFeelState,
            { throttle01: 0, strafe01: 0, lift01: 0, boost01: 0 },
            instance.spec,
            dt,
          );
          boostSfx.setLevel(
            instance.spec.boostSoundUrl,
            flightCameraFeelFrame.boost01 * instance.spec.boostSoundVolume,
          );
          thrustSfx.setLevel(
            instance.spec.thrustSoundUrl,
            flightCameraFeelFrame.thrust01 * instance.spec.thrustSoundVolume,
          );
        } else {
          const flightInput = controls.sampleFlightInput();
          if (world.flightMode === "nav") {
            flightInput.throttle01 = (flightInput.throttle01 ?? 0) * 0.5;
          }
          const previousForward = instance.body.forward;
          const aim = controls.getFlightAim();
          const aimForward = resolveAimForward(instance.body, aim);
          instance.body = integrateFlightBody(
            instance.body,
            flightInput,
            dt,
            planet,
            seed,
            flightOptionsFromSpec(instance.spec, {
              coupled: controls.isCoupledMode(),
              aimForward,
            }),
          );
          controls.setFlightAim(
            recenterAimAsNoseTracks(aim, instance.body, previousForward),
          );

          if ((camera.shipCameraView ?? "cockpit") === "cockpit") {
            flightCameraFeelFrame = updateFlightCameraFeel(
              flightCameraFeelState,
              {
                throttle01: flightInput.throttle01 ?? 0,
                strafe01: flightInput.strafe01 ?? 0,
                lift01: flightInput.lift01 ?? 0,
                boost01: flightInput.boost01 ?? 0,
              },
              instance.spec,
              dt,
            );
          } else {
            flightCameraFeelFrame = updateFlightCameraFeel(
              flightCameraFeelState,
              { throttle01: 0, strafe01: 0, lift01: 0, boost01: 0 },
              instance.spec,
              dt,
            );
          }
          boostSfx.setLevel(
            instance.spec.boostSoundUrl,
            (flightCameraFeelFrame?.boost01 ?? 0) * instance.spec.boostSoundVolume,
          );
          thrustSfx.setLevel(
            instance.spec.thrustSoundUrl,
            (flightCameraFeelFrame?.thrust01 ?? 0) * instance.spec.thrustSoundVolume,
          );

          // Cockpit look-at controls: Hold F + gaze + left-click.
          if (controls.isSeatLookActive()) {
            const eye = localOffsetToWorld(instance.body, getShipLayout().pilotEye);
            const seat = controls.getSeatLook();
            const view = resolveSeatLookForward(
              instance.body.forward,
              instance.body.up,
              seat.yawRadians,
              seat.pitchRadians,
            );
            const hit = resolveCockpitGazeTarget(
              getShipLayout().cockpitControls,
              instance.body,
              eye,
              view.forward,
            );
            if (actions.primaryClickPressed && hit) {
              const applied = applyCockpitControlAction(
                hit.control.action,
                instance.rig,
              );
              if (applied) {
                playCockpitControlToggleSfx(
                  hit.control.action,
                  instance.rig,
                  getShipLayout().spec,
                );
              }
            }
          }

          if (actions.coupledToggled) {
            world.prompt = controls.isCoupledMode()
              ? "Coupled mode"
              : "Decoupled mode";
          } else if (world.flightMode === "nav") {
            world.prompt = buildNavPrompt({
              body: instance.body,
              flightMode: world.flightMode,
              quantum: world.quantum,
              planet,
              seed,
            });
          } else {
            world.prompt = `${holdPrompt("seatLook", "look around")} · ${holdPrompt("exitSeat", "get up")} · Alt+C coupled`;
          }
        }

        if (actions.exitSeatPressed && world.quantum.phase === "idle") {
          beginStandTransition(world);
        }
        if (world.quantum.phase === "idle" && world.screenFade > 0) {
          world.screenFade = Math.max(0, world.screenFade - dt * 4);
        }
      } else if (world.mode === MODE_IN_BED) {
        flightCameraFeelFrame = null;
        boostSfx.stop();
        thrustSfx.stop();
        const bedShip = getActiveShip(world);

        const layout = getShipLayout();
        const eyeLocal = getBedEyeLocal(world.activeBedId) ?? layout.pilotEye;
        const eye = localOffsetToWorld(bedShip.body, eyeLocal);
        const seat = controls.getSeatLook();
        const view = resolveSeatLookForward(
          bedShip.body.forward,
          bedShip.body.up,
          seat.yawRadians,
          seat.pitchRadians,
        );
        const esHit = resolveEntertainmentGazeTarget(
          layout.entertainmentSystems,
          bedShip.body,
          eye,
          view.forward,
        );

        if (esScreen && renderer && layout.entertainmentSystems.length > 0) {
          esScreen.attachTo(renderer.getActiveShipGroup());
          // Keep the physical panel anchored while in bed (nearest gaze or first).
          esScreen.setSpec(esHit?.system ?? layout.entertainmentSystems[0]!);
        }

        if (esHit && actions.interactPressed && entertainmentSystem && !entertainmentSystem.isOpen()) {
          esScreen?.setPowered(true);
          esScreen?.setInteractive(true);
          entertainmentSystem.open({
            onExitBed: () => {
              esScreen?.setInteractive(false);
              esScreen?.setPowered(false);
              beginGetUpFromBedTransition(world);
            },
            onClose: () => {
              esScreen?.setInteractive(false);
              esScreen?.setPowered(false);
            },
          });
          world.prompt = "";
        }

        if (actions.exitSeatPressed) {
          entertainmentSystem?.close();
          esScreen?.setInteractive(false);
          esScreen?.setPowered(false);
          esScreen?.setSpec(null);
          beginGetUpFromBedTransition(world);
        } else if (!entertainmentSystem?.isOpen()) {
          esScreen?.setInteractive(false);
          esScreen?.setPowered(false);
          world.prompt = esHit
            ? `${pressInteractPrompt(entertainmentSystemLabel(esHit.system))} · ${holdPrompt("exitSeat", "get up")}`
            : `Look around · ${holdPrompt("exitSeat", "get up")}`;
        }
      } else if (world.mode === MODE_ON_SHIP_DECK) {
        flightCameraFeelFrame = null;
        boostSfx.stop();
        thrustSfx.stop();
        updateDeckMode(characterInput, actions, dt);
      } else if (world.mode === MODE_IN_STATION) {
        flightCameraFeelFrame = null;
        boostSfx.stop();
        thrustSfx.stop();
        updateStationMode(characterInput, actions, dt);
      } else if (world.mode === MODE_RIDING_ELEVATOR) {
        flightCameraFeelFrame = null;
        boostSfx.stop();
        thrustSfx.stop();
        const ride = updateElevatorRide(world, stationFrame, dt, physics);
        world.prompt = ride.destination ? `${ride.destination.label}…` : "";
        if (ride.teleportedNow && ride.destination) {
          controls.setOrbitFacing(stationYawForDir(ride.destination.face));
        }
      } else {
        flightCameraFeelFrame = null;
        boostSfx.stop();
        thrustSfx.stop();
        updateTransition(world, dt, transitionContext);
      }

      if (world.quantum.phase !== "traveling") {
        updateStationAnimations(dt);
        renderer?.getStationRoot()?.userData.updateParticles?.(dt);
        renderer?.getStationRoot()?.userData.updateObjectAnimations?.(dt);
        for (const runtime of buildRuntimes()) {
          runtime.propRenderer.update(dt);
        }
      }
      network?.publishPresence(world);
    }

    stationNpcPopulation.update(STATION_SOUND_MODES.has(world.mode) ? dt : 0);
    const stationNpcRenderStates = STATION_SOUND_MODES.has(world.mode)
      ? stationNpcPopulation.getRenderStates()
      : [];
    const remoteEntities = network?.getRemoteEntities(nowMs) ?? [];

    const activeShip = getActiveShipBody(world);
    const focusUsesShip =
      world.mode === MODE_IN_SHIP || world.mode === MODE_IN_BED;
    const shipSurface = sampleRenderablePlanetSurface(
      planet,
      seed,
      activeShip.position,
    );
    const focusPosition = focusUsesShip
      ? activeShip.position
      : world.character.position;
    const focusVelocity = focusUsesShip
      ? activeShip.velocity
      : world.character.velocity;
    const focusSurface = focusUsesShip
      ? shipSurface
      : sampleRenderablePlanetSurface(planet, seed, focusPosition);

    // SC-style bunk screen zoom — ease even while ES UI pauses the sim.
    entertainmentCameraFeelFrame = null;
    if (world.mode === MODE_IN_BED || entertainmentSystem?.isOpen()) {
      const layout = getShipLayout();
      const systems = layout.entertainmentSystems;
      if (systems.length > 0) {
        const eyeLocal = getBedEyeLocal(world.activeBedId) ?? layout.pilotEye;
        const eye = localOffsetToWorld(activeShip, eyeLocal);
        const seat = controls.getSeatLook();
        const view = resolveSeatLookForward(
          activeShip.forward,
          activeShip.up,
          seat.yawRadians,
          seat.pitchRadians,
        );
        const esHit = resolveEntertainmentGazeTarget(
          systems,
          activeShip,
          eye,
          view.forward,
        );
        const screenSpec = esHit?.system ?? systems[0]!;
        const screen = localOffsetToWorld(activeShip, screenSpec.position);
        entertainmentCameraFeelFrame = updateEntertainmentCameraFeel(esCameraState, {
          dt: frameDt,
          open: entertainmentSystem?.isOpen() ?? false,
          gazing: Boolean(esHit),
          eye,
          screen,
          viewForward: view.forward,
        });
      }
    } else if (
      world.mode === MODE_IN_STATION ||
      weaponShop?.isOpen() ||
      outfitters?.isOpen()
    ) {
      const shops = getStationLayoutOverride()?.weaponShops ?? [];
      const outfittersShops = getStationLayoutOverride()?.outfitters ?? [];
      const walkView = resolveStationWalkView(
        stationFrame.forward,
        stationFrame.up,
        world.cameraOrbit.yawRadians,
        world.cameraOrbit.pitchRadians,
      );
      const eye = stationWalkAimOriginWorld(
        world.character.position,
        stationFrame.up,
        walkView.forward,
      );
      const shopHit = resolveWeaponShopGazeTarget(
        shops,
        stationFrame,
        eye,
        walkView.forward,
      );
      const outfittersHit = resolveOutfittersGazeTarget(
        outfittersShops,
        stationFrame,
        eye,
        walkView.forward,
      );

      if (shops.length > 0 && (shopHit || weaponShop?.isOpen())) {
        const screenSpec = shopHit?.shop ?? shops[0]!;
        const screen = weaponShopWorldPosition(stationFrame, screenSpec);
        entertainmentCameraFeelFrame = updateEntertainmentCameraFeel(
          weaponShopCameraState,
          {
            dt: frameDt,
            open: weaponShop?.isOpen() ?? false,
            gazing: Boolean(shopHit),
            eye,
            screen,
            viewForward: walkView.forward,
          },
        );
        if (outfittersCameraState.focus01 > 0) outfittersCameraState.focus01 = 0;
      } else if (
        outfittersShops.length > 0 &&
        (outfittersHit || outfitters?.isOpen())
      ) {
        const screenSpec = outfittersHit?.shop ?? outfittersShops[0]!;
        const screen = outfittersWorldPosition(stationFrame, screenSpec);
        entertainmentCameraFeelFrame = updateEntertainmentCameraFeel(
          outfittersCameraState,
          {
            dt: frameDt,
            open: outfitters?.isOpen() ?? false,
            gazing: Boolean(outfittersHit),
            eye,
            screen,
            viewForward: walkView.forward,
          },
        );
        if (weaponShopCameraState.focus01 > 0) weaponShopCameraState.focus01 = 0;
      } else {
        if (weaponShopCameraState.focus01 > 0) weaponShopCameraState.focus01 = 0;
        if (outfittersCameraState.focus01 > 0) outfittersCameraState.focus01 = 0;
      }
    } else if (esCameraState.focus01 > 0) {
      esCameraState.focus01 = 0;
    } else if (weaponShopCameraState.focus01 > 0) {
      weaponShopCameraState.focus01 = 0;
    } else if (outfittersCameraState.focus01 > 0) {
      outfittersCameraState.focus01 = 0;
    }

    let renderStats = null;
    try {
      renderStats =
        renderer?.render({
          cameraOrbit: world.cameraOrbit,
          shipCameraView: world.shipCameraView,
          shipCameraZoom: world.shipCameraZoom,
          seatLook: camera.seatLook,
          flightCameraFeel: flightCameraFeelFrame ?? undefined,
          entertainmentCameraFeel: entertainmentCameraFeelFrame ?? undefined,
          activeBedId: world.activeBedId,
          character:
            world.mode === MODE_IN_SHIP || world.mode === MODE_IN_BED
              ? null
              : {
                  animation: world.character.animation,
                  forward: world.character.forward,
                  position: world.character.position,
                  up: world.character.up,
                },
          weaponAimActive:
            !paused &&
            activeWeaponSlotId !== null &&
            controls.isSecondaryClickHeld() &&
            (world.mode === MODE_ON_FOOT ||
              world.mode === MODE_ON_SHIP_DECK ||
              world.mode === MODE_IN_STATION),
          mode: world.mode,
          shipExteriorWalk: world.shipExteriorWalk,
          prompt: world.prompt,
          ship: activeShip,
          activeShipId: world.activeShipId,
          ships: listShipInstances().map((instance) => ({
            id: instance.id,
            prefabId: instance.prefabId,
            body: instance.body,
            rig: {
              gear01: instance.rig.gear01,
              ramp01: instance.rig.ramp01,
              doors: doorBlends(instance.rig),
            },
            vitals: { ...instance.vitals },
            spec: {
              maxHp: instance.spec.maxHp,
              maxShields: instance.spec.maxShields,
            },
          })),
          shipRig: {
            gear01: getActiveShipRig(world).gear01,
            ramp01: getActiveShipRig(world).ramp01,
            doors: doorBlends(getActiveShipRig(world)),
          },
          networkEntities: remoteEntities,
          stationNpcs: stationNpcRenderStates,
          shipZoneId: world.character.deckZone ?? null,
          stationRoomId: world.character.stationRoomId ?? null,
          cameraOcclusion: resolveCameraOcclusion,
          timeSeconds: nowMs / 1000,
          flightMode: world.flightMode,
          quantum: world.quantum,
        }) ?? null;
    } catch (error) {
      console.error("ClaudeCitizen render frame failed.", error);
      frameRendererError = error;
    }
    window.__claudecitizenRenderStats = renderStats;
    window.__claudecitizenWorld = world;
    updateSceneSounds(focusPosition, stationNpcRenderStates, remoteEntities, dt);

    // CSS3D bunk screen — after WebGL so the camera matrix is final.
    if (esScreen && renderer && (world.mode === MODE_IN_BED || entertainmentSystem?.isOpen())) {
      const cam = renderer.getCamera();
      esScreen.sync();
      esScreen.render(cam);
    }
    if (
      weaponShopScreen &&
      renderer &&
      (world.mode === MODE_IN_STATION || weaponShop?.isOpen())
    ) {
      const cam = renderer.getCamera();
      weaponShopScreen.sync();
      weaponShopScreen.render(cam);
    }
    if (
      outfittersScreen &&
      renderer &&
      (world.mode === MODE_IN_STATION || outfitters?.isOpen())
    ) {
      const cam = renderer.getCamera();
      outfittersScreen.sync();
      outfittersScreen.render(cam);
    }

    let flightDual: HudUpdateParams["flightDual"];
    let cockpitGaze: HudUpdateParams["cockpitGaze"];
    let cockpitSpeed: HudUpdateParams["cockpitSpeed"];

    if (world.mode === MODE_IN_BED && !entertainmentSystem?.isOpen()) {
      const layout = getShipLayout();
      const eyeLocal = getBedEyeLocal(world.activeBedId) ?? layout.pilotEye;
      const eye = localOffsetToWorld(activeShip, eyeLocal);
      const seat = controls.getSeatLook();
      const view = resolveSeatLookForward(
        activeShip.forward,
        activeShip.up,
        seat.yawRadians,
        seat.pitchRadians,
      );
      const hit = resolveEntertainmentGazeTarget(
        layout.entertainmentSystems,
        activeShip,
        eye,
        view.forward,
      );
      if (hit) {
        const fovY = (60 * Math.PI) / 180;
        const viewportH = window.innerHeight;
        const offset = projectWorldPointToScreenOffset(
          hit.worldPosition,
          eye,
          view.forward,
          view.right,
          view.up,
          fovY,
          viewportH,
        );
        if (!offset.behind) {
          cockpitGaze = {
            visible: true,
            label: entertainmentSystemLabel(hit.system),
            offsetPx: { x: offset.x, y: offset.y },
          };
        }
      }
    }

    if (
      world.mode === MODE_IN_STATION &&
      !weaponShop?.isOpen() &&
      !outfitters?.isOpen()
    ) {
      const shops = getStationLayoutOverride()?.weaponShops ?? [];
      const outfittersShops = getStationLayoutOverride()?.outfitters ?? [];
      const walkView = resolveStationWalkView(
        stationFrame.forward,
        stationFrame.up,
        world.cameraOrbit.yawRadians,
        world.cameraOrbit.pitchRadians,
      );
      const eye = stationWalkAimOriginWorld(
        world.character.position,
        stationFrame.up,
        walkView.forward,
      );
      const hit = resolveWeaponShopGazeTarget(
        shops,
        stationFrame,
        eye,
        walkView.forward,
      );
      const outfittersHit = resolveOutfittersGazeTarget(
        outfittersShops,
        stationFrame,
        eye,
        walkView.forward,
      );
      const gazeHit = hit
        ? { worldPosition: hit.worldPosition, label: weaponShopLabel(hit.shop) }
        : outfittersHit
          ? {
              worldPosition: outfittersHit.worldPosition,
              label: outfittersLabel(outfittersHit.shop),
            }
          : null;
      if (gazeHit) {
        const fovY = (60 * Math.PI) / 180;
        const viewportH = window.innerHeight;
        const offset = projectWorldPointToScreenOffset(
          gazeHit.worldPosition,
          eye,
          walkView.forward,
          walkView.right,
          walkView.up,
          fovY,
          viewportH,
        );
        if (!offset.behind) {
          cockpitGaze = {
            visible: true,
            label: gazeHit.label,
            offsetPx: { x: offset.x, y: offset.y },
          };
        }
      }
    }

    if (world.mode === MODE_IN_SHIP) {
      const aim = controls.getFlightAim();
      const aimDir = resolveAimForward(activeShip, aim);
      // Project vs actual view: during Hold-F free look the reticle stays
      // world-locked on ship aim/nose (moves on screen as you look around).
      const seat = camera.seatLook;
      const seatLooking = controls.isSeatLookActive();
      const freeLooking =
        seatLooking ||
        (seat &&
          (Math.abs(seat.yawRadians) > 1e-6 ||
            Math.abs(seat.pitchRadians) > 1e-6));
      const view = freeLooking
        ? resolveSeatLookForward(
            activeShip.forward,
            activeShip.up,
            seat.yawRadians,
            seat.pitchRadians,
          )
        : {
            forward: activeShip.forward,
            up: activeShip.up,
            right: normalize(cross(activeShip.forward, activeShip.up)),
          };
      const fovY =
        ((72 + (flightCameraFeelFrame?.fovDeltaDeg ?? 0)) * Math.PI) / 180;
      const viewportH = window.innerHeight;
      const aimOff = projectDirectionToReticleOffset(
        aimDir,
        view.forward,
        view.right,
        view.up,
        fovY,
        viewportH,
      );
      const noseOff = projectDirectionToReticleOffset(
        activeShip.forward,
        view.forward,
        view.right,
        view.up,
        fovY,
        viewportH,
      );
      flightDual = {
        aimOffsetPx: { x: aimOff.x, y: aimOff.y },
        noseOffsetPx: { x: noseOff.x, y: noseOff.y },
        coupled: controls.isCoupledMode(),
      };

      const layout = getShipLayout();
      const eye = localOffsetToWorld(activeShip, layout.pilotEye);
      const boost01 = flightCameraFeelFrame?.boost01 ?? 0;
      const scmMax = layout.spec.maxSpeedMps;
      const boostMax = resolveBoostMaxSpeedMps(scmMax);
      const speedViews = resolveVisibleCockpitSpeedInstruments(
        layout.cockpitStats,
        activeShip,
        eye,
        view.forward,
        view.right,
        view.up,
        fovY,
        viewportH,
      );
      if (speedViews.length > 0) {
        const speedMps = length(activeShip.velocity);
        cockpitSpeed = {
          visible: true,
          instruments: speedViews.map((viewStat) => ({
            id: viewStat.id,
            offsetPx: viewStat.offsetPx,
            speedMps,
            scmMaxMps: scmMax,
            boostMaxMps: boostMax,
            boosting: boost01 > 0.05,
            boost01,
            ...(viewStat.label ? { label: viewStat.label } : {}),
          })),
        };
      }

      if (seatLooking) {
        const hit = resolveCockpitGazeTarget(
          layout.cockpitControls,
          activeShip,
          eye,
          view.forward,
        );
        if (hit) {
          const offset = projectWorldPointToScreenOffset(
            hit.worldPosition,
            eye,
            view.forward,
            view.right,
            view.up,
            fovY,
            viewportH,
          );
          if (!offset.behind) {
            const rig = getActiveShipRig(world);
            cockpitGaze = {
              visible: true,
              label: cockpitControlLabel(
                hit.control.action,
                { gearDown: rig.gearDown, rampDown: rig.rampDown },
                hit.control.label,
              ),
              offsetPx: { x: offset.x, y: offset.y },
            };
          }
        }
      }
    }

    const sprinting =
      !paused &&
      Boolean(controls.sampleCharacterInput().sprint) &&
      (world.mode === MODE_ON_FOOT ||
        world.mode === MODE_ON_SHIP_DECK ||
        world.mode === MODE_IN_STATION);
    const survivalVitals = vitalsSession?.update(nowMs, sprinting);
    if (survivalVitals) {
      world.vitals.hungerReserve01 = survivalVitals.hungerReserve01;
      world.vitals.thirstReserve01 = survivalVitals.thirstReserve01;
    }

    if (dt > 0) {
      const atmosphere01 = atmosphere01FromAltitude(
        focusSurface.altitudeMeters,
        planet.atmosphereHeightMeters,
      );
      world.vitals = updatePlayerVitals(world.vitals, dt, {
        grounded: world.character.grounded,
        sprinting,
        altitudeMeters: focusSurface.altitudeMeters,
        atmosphere01,
        timeSeconds: nowMs / 1000,
      });
    }

    onHudUpdate({
      world,
      focusSurface,
      focusVelocity,
      shipSurface,
      renderStats: renderStats ?? null,
      rendererError: frameRendererError,
      rendererMode: renderer?.rendererMode,
      planet,
      isPointerLocked: controls.isPointerLocked(),
      nowMs,
      weaponCrosshairVisible:
        !paused &&
        activeWeaponSlotId !== null &&
        (world.mode === MODE_ON_FOOT ||
          world.mode === MODE_ON_SHIP_DECK ||
          world.mode === MODE_IN_STATION),
      flightDual,
      cockpitGaze,
      cockpitSpeed,
    });
    updateBuildBtnVisibility();

    requestAnimationFrame(frame);
  }

  function start(): void {
    if (running) return;
    running = true;
    syncEquippedInventory();
    requestAnimationFrame((now) => {
      lastMs = now;
      requestAnimationFrame(frame);
    });
  }

  function stop(): void {
    running = false;
    entertainmentSystem?.close();
    weaponShop?.close();
    outfitters?.close();
    personalInventory?.close();
    buildBtnEl?.removeEventListener("click", onBuildBtnClick);
    buildBtnEl?.classList.add("is-hidden");
    window.removeEventListener("resize", onEsResize);
    window.removeEventListener("resize", onWeaponShopResize);
    window.removeEventListener("resize", onOutfittersResize);
    esScreen?.dispose();
    weaponShopScreen?.dispose();
    outfittersScreen?.dispose();
    boostSfx.stop();
    thrustSfx.stop();
    disposeShipDeckPhysics();
    planetPhysics?.dispose();
    planetPhysics = null;
    soundScene.dispose();
    footsteps.dispose();
    renderer?.getStationRoot()?.userData.disposeParticleSystems?.();
  }

  return {
    cleanupForTitleReturn,
    resetWorld,
    returnToApartmentForVitalsFailure,
    setEquippedLoadout,
    setVitalsSyncLocked,
    syncApartmentInstanceForVitalsRecovery,
    start,
    stop,
    teleportToSurface,
  };
}
