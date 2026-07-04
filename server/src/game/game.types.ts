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
  featureFlags: {
    nativeWebSocketPresence: true;
    serverAuthoritativePhysics: false;
  };
}
