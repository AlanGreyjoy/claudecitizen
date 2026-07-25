import type { GameLoopOptions } from "./types";

export type ResolvedLoopContextOptions = Required<
  Pick<
    GameLoopOptions,
    | "planet"
    | "seed"
    | "spawn"
    | "planetId"
    | "systemId"
    | "activeStationInstanceId"
    | "controls"
    | "renderer"
    | "network"
    | "bootstrap"
    | "avmsTerminal"
    | "entertainmentSystem"
    | "weaponShop"
    | "outfitters"
    | "foodShop"
    | "personalInventory"
    | "build"
    | "physics"
    | "stationPrefab"
    | "onHudUpdate"
    | "onResetPeak"
    | "getInventoryLoadout"
    | "getInventory"
    | "vitalsSession"
  >
> &
  Pick<
    GameLoopOptions,
    | "rendererError"
    | "isPaused"
    | "onInventoryUpdate"
    | "onWeaponCombatEvents"
  >;

function resolveIdentityOptions(options: GameLoopOptions) {
  return {
    planet: options.planet,
    seed: options.seed,
    controls: options.controls,
    renderer: options.renderer,
    rendererError: options.rendererError,
    onHudUpdate: options.onHudUpdate,
    onResetPeak: options.onResetPeak,
    isPaused: options.isPaused,
    onInventoryUpdate: options.onInventoryUpdate,
    onWeaponCombatEvents: options.onWeaponCombatEvents,
  };
}

function resolveSpawnOptions(options: GameLoopOptions) {
  return {
    spawn: options.spawn ?? ("station" as const),
    planetId: options.planetId ?? "asteron",
    systemId: options.systemId ?? "default",
    activeStationInstanceId: options.activeStationInstanceId ?? null,
  };
}

function resolveUiOptions(options: GameLoopOptions) {
  return {
    avmsTerminal: options.avmsTerminal ?? null,
    entertainmentSystem: options.entertainmentSystem ?? null,
    weaponShop: options.weaponShop ?? null,
    outfitters: options.outfitters ?? null,
    foodShop: options.foodShop ?? null,
    personalInventory: options.personalInventory ?? null,
  };
}

function resolveWorldOptions(options: GameLoopOptions) {
  return {
    network: options.network ?? null,
    bootstrap: options.bootstrap ?? null,
    build: options.build ?? null,
    physics: options.physics ?? null,
    stationPrefab: options.stationPrefab ?? null,
    getInventoryLoadout: options.getInventoryLoadout ?? (() => ({})),
    getInventory: options.getInventory ?? (() => null),
    vitalsSession: options.vitalsSession ?? null,
  };
}

export function resolveLoopContextOptions(
  options: GameLoopOptions,
): ResolvedLoopContextOptions {
  return {
    ...resolveIdentityOptions(options),
    ...resolveSpawnOptions(options),
    ...resolveUiOptions(options),
    ...resolveWorldOptions(options),
  };
}
