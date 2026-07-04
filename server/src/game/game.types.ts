import type { PublicPlayerProfile } from '../auth/auth.types';

export interface OwnedShipDto {
  id: string;
  prefabId: string;
  displayName: string;
  hp: number;
  shields: number;
  maxHp: number;
  maxShields: number;
}

export interface GameBootstrapDto {
  player: PublicPlayerProfile;
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
