import type { PublicPlayerProfile } from '../auth/auth.types';

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
  propDefinitionId: string;
  prefabId: string;
  right: number;
  up: number;
  forward: number;
  rotationY: number;
}

export interface HangarBuildStateDto {
  assignedHangar: number;
  catalog: PropDefinitionDto[];
  inventory: PlayerPropInventoryDto[];
  placements: HangarPlacementDto[];
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
  featureFlags: {
    nativeWebSocketPresence: true;
    serverAuthoritativePhysics: false;
  };
}
