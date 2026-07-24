import type { PrefabComponent } from "../../../world/prefabs/schema";
import type { ComponentFieldBuildContext } from "./context";
import { buildEquipmentSocketFields, buildStationFrameFields, buildPropFrameFields, buildItemFrameFields, buildDrawnGripFields, buildMuzzleFlashFields } from "./builders_0";
import { buildBarrelEndFields, buildWeaponCombatFields, buildSpawnPointFields, buildNpcSpawnerFields, buildNpcWaypointFields, buildNpcPlacementFields } from "./builders_1";
import { buildElevatorFields, buildHangarPadFields, buildInteractionFields, buildAnimationFields, buildObjectAnimationFields, buildAvmsTerminalFields } from "./builders_2";
import { buildPointLightFields, buildAreaLightFields, buildSpotLightFields, buildSoundFields, buildParticleSystemComponentFields, buildColliderFields } from "./builders_3";
import { buildShipFrameFields, buildShipControllerFields, buildShipStatsFields, buildShipGearFields, buildShipRampFields, buildShipHullFields } from "./builders_4";
import { buildShipDoorFields, buildPilotSeatFields, buildBedFields, buildRampInteractFields, buildCockpitControlFields, buildEntertainmentSystemFields } from "./builders_5";
import { buildWeaponShopFields, buildOutfittersFields, buildFoodShopFields, buildDrinksShopFields, buildCanteenFields, buildCockpitStatFields } from "./builders_6";
import {
  buildGameManagerFields,
  buildPlanetFields,
  buildPlayerStartFields,
  buildPrefabInstanceFields,
} from "./builders_scene";

type ComponentFieldBuilder = (
  ctx: ComponentFieldBuildContext,
  component: PrefabComponent,
) => HTMLElement[];

export const COMPONENT_FIELD_BUILDERS: Partial<
  Record<PrefabComponent["type"], ComponentFieldBuilder>
