import type { createPlayerControls } from "../input/player_controls";
import type { HangarBuildController } from "../player/hangar_build/build_controller";
import type { BuildPropColliderRuntime } from "../player/hangar_build/prop_colliders";
import type { HangarPropRenderer } from "../render/hangar/prop_instances";
import type { BuildTerminalController } from "../render/effects/hud/build_terminal";
import type { AvmsTerminalController } from "../render/effects/hud/avms_terminal";
import type { EntertainmentSystemController } from "../render/effects/hud/entertainment_system";
import type { WeaponShopController } from "../render/effects/hud/weapon_shop";
import type { OutfittersController } from "../render/effects/hud/outfitters";
import type { FoodShopController } from "../render/effects/hud/food_shop";
import type { PersonalInventoryController } from "../render/effects/hud/personal_inventory";
import type { PlayerVitalsSessionController } from "../app/player_vitals_session";
import type { HudUpdateParams } from "../render/effects";
import type { SpikeRenderer } from "../render/main";
import type { BuildArea, GameBootstrap } from "../net/api";
import type { WorldClient } from "../net/world_client";
import type { StationPhysics } from "../physics/station_physics";
import type { PrefabDocument } from "../world/prefabs/schema";
import type { SurfaceDestination } from "../world/biome_teleport";
import type {
  InventoryState,
  LoadoutState,
  WeaponFireMode,
} from "../player/inventory/types";
import type { WeaponGeometryHit } from "../player/weapon_ballistics";
import type { Planet, Vec3 } from "../types";

export type PlayerControls = ReturnType<typeof createPlayerControls>;
export type CharacterInput = ReturnType<PlayerControls["sampleCharacterInput"]>;
export type FrameActions = ReturnType<PlayerControls["consumeActions"]>;
export type CameraState = ReturnType<PlayerControls["sampleCameraState"]>;

/** Per-frame input shared by the on-foot walking modes (planet/deck/station). */
export interface WalkModeInput {
  characterInput: CharacterInput;
  actions: FrameActions;
  dt: number;
}

export interface BuildAreaRuntime {
  controller: HangarBuildController;
  propRenderer: HangarPropRenderer;
  propColliders: BuildPropColliderRuntime;
}

export interface BuildRuntime {
  areas: Partial<Record<BuildArea, BuildAreaRuntime>>;
  terminal: BuildTerminalController;
}

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
  foodShop?: FoodShopController | null;
  personalInventory?: PersonalInventoryController | null;
  build?: BuildRuntime | null;
  physics?: StationPhysics | null;
  stationPrefab?: PrefabDocument | null;
  onHudUpdate: (params: HudUpdateParams) => void;
  onResetPeak: () => void;
  isPaused?: () => boolean;
  getInventoryLoadout?: () => LoadoutState;
  getInventory?: () => InventoryState | null;
  onInventoryUpdate?: (inventory: InventoryState) => void;
  onWeaponCombatEvents?: (events: readonly WeaponCombatRuntimeEvent[]) => void;
  vitalsSession?: PlayerVitalsSessionController | null;
}

export type WeaponCombatRuntimeEvent =
  | {
      type: "shot";
      combat: {
        dryFireSoundUrl: string | null;
        fireSoundUrl: string | null;
        hitDecalUrl: string | null;
        reloadSoundUrl: string | null;
      } | null;
      direction: Vec3;
      fireMode: WeaponFireMode;
      hit: WeaponGeometryHit | null;
      origin: Vec3;
      pathEnd: Vec3;
      weaponId: string;
    }
  | {
      type: "dry-fire" | "reload-started";
      combat: {
        dryFireSoundUrl: string | null;
        fireSoundUrl: string | null;
        hitDecalUrl: string | null;
        reloadSoundUrl: string | null;
      } | null;
      weaponId: string;
    }
  | { type: "fire-mode-changed"; fireMode: WeaponFireMode; weaponId: string }
  | { type: "reload-completed"; roundsLoaded: number; weaponId: string };

/** Public API returned by {@link createGameLoop}, consumed by the play session. */
export interface GameLoopHandle {
  cleanupForTitleReturn: () => void;
  resetWorld: () => void;
  returnToApartmentForVitalsFailure: () => void;
  setEquippedLoadout: (loadout: LoadoutState) => void;
  setVitalsSyncLocked: (locked: boolean) => void;
  syncApartmentInstanceForVitalsRecovery: () => void;
  start: () => void;
  stop: () => void;
  teleportToSurface: (destination: SurfaceDestination) => boolean;
}
