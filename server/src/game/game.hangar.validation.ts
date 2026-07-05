/** Procedural station build bounds — must stay in sync with src/world/station.ts. */
export type BuildArea = 'hangar' | 'apartment';

export const HAB_FLOOR_UP = 14;
export const HANGAR_FLOOR_UP = -22;
export const HANGAR_PAD_HALF_METERS = 8;

export interface BuildRoomBounds {
  roomId: string;
  minRight: number;
  maxRight: number;
  minForward: number;
  maxForward: number;
  floorUp: number;
}

export interface HangarPadSpec {
  index: number;
  roomId: string;
  padRight: number;
  padForward: number;
}

export const APARTMENT_ROOM: BuildRoomBounds = {
  roomId: 'hab-room',
  minRight: -6.9,
  maxRight: -1.9,
  minForward: 2.6,
  maxForward: 7.8,
  floorUp: HAB_FLOOR_UP,
};

export const HANGAR_ROOMS: BuildRoomBounds[] = [
  {
    roomId: 'hangar-1',
    minRight: -56,
    maxRight: -20,
    minForward: -22,
    maxForward: 22,
    floorUp: HANGAR_FLOOR_UP,
  },
  {
    roomId: 'hangar-2',
    minRight: -18,
    maxRight: 18,
    minForward: -22,
    maxForward: 22,
    floorUp: HANGAR_FLOOR_UP,
  },
  {
    roomId: 'hangar-3',
    minRight: 20,
    maxRight: 56,
    minForward: -22,
    maxForward: 22,
    floorUp: HANGAR_FLOOR_UP,
  },
];

export const HANGAR_PADS: HangarPadSpec[] = [
  { index: 1, roomId: 'hangar-1', padRight: -38, padForward: 1.0 },
  { index: 2, roomId: 'hangar-2', padRight: 0, padForward: 1.0 },
  { index: 3, roomId: 'hangar-3', padRight: 38, padForward: 1.0 },
];

export interface StationLocalPoint {
  right: number;
  up: number;
  forward: number;
}

export interface PlacementTransform {
  right: number;
  up: number;
  forward: number;
  rotationY: number;
}

const DEFAULT_PROP_FOOTPRINT = 0.75;
const PAD_CLEARANCE_MARGIN = 0.5;

export function hangarRoomForIndex(index: number | null | undefined): BuildRoomBounds {
  const resolved = index === 1 || index === 2 || index === 3 ? index : 2;
  return HANGAR_ROOMS[resolved - 1]!;
}

export function buildRoomForArea(
  area: BuildArea,
  hangarIndex: number | null | undefined,
): BuildRoomBounds {
  return area === 'apartment' ? APARTMENT_ROOM : hangarRoomForIndex(hangarIndex);
}

export function snapScalar(value: number, grid: number | null | undefined): number {
  if (grid === null || grid === undefined || grid <= 0) return value;
  return Math.round(value / grid) * grid;
}

export function snapTransform(
  transform: PlacementTransform,
  snapGridM: number | null | undefined,
  floorUp: number,
): PlacementTransform {
  return {
    right: snapScalar(transform.right, snapGridM),
    forward: snapScalar(transform.forward, snapGridM),
    up: floorUp,
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

export function isInsideBuildRoom(
  point: StationLocalPoint,
  room: BuildRoomBounds,
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
  const pad = HANGAR_PADS.find((entry) => entry.index === hangarIndex);
  if (!pad) return false;
  const limit = HANGAR_PAD_HALF_METERS + footprint + PAD_CLEARANCE_MARGIN;
  return (
    Math.abs(point.right - pad.padRight) <= limit &&
    Math.abs(point.forward - pad.padForward) <= limit
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

export function validatePlacementTransform(params: {
  area: BuildArea;
  transform: PlacementTransform;
  hangarIndex: number;
  definition: {
    allowRotateY: boolean;
    snapGridM: number | null;
  };
  existingPlacements: PlacementTransform[];
}): { ok: true; transform: PlacementTransform } | { ok: false; message: string } {
  const room = buildRoomForArea(params.area, params.hangarIndex);
  const snapped = snapTransform(params.transform, params.definition.snapGridM, room.floorUp);
  snapped.rotationY = normalizeRotationY(
    snapped.rotationY,
    params.definition.allowRotateY,
  );

  if (!isInsideBuildRoom(snapped, room)) {
    return {
      ok: false,
      message:
        params.area === 'apartment'
          ? 'Placement is outside your apartment.'
          : 'Placement is outside your hangar bay.',
    };
  }
  if (params.area === 'hangar' && overlapsShipPad(snapped, params.hangarIndex)) {
    return { ok: false, message: 'Placement is too close to the ship pad.' };
  }

  for (const existing of params.existingPlacements) {
    if (boxesOverlap(snapped, existing)) {
      return { ok: false, message: 'Placement overlaps another prop.' };
    }
  }

  return { ok: true, transform: snapped };
}
