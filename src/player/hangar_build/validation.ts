import {
  HANGAR_FLOOR_UP,
  HANGAR_PAD_HALF_METERS,
  HANGARS,
  STATION_ROOMS,
  type StationRoom,
} from '../../world/station';

export interface StationLocalPoint {
  right: number;
  up: number;
  forward: number;
}

export interface PlacementTransform extends StationLocalPoint {
  rotationY: number;
}

const DEFAULT_PROP_FOOTPRINT = 0.75;
const PAD_CLEARANCE_MARGIN = 0.5;

export function hangarRoomForIndex(index: number | null | undefined): StationRoom {
  const resolved = index === 1 || index === 2 || index === 3 ? index : 2;
  const hangar = HANGARS.find((entry) => entry.index === resolved) ?? HANGARS[1]!;
  return STATION_ROOMS.find((room) => room.id === hangar.roomId) ?? STATION_ROOMS[0]!;
}

export function snapScalar(value: number, grid: number | null | undefined): number {
  if (grid === null || grid === undefined || grid <= 0) return value;
  return Math.round(value / grid) * grid;
}

export function snapTransform(
  transform: PlacementTransform,
  snapGridM: number | null | undefined,
  hangarIndex: number,
): PlacementTransform {
  const room = hangarRoomForIndex(hangarIndex);
  return {
    right: snapScalar(transform.right, snapGridM),
    forward: snapScalar(transform.forward, snapGridM),
    up: room.floorUp,
    rotationY: transform.rotationY,
  };
}

export function normalizeRotationY(
  rotationY: number,
  allowRotateY: boolean,
  snapDegrees = 15,
): number {
  if (!allowRotateY) return 0;
  const snapRad = (snapDegrees * Math.PI) / 180;
  return Math.round(rotationY / snapRad) * snapRad;
}

export function isInsideHangarRoom(
  point: StationLocalPoint,
  room: StationRoom,
  footprint = DEFAULT_PROP_FOOTPRINT,
): boolean {
  return (
    point.right - footprint >= room.minRight &&
    point.right + footprint <= room.maxRight &&
    point.forward - footprint >= room.minForward &&
    point.forward + footprint <= room.maxForward &&
    Math.abs(point.up - room.floorUp) <= 0.05
  );
}

export function overlapsShipPad(
  point: StationLocalPoint,
  hangarIndex: number,
  footprint = DEFAULT_PROP_FOOTPRINT,
): boolean {
  const hangar = HANGARS.find((entry) => entry.index === hangarIndex);
  if (!hangar) return false;
  const limit = HANGAR_PAD_HALF_METERS + footprint + PAD_CLEARANCE_MARGIN;
  return (
    Math.abs(point.right - hangar.padSurfaceLocal.right) <= limit &&
    Math.abs(point.forward - hangar.padSurfaceLocal.forward) <= limit
  );
}

export function boxesOverlap(
  a: StationLocalPoint,
  b: StationLocalPoint,
  footprintA = DEFAULT_PROP_FOOTPRINT,
  footprintB = DEFAULT_PROP_FOOTPRINT,
): boolean {
  return (
    Math.abs(a.right - b.right) < footprintA + footprintB &&
    Math.abs(a.forward - b.forward) < footprintA + footprintB
  );
}

export function validateClientPlacement(params: {
  transform: PlacementTransform;
  hangarIndex: number;
  allowRotateY: boolean;
  snapGridM: number | null;
  existingPlacements: PlacementTransform[];
}): { ok: true; transform: PlacementTransform } | { ok: false; message: string } {
  const room = hangarRoomForIndex(params.hangarIndex);
  let snapped = snapTransform(params.transform, params.snapGridM, params.hangarIndex);
  snapped = {
    ...snapped,
    rotationY: normalizeRotationY(snapped.rotationY, params.allowRotateY),
  };

  if (!isInsideHangarRoom(snapped, room)) {
    return { ok: false, message: 'Outside hangar bay bounds.' };
  }
  if (overlapsShipPad(snapped, params.hangarIndex)) {
    return { ok: false, message: 'Too close to the ship pad.' };
  }
  for (const existing of params.existingPlacements) {
    if (boxesOverlap(snapped, existing)) {
      return { ok: false, message: 'Overlaps another prop.' };
    }
  }
  return { ok: true, transform: snapped };
}

export function pickNearestPlacement(
  point: StationLocalPoint,
  placements: Array<PlacementTransform & { id: string }>,
  maxDistance = 1.2,
): string | null {
  let bestId: string | null = null;
  let bestDistance = maxDistance;
  for (const placement of placements) {
    const distance = Math.hypot(point.right - placement.right, point.forward - placement.forward);
    if (distance < bestDistance) {
      bestDistance = distance;
      bestId = placement.id;
    }
  }
  return bestId;
}

export { HANGAR_FLOOR_UP, DEFAULT_PROP_FOOTPRINT };
