import { createWorldState, type WorldState } from "../player/world_state";
import {
  createFlightCameraFeelState,
} from "../player/flight_camera_feel";
import { createEntertainmentCameraState } from "../player/entertainment_camera";
import { createLoopingSfxController } from "../audio/sfx";
import { createSoundSceneController } from "../audio/sound_scene";
import { createFootstepController } from "../audio/footsteps";
import { createStationNpcPopulation } from "../npc/station_population";
import {
  getStationFrame,
  getStationLayoutOverride,
  type StationFrame,
} from "../world/station";
import type { WeaponFireState } from "../player/weapon_fire";
import type { BallisticSegment } from "../player/weapon_ballistics";
import type { ShipPhysics } from "../physics/ship_physics";
import type { PlanetPhysics } from "../physics/planet_physics";
import type { StationPhysics } from "../physics/station_physics";
import type { EntertainmentScreenHandle } from "../render/effects/entertainment_screen";
import type { WeaponShopScreenHandle } from "../render/effects/weapon_shop_screen";
import type { OutfittersScreenHandle } from "../render/effects/outfitters_screen";
import type { FoodShopScreenHandle } from "../render/effects/food_shop_screen";
import type { SpikeRenderer } from "../render/main";
import type { WorldClient } from "../net/world_client";
import type { GameBootstrap } from "../net/api";
import type { AvmsTerminalController } from "../render/effects/hud/avms_terminal";
import type { EntertainmentSystemController } from "../render/effects/hud/entertainment_system";
import type { WeaponShopController } from "../render/effects/hud/weapon_shop";
import type { OutfittersController } from "../render/effects/hud/outfitters";
import type { FoodShopController } from "../render/effects/hud/food_shop";
import type { PersonalInventoryController } from "../render/effects/hud/personal_inventory";
import type { PlayerVitalsSessionController } from "../app/player_vitals_session";
import type { HudUpdateParams } from "../render/effects";
import type { PrefabDocument } from "../world/prefabs/schema";
import type {
  InventoryState,
  LoadoutState,
} from "../player/inventory/types";
import type { CharacterUpperBodyAim, Planet } from "../types";
import type {
  BuildRuntime,
  GameLoopOptions,
  PlayerControls,
  WeaponCombatRuntimeEvent,
} from "./types";

interface StationAnimationState {
  value: number;
  target: number;
  rate: number;
}

/**
 * Per-frame flight camera feel snapshot (FOV punch + eye shake) produced by the
 * active flight/idle branch and consumed by the renderer and HUD.
 */
export interface FlightCameraFeelFrame {
  fovDeltaDeg: number;
  thrust01: number;
  boost01: number;
  eyeShake: { right: number; up: number; forward: number };
}

/**
 * Mutable bag of all state and injected dependencies the game-loop feature
 * modules close over. Feature factories read and reassign fields here so the
 * extracted modules share the same live state the monolithic loop once nested.
 */
export interface LoopContext {
  // ---- injected options (defaults resolved) ----
  readonly planet: Planet;
  readonly seed: number;
  readonly spawn: 'station' | 'surface';
  readonly planetId: string;
  readonly systemId: string;
  readonly activeStationInstanceId: string | null;
  readonly controls: PlayerControls;
  readonly renderer: SpikeRenderer | null;
  readonly network: WorldClient | null;
  readonly bootstrap: GameBootstrap | null;
  readonly avmsTerminal: AvmsTerminalController | null;
  readonly entertainmentSystem: EntertainmentSystemController | null;
  readonly weaponShop: WeaponShopController | null;
  readonly outfitters: OutfittersController | null;
  readonly foodShop: FoodShopController | null;
  readonly personalInventory: PersonalInventoryController | null;
  readonly build: BuildRuntime | null;
  readonly physics: StationPhysics | null;
  readonly stationPrefab: PrefabDocument | null;
  readonly onHudUpdate: (params: HudUpdateParams) => void;
  readonly onResetPeak: () => void;
  readonly isPaused?: () => boolean;
  readonly getInventoryLoadout: () => LoadoutState;
  readonly getInventory: () => InventoryState | null;
  readonly onInventoryUpdate?: (inventory: InventoryState) => void;
  readonly onWeaponCombatEvents?: (
    events: readonly WeaponCombatRuntimeEvent[],
  ) => void;
  readonly vitalsSession: PlayerVitalsSessionController | null;

