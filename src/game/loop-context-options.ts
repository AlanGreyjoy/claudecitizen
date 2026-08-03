import type { GameLoopOptions } from "./types";

export type ResolvedLoopContextOptions = Required<
  Pick<
    GameLoopOptions,
    | "planet"
    | "seed"
    | "spawn"
    | "arrival"
    | "spaceSpawnPose"
    | "planetId"
    | "systemId"
    | "activeStationInstanceId"
    | "content"
    | "shipPrefabId"
    | "shipRampDownOnSpawn"
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
    | "chestStorage"
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
    | "onRequestScene"
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
    onRequestScene: options.onRequestScene,
  };
}

function resolveSpawnOptions(options: GameLoopOptions) {
  return {
    spawn: options.spawn ?? ("station" as const),
    arrival: options.arrival ?? ("default" as const),
    spaceSpawnPose: options.spaceSpawnPose ?? null,
    planetId: options.planetId ?? "asteron",
    systemId: options.systemId ?? "default",
    activeStationInstanceId: options.activeStationInstanceId ?? null,
    content: options.content ?? { planet: true, ship: true, station: true },
    shipPrefabId: options.shipPrefabId ?? null,
    shipRampDownOnSpawn: options.shipRampDownOnSpawn ?? false,
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
    chestStorage: options.chestStorage ?? null,
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
