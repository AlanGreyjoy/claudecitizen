import type { ReactElement } from 'react';
import type { PrefabComponent } from '../../../../world/prefabs/schema';
import type { ComponentFieldContext, ComponentFieldsProps } from './context';
import {
  DrawnGripFields,
  EquipmentSocketFields,
  ItemFrameFields,
  MuzzleFlashFields,
  PropFrameFields,
  StationFrameFields,
} from './Builders0';
import {
  BarrelEndFields,
  NpcPlacementFields,
  NpcSpawnerFields,
  NpcWaypointFields,
  SpawnPointFields,
  WeaponCombatFields,
} from './Builders1';
import {
  AnimationFields,
  AvmsTerminalFields,
  ElevatorFields,
  HangarPadFields,
  InteractionFields,
  LadderFields,
  ObjectAnimationFields,
} from './Builders2';
import {
  AreaLightFields,
  ColliderFields,
  PointLightFields,
  SoundFields,
  SpotLightFields,
} from './Builders3';
import {
  ShipFrameFields,
  ShipGearFields,
  ShipHullFields,
  ShipRampFields,
  ShipStatsFields,
} from './Builders4';
import { ShipControllerFields } from './ShipControllerFields';
import {
  BedFields,
  CockpitControlFields,
  EntertainmentSystemFields,
  PilotSeatFields,
  RampInteractFields,
  ShipDoorFields,
} from './Builders5';
import {
  CanteenFields,
  CockpitStatFields,
  DrinksShopFields,
  FoodShopFields,
  OutfittersFields,
  WeaponShopFields,
} from './Builders6';
import {
  GameManagerFields,
  InstancedSceneFields,
  PlanetFields,
  PlayerStartFields,
  PrefabInstanceFields,
  SceneLinkFields,
  UiScreenFields,
} from './BuildersScene';
import { ParticleSystemFields } from './ParticleSystemFields';

type FieldRenderer = (props: ComponentFieldsProps) => ReactElement;

function field<T extends PrefabComponent>(
  Component: (props: ComponentFieldsProps<T>) => ReactElement,
): FieldRenderer {
  return (props) => <Component {...(props as ComponentFieldsProps<T>)} />;
}

export const COMPONENT_FIELD_COMPONENTS: Partial<
  Record<PrefabComponent['type'], FieldRenderer>
> = {
  'equipment-socket': field(EquipmentSocketFields),
  'station-frame': field(() => <StationFrameFields />),
  'prop-frame': field(() => <PropFrameFields />),
  'item-frame': field(() => <ItemFrameFields />),
  'drawn-grip': field(() => <DrawnGripFields />),
  'muzzle-flash': field(() => <MuzzleFlashFields />),
  'barrel-end': field(() => <BarrelEndFields />),
  'weapon-combat': field(WeaponCombatFields),
  'spawn-point': field(SpawnPointFields),
  'npc-spawner': field(NpcSpawnerFields),
  'npc-waypoint': field(NpcWaypointFields),
  'npc-placement': field(NpcPlacementFields),
  elevator: field(ElevatorFields),
  ladder: field(LadderFields),
  'hangar-pad': field(HangarPadFields),
  interaction: field(InteractionFields),
  animation: field(AnimationFields),
  'object-animation': field(ObjectAnimationFields),
  'avms-terminal': field(AvmsTerminalFields),
  'point-light': field(PointLightFields),
  'area-light': field(AreaLightFields),
  'spot-light': field(SpotLightFields),
  sound: field(SoundFields),
  'particle-system': field(ParticleSystemFields),
  collider: field(ColliderFields),
  'ship-frame': field(() => <ShipFrameFields />),
  'ship-controller': field(ShipControllerFields),
  'ship-stats': field(ShipStatsFields),
  'ship-gear': field(ShipGearFields),
  'ship-ramp': field(ShipRampFields),
  'ship-hull': field(ShipHullFields),
  'ship-door': field(ShipDoorFields),
  'pilot-seat': field(PilotSeatFields),
  bed: field(BedFields),
  'ramp-interact': field(RampInteractFields),
  'cockpit-control': field(CockpitControlFields),
  'entertainment-system': field(EntertainmentSystemFields),
  'weapon-shop': field(WeaponShopFields),
  outfitters: field(OutfittersFields),
  'food-shop': field(FoodShopFields),
  'drinks-shop': field(DrinksShopFields),
  canteen: field(CanteenFields),
  'cockpit-stat': field(CockpitStatFields),
  'game-manager': field(GameManagerFields),
  planet: field(PlanetFields),
  'player-start': field(PlayerStartFields),
  'prefab-instance': field(PrefabInstanceFields),
  'ui-screen': field(UiScreenFields),
  'scene-link': field(SceneLinkFields),
  'instanced-scene': field(InstancedSceneFields),
};

export function renderComponentFields(
  ctx: ComponentFieldContext,
  component: PrefabComponent,
): ReactElement | null {
  const render = COMPONENT_FIELD_COMPONENTS[component.type];
  if (!render) return null;
  return render({ ctx, component });
}

/** All 49 component types with dedicated inspector field editors. */
export const COMPONENT_FIELD_TYPE_COUNT = Object.keys(COMPONENT_FIELD_COMPONENTS).length;