  // ---- immutable runtime handles ----
  readonly flightCameraFeelState: ReturnType<typeof createFlightCameraFeelState>;
  readonly esCameraState: ReturnType<typeof createEntertainmentCameraState>;
  readonly boostSfx: ReturnType<typeof createLoopingSfxController>;
  readonly thrustSfx: ReturnType<typeof createLoopingSfxController>;
  readonly soundScene: ReturnType<typeof createSoundSceneController>;
  readonly footsteps: ReturnType<typeof createFootstepController>;
  readonly stationFrame: StationFrame;
  readonly stationNpcPopulation: ReturnType<typeof createStationNpcPopulation>;
  readonly weaponFireStates: Map<string, WeaponFireState>;
  readonly ballisticSegments: BallisticSegment[];
  readonly stationAnimationStates: Record<string, StationAnimationState>;
  readonly doorColliderEnabled: Record<string, boolean>;
  readonly buildBtnEl: HTMLElement | null;

  // ---- mutable runtime state ----
  world: WorldState;
  /** Local drawn weapon bar slot (`rifle-primary` / `rifle-secondary` / `handgun`) or holstered. */
  activeWeaponSlotId: string | null;
  shipPhysics: ShipPhysics | null;
  shipPhysicsWarming: boolean;
  planetPhysics: PlanetPhysics | null;
  /** Station vendor-screen Head-bone look for the current frame. */
  stationScreenHeadLook: CharacterUpperBodyAim | null;
  flightCameraFeelFrame: FlightCameraFeelFrame | null;
  lastNearbyPrefabInfoId: string | null;
  lastMs: number;
  running: boolean;
  frameRendererError: unknown;

  // ---- CSS3D vendor/bunk screens (assigned by createScreens) ----
  esScreen: EntertainmentScreenHandle | null;
  weaponShopScreen: WeaponShopScreenHandle | null;
  outfittersScreen: OutfittersScreenHandle | null;
  foodShopScreen: FoodShopScreenHandle | null;
}

/**
 * Constructs the mutable context from resolved loop options. Feature bundles
 * (screens, station animation seeding, etc.) are wired afterward in
 * `createGameLoop`.
 */
export function createLoopContext(options: GameLoopOptions): LoopContext {
  const {
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
    foodShop = null,
    personalInventory = null,
    build = null,
    physics = null,
    stationPrefab = null,
    onHudUpdate,
    onResetPeak,
    isPaused,
    getInventoryLoadout = () => ({}),
    getInventory = () => null,
    onInventoryUpdate,
    onWeaponCombatEvents,
    vitalsSession = null,
  } = options;

  const world = createWorldState(planet, seed, {
    spawn,
    planetId,
    systemId,
    activeStationInstanceId,
    vitals: vitalsSession?.getVitals() ?? bootstrap?.player.vitals,
  });
  if (bootstrap?.hangar.assignedHangar) {
    world.assignedHangar = bootstrap.hangar.assignedHangar;
  }

  const stationFrame = getStationFrame(planet);

  return {
    planet,
    seed,
    spawn,
    planetId,
    systemId,
    activeStationInstanceId,
    controls,
    renderer,
    network,
    bootstrap,
    avmsTerminal,
    entertainmentSystem,
    weaponShop,
    outfitters,
    foodShop,
    personalInventory,
    build,
    physics,
    stationPrefab,
    onHudUpdate,
    onResetPeak,
    isPaused,
    getInventoryLoadout,
    getInventory,
    onInventoryUpdate,
    onWeaponCombatEvents,
    vitalsSession,

    flightCameraFeelState: createFlightCameraFeelState(),
    esCameraState: createEntertainmentCameraState(),
    boostSfx: createLoopingSfxController(),
    thrustSfx: createLoopingSfxController(),
    soundScene: createSoundSceneController(),
    footsteps: createFootstepController(),
    stationFrame,
    stationNpcPopulation: createStationNpcPopulation(
      getStationLayoutOverride(),
      stationFrame,
      seed,
    ),
    weaponFireStates: new Map(),
    ballisticSegments: [],
    stationAnimationStates: {},
    doorColliderEnabled: {},
    buildBtnEl: document.getElementById("hud-build-btn"),

    world,
    activeWeaponSlotId: null,
    shipPhysics: null,
    shipPhysicsWarming: false,
    planetPhysics: null,
    stationScreenHeadLook: null,
    flightCameraFeelFrame: null,
    lastNearbyPrefabInfoId: null,
    lastMs: performance.now(),
    running: false,
    frameRendererError: rendererError,

    esScreen: null,
    weaponShopScreen: null,
    outfittersScreen: null,
    foodShopScreen: null,
  };
}
