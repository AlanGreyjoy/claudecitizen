import type { SpikeRenderWorld, Vec3 } from '../../../types';
import { getShipLayout } from '../../../player/ship_layout';
import type { ShipCameraBounds } from '../../../player/ship_layout';
import {
  getStationRoom,
  worldToStationLocal,
} from '../../../world/station';
import { add, cross, dot, normalize, scale, sub } from '../../../math/vec3';
import type { StationCameraContext } from './camera_rig_types';

function clampValue(value: number, min: number, max: number): number {
  return Math.max(min, Math.min(max, value));
}

export function clampOffsetToRoom(
  offset: Vec3,
  characterPosition: Vec3,
  station: StationCameraContext,
): Vec3 {
  const room = station.roomId ? getStationRoom(station.roomId) : null;
  if (!room) return offset;
  const frame = station.frame;
  const charLocal = worldToStationLocal(frame, characterPosition);
  const inset = 0.35;
  const open = (side: string) => room.openSides?.includes(side as never) ?? false;
  const camRight = clampValue(
    charLocal.right + dot(offset, frame.right),
    open('minRight') ? -Infinity : room.minRight + inset,
    open('maxRight') ? Infinity : room.maxRight - inset,
  );
  const camUp = clampValue(
    charLocal.up + dot(offset, frame.up),
    room.floorUp + 0.35,
    room.floorUp + room.height - 0.3,
  );
  const camForward = clampValue(
    charLocal.forward + dot(offset, frame.forward),
    open('minForward') ? -Infinity : room.minForward + inset,
    open('maxForward') ? Infinity : room.maxForward - inset,
  );
  return add(
    add(scale(frame.right, camRight - charLocal.right), scale(frame.up, camUp - charLocal.up)),
    scale(frame.forward, camForward - charLocal.forward),
  );
}

function resolveCameraClampVolume(
  shipZoneId: string | null | undefined,
): ShipCameraBounds | null {
  if (!shipZoneId) return null;
  return (
    getShipLayout().cameraBounds.find((bound) => bound.id === shipZoneId) ??
    null
  );
}

export function clampOffsetToShipZone(
  offset: Vec3,
  characterPosition: Vec3,
  world: SpikeRenderWorld,
  shipUp: Vec3,
  shipForward: Vec3,
): Vec3 {
  const zone = resolveCameraClampVolume(world.shipZoneId);
  if (!zone || zone.openToOutside) return offset;
  const up = normalize(shipUp);
  const planarForward = normalize(sub(shipForward, scale(up, dot(shipForward, up))));
  const right = normalize(cross(planarForward, up));
  const delta = sub(characterPosition, world.ship.position);
  const charLocal = {
    right: dot(delta, right),
    up: dot(delta, up),
    forward: dot(delta, planarForward),
  };
  const inset = 0.25;
  const floorUp = zone.floorUp;
  const camRight = clampValue(
    charLocal.right + dot(offset, right),
    zone.minRight + inset,
    zone.maxRight - inset,
  );
  const camUp = clampValue(
    charLocal.up + dot(offset, up),
    floorUp + 0.3,
    zone.ceilingUp - 0.15,
  );
  const camForward = clampValue(
    charLocal.forward + dot(offset, planarForward),
    zone.minForward + inset,
    zone.maxForward - inset,
  );
  return add(
    add(scale(right, camRight - charLocal.right), scale(up, camUp - charLocal.up)),
    scale(planarForward, camForward - charLocal.forward),
  );
}
