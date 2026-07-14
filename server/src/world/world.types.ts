import type { PlayerCharacterAppearanceV1 } from '../game/game.character';

export interface Vec3Dto {
  x: number;
  y: number;
  z: number;
}

export interface NetworkBodyDto {
  position: Vec3Dto;
  forward: Vec3Dto;
  up: Vec3Dto;
}

export interface NetworkShipDto extends NetworkBodyDto {
  grounded?: boolean;
  velocity?: Vec3Dto;
  shipId?: string;
  prefabId?: string;
  hp?: number;
  shields?: number;
  maxHp?: number;
  maxShields?: number;
}

export interface NetworkCharacterDto extends NetworkBodyDto {
  animation: string;
}

export interface ShipRigDto {
  gear01: number;
  ramp01: number;
  doors: Record<string, number>;
}

export type NetworkLod = 'full' | 'medium' | 'marker';

export interface ClientPresenceUpdate {
  mode: string;
  character?: NetworkCharacterDto | null;
  ship?: NetworkShipDto | null;
  shipRig?: ShipRigDto | null;
  stationRoomId?: string | null;
  shipZoneId?: string | null;
}

export interface NetworkEntityState {
  id: string;
  playerId: string;
  displayName: string;
  characterAppearance: PlayerCharacterAppearanceV1 | null;
  instanceId: string;
  mode: string;
  character: NetworkCharacterDto | null;
  ship: NetworkShipDto | null;
  shipRig: ShipRigDto | null;
  stationRoomId: string | null;
  shipZoneId: string | null;
  updatedAt: number;
}

export interface SnapshotEntityDto {
  id: string;
  playerId: string;
  displayName: string;
  lod: NetworkLod;
  mode: string;
  characterAppearance?: PlayerCharacterAppearanceV1 | null;
  character?: NetworkCharacterDto | null;
  ship?: NetworkShipDto | null;
  shipRig?: ShipRigDto | null;
  markerPosition: Vec3Dto;
  stationRoomId?: string | null;
  shipZoneId?: string | null;
}

export interface ClientEnvelope {
  id?: string;
  t: string;
  data?: unknown;
}

export interface ServerEnvelope {
  id?: string;
  t: string;
  data?: unknown;
}
