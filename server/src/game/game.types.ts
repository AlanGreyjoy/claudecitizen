import type { PublicPlayerProfile } from '../auth/auth.types';
import type { BuildArea } from './game.hangar.validation';

export interface OwnedShipDto {
  id: string;
  shipDefinitionId: string | null;
  prefabId: string;
  displayName: string;
  hp: number;
  shields: number;
  maxHp: number;
  maxShields: number;
  shieldRegenPerSec: number;
  maxSpeedMps: number;
  throttleAccelMps2: number;
}

export interface PropDefinitionDto {
  id: string;
  name: string;
  description: string;
  prefabId: string;
  costArc: number;
  category: string;
  maxPerHangar: number | null;
  allowRotateY: boolean;
  snapGridM: number | null;
}

export interface PlayerPropInventoryDto {
  propDefinitionId: string;
  quantity: number;
}

export interface HangarPlacementDto {
  id: string;
  area: BuildArea;
  propDefinitionId: string;
  prefabId: string;
  right: number;
  up: number;
  forward: number;
  rotationY: number;
}

export interface HangarBuildStateDto {
  area: BuildArea;
  assignedHangar: number | null;
  catalog: PropDefinitionDto[];
  inventory: PlayerPropInventoryDto[];
  placements: HangarPlacementDto[];
}

export interface ItemDefinitionDto {
  id: string;
  name: string;
  description: string;
  itemType: string;
  subType: string;
  prefabId: string | null;
  iconUrl: string | null;
  stackMax: number;
  costArc: number;
  rarity: string;
}

export interface PlayerItemDto {
  itemDefinitionId: string;
  quantity: number;
}

export interface InventoryStateDto {
  catalog: ItemDefinitionDto[];
  items: PlayerItemDto[];
}

export interface GameBootstrapDto {
  player: PublicPlayerProfile;
  economy: {
    arcBalance: number;
  };
  spawn: {
    instanceId: string;
    apartmentInstanceId: string;
    hangarInstanceId: string;
    stationRoomId: string;
  };
  ships: OwnedShipDto[];
  hangar: HangarBuildStateDto;
  apartment: HangarBuildStateDto;
  inventory: InventoryStateDto;
  featureFlags: {
    nativeWebSocketPresence: true;
    serverAuthoritativePhysics: false;
  };
}