> = {
  "equipment-socket": (ctx, component) => buildEquipmentSocketFields(ctx, component as Extract<PrefabComponent, { type: "equipment-socket" }>),
  "station-frame": (ctx, component) => buildStationFrameFields(ctx, component as Extract<PrefabComponent, { type: "station-frame" }>),
  "prop-frame": (ctx, component) => buildPropFrameFields(ctx, component as Extract<PrefabComponent, { type: "prop-frame" }>),
  "item-frame": (ctx, component) => buildItemFrameFields(ctx, component as Extract<PrefabComponent, { type: "item-frame" }>),
  "drawn-grip": (ctx, component) => buildDrawnGripFields(ctx, component as Extract<PrefabComponent, { type: "drawn-grip" }>),
  "muzzle-flash": (ctx, component) => buildMuzzleFlashFields(ctx, component as Extract<PrefabComponent, { type: "muzzle-flash" }>),
  "barrel-end": (ctx, component) => buildBarrelEndFields(ctx, component as Extract<PrefabComponent, { type: "barrel-end" }>),
  "weapon-combat": (ctx, component) => buildWeaponCombatFields(ctx, component as Extract<PrefabComponent, { type: "weapon-combat" }>),
  "spawn-point": (ctx, component) => buildSpawnPointFields(ctx, component as Extract<PrefabComponent, { type: "spawn-point" }>),
  "npc-spawner": (ctx, component) => buildNpcSpawnerFields(ctx, component as Extract<PrefabComponent, { type: "npc-spawner" }>),
  "npc-waypoint": (ctx, component) => buildNpcWaypointFields(ctx, component as Extract<PrefabComponent, { type: "npc-waypoint" }>),
  "npc-placement": (ctx, component) => buildNpcPlacementFields(ctx, component as Extract<PrefabComponent, { type: "npc-placement" }>),
  "elevator": (ctx, component) => buildElevatorFields(ctx, component as Extract<PrefabComponent, { type: "elevator" }>),
  "hangar-pad": (ctx, component) => buildHangarPadFields(ctx, component as Extract<PrefabComponent, { type: "hangar-pad" }>),
  "interaction": (ctx, component) => buildInteractionFields(ctx, component as Extract<PrefabComponent, { type: "interaction" }>),
  "animation": (ctx, component) => buildAnimationFields(ctx, component as Extract<PrefabComponent, { type: "animation" }>),
  "object-animation": (ctx, component) => buildObjectAnimationFields(ctx, component as Extract<PrefabComponent, { type: "object-animation" }>),
  "avms-terminal": (ctx, component) => buildAvmsTerminalFields(ctx, component as Extract<PrefabComponent, { type: "avms-terminal" }>),
  "point-light": (ctx, component) => buildPointLightFields(ctx, component as Extract<PrefabComponent, { type: "point-light" }>),
  "area-light": (ctx, component) => buildAreaLightFields(ctx, component as Extract<PrefabComponent, { type: "area-light" }>),
  "spot-light": (ctx, component) => buildSpotLightFields(ctx, component as Extract<PrefabComponent, { type: "spot-light" }>),
  "sound": (ctx, component) => buildSoundFields(ctx, component as Extract<PrefabComponent, { type: "sound" }>),
  "particle-system": (ctx, component) => buildParticleSystemComponentFields(ctx, component as Extract<PrefabComponent, { type: "particle-system" }>),
  "collider": (ctx, component) => buildColliderFields(ctx, component as Extract<PrefabComponent, { type: "collider" }>),
  "ship-frame": (ctx, component) => buildShipFrameFields(ctx, component as Extract<PrefabComponent, { type: "ship-frame" }>),
  "ship-controller": (ctx, component) => buildShipControllerFields(ctx, component as Extract<PrefabComponent, { type: "ship-controller" }>),
  "ship-stats": (ctx, component) => buildShipStatsFields(ctx, component as Extract<PrefabComponent, { type: "ship-stats" }>),
  "ship-gear": (ctx, component) => buildShipGearFields(ctx, component as Extract<PrefabComponent, { type: "ship-gear" }>),
  "ship-ramp": (ctx, component) => buildShipRampFields(ctx, component as Extract<PrefabComponent, { type: "ship-ramp" }>),
  "ship-hull": (ctx, component) => buildShipHullFields(ctx, component as Extract<PrefabComponent, { type: "ship-hull" }>),
  "ship-door": (ctx, component) => buildShipDoorFields(ctx, component as Extract<PrefabComponent, { type: "ship-door" }>),
  "pilot-seat": (ctx, component) => buildPilotSeatFields(ctx, component as Extract<PrefabComponent, { type: "pilot-seat" }>),
  "bed": (ctx, component) => buildBedFields(ctx, component as Extract<PrefabComponent, { type: "bed" }>),
  "ramp-interact": (ctx, component) => buildRampInteractFields(ctx, component as Extract<PrefabComponent, { type: "ramp-interact" }>),
  "cockpit-control": (ctx, component) => buildCockpitControlFields(ctx, component as Extract<PrefabComponent, { type: "cockpit-control" }>),
  "entertainment-system": (ctx, component) => buildEntertainmentSystemFields(ctx, component as Extract<PrefabComponent, { type: "entertainment-system" }>),
  "weapon-shop": (ctx, component) => buildWeaponShopFields(ctx, component as Extract<PrefabComponent, { type: "weapon-shop" }>),
  "outfitters": (ctx, component) => buildOutfittersFields(ctx, component as Extract<PrefabComponent, { type: "outfitters" }>),
  "food-shop": (ctx, component) => buildFoodShopFields(ctx, component as Extract<PrefabComponent, { type: "food-shop" }>),
  "drinks-shop": (ctx, component) => buildDrinksShopFields(ctx, component as Extract<PrefabComponent, { type: "drinks-shop" }>),
  "canteen": (ctx, component) => buildCanteenFields(ctx, component as Extract<PrefabComponent, { type: "canteen" }>),
  "cockpit-stat": (ctx, component) => buildCockpitStatFields(ctx, component as Extract<PrefabComponent, { type: "cockpit-stat" }>),
  "game-manager": (ctx, component) => buildGameManagerFields(ctx, component as Extract<PrefabComponent, { type: "game-manager" }>),
  "planet": (ctx, component) => buildPlanetFields(ctx, component as Extract<PrefabComponent, { type: "planet" }>),
  "player-start": (ctx, component) => buildPlayerStartFields(ctx, component as Extract<PrefabComponent, { type: "player-start" }>),
  "prefab-instance": (ctx, component) => buildPrefabInstanceFields(ctx, component as Extract<PrefabComponent, { type: "prefab-instance" }>),
};
