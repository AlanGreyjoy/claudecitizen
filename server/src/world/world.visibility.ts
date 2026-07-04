import type { NetworkEntityState, NetworkLod, Vec3Dto } from './world.types';

export interface ViewerState {
  playerId: string;
  instanceId: string;
  stationRoomId: string | null;
  focusPosition: Vec3Dto | null;
}

export function privateInstanceOwner(instanceId: string): string | null {
  if (instanceId.startsWith('apartment:')) return instanceId.slice('apartment:'.length);
  if (instanceId.startsWith('hangar:')) return instanceId.slice('hangar:'.length);
  return null;
}

export function canEnterInstance(playerId: string, instanceId: string): boolean {
  const owner = privateInstanceOwner(instanceId);
  return owner === null || owner === playerId;
}

export function entityFocusPosition(entity: NetworkEntityState): Vec3Dto | null {
  if (entity.mode === 'in-ship' && entity.ship) return entity.ship.position;
  return entity.character?.position ?? entity.ship?.position ?? null;
}

function distanceMeters(a: Vec3Dto, b: Vec3Dto): number {
  return Math.hypot(a.x - b.x, a.y - b.y, a.z - b.z);
}

export function shouldSeeEntity(viewer: ViewerState, entity: NetworkEntityState): boolean {
  if (viewer.playerId === entity.playerId) return false;
  if (viewer.instanceId !== entity.instanceId) return false;
  const owner = privateInstanceOwner(entity.instanceId);
  if (owner !== null) return owner === viewer.playerId;

  if (
    entity.instanceId === 'station:public' &&
    viewer.stationRoomId &&
    entity.stationRoomId &&
    viewer.stationRoomId !== entity.stationRoomId
  ) {
    return false;
  }

  const entityPosition = entityFocusPosition(entity);
  if (!viewer.focusPosition || !entityPosition) return true;
  const distance = distanceMeters(viewer.focusPosition, entityPosition);
  if (entity.instanceId.startsWith('planet:')) return distance <= 50_000;
  if (entity.instanceId.startsWith('space:')) return distance <= 500_000;
  return true;
}

export function lodForDistance(distanceMetersValue: number): NetworkLod {
  if (distanceMetersValue <= 250) return 'full';
  if (distanceMetersValue <= 2_500) return 'medium';
  return 'marker';
}

export function lodForViewer(viewer: ViewerState, entity: NetworkEntityState): NetworkLod {
  const entityPosition = entityFocusPosition(entity);
  if (!viewer.focusPosition || !entityPosition) return 'full';
  return lodForDistance(distanceMeters(viewer.focusPosition, entityPosition));
}

export function shouldSendLod(lod: NetworkLod, tick: number): boolean {
  if (lod === 'full') return true;
  if (lod === 'medium') return tick % 2 === 0;
  return tick % 10 === 0;
}
