import { add, cross, dot, normalize, scale, sub } from '../math/vec3';
import { cartesianFromLatLonAlt, eastVector, radialUp } from './coordinates';
import { DEFAULT_SPAWN_SITE } from './landing_sites';
import type { Planet, Vec3 } from '../types';
import type { GameplayCollider } from '../physics/colliders';
import type { PrefabSoundSpec } from './prefabs/sound_runtime';

/**
 * Orbital habitat station fixed above the default landing site. Gameplay uses
 * station-local coordinates: right / up / forward meters from the station
 * origin. The player now walks on real collider geometry provided by the active
 * station prefab; rooms are only used for legacy marker/floor bookkeeping.
 */

export const STATION_ALTITUDE_METERS = 200_000;

export type StationFloorId = 'hab' | 'lobby' | 'hangar';
export type StationSide = 'minRight' | 'maxRight' | 'minForward' | 'maxForward';

export interface StationFrame {
  origin: Vec3;
  right: Vec3;
  up: Vec3;
  forward: Vec3;
}

export interface StationLocalPoint {
  right: number;
  up: number;
  forward: number;
}

export interface StationDir2 {
  right: number;
  forward: number;
}

export interface StationRoom {
  id: string;
  floorId: StationFloorId;
  minRight: number;
  maxRight: number;
  minForward: number;
  maxForward: number;
  /** Local up of the walkable floor surface. */
  floorUp: number;
  /** Interior height from floor to ceiling. */
  height: number;
  /** Sides with no wall (e.g. hangar mouth opening to space). */
  openSides?: StationSide[];
}

export interface StationDoorway {
  id: string;
  floorId: StationFloorId;
  /** Axis you walk along when crossing the doorway. */
  crossAxis: 'right' | 'forward';
  /** Edge coordinates of the two rooms this doorway bridges. */
  crossFrom: number;
  crossTo: number;
  /** Center of the opening along the wall. */
  alongCenter: number;
  /** Visual opening width along the wall. */
  width: number;
  /** Narrower walkable width so the avatar does not clip the jambs. */
  walkWidth: number;
  /** Opening height above the floor. */
  height: number;
  floorUp: number;
}

export interface StationWindow {
  roomId: string;
  side: StationSide;
  alongCenter: number;
  width: number;
  /** Sill height above the room floor. */
  bottom: number;
  /** Top of the opening above the room floor. */
  top: number;
}

export interface StationAnchor {
  floorId: StationFloorId;
  right: number;
  forward: number;
  radius: number;
}

export interface ElevatorDestination {
  roomId: string;
  right: number;
  forward: number;
  face: StationDir2;
  /** Shown on the prompt while the elevator is moving. */
  label: string;
}

export interface HangarSpec {
  index: number;
  roomId: string;
  centerRight: number;
  /** Forward coordinate of this hangar's elevator door on the lobby wall. */
  lobbyDoorForward: number;
  /**
   * Pad surface point in station-local coordinates. A parked ship's origin
   * rests one gear-rest height above it (the active ship layout's value).
   */
  padSurfaceLocal: StationLocalPoint;
}

export const HAB_FLOOR_UP = 14;
export const LOBBY_FLOOR_UP = 0;
export const HANGAR_FLOOR_UP = -22;
export const HANGAR_PAD_HEIGHT = 0.12;
export const HANGAR_PAD_HALF_METERS = 8;


export const STATION_ROOMS: StationRoom[] = [
  {
    id: 'hab-room',
    floorId: 'hab',
    minRight: -6.9,
    maxRight: -1.9,
    minForward: 2.6,
    maxForward: 7.8,
    floorUp: HAB_FLOOR_UP,
    height: 3.0,
  },
  {
    id: 'hab-corridor',
    floorId: 'hab',
    minRight: -1.5,
    maxRight: 1.5,
    minForward: -10,
    maxForward: 8,
    floorUp: HAB_FLOOR_UP,
    height: 3.2,
  },
  {
    id: 'hab-lift',
    floorId: 'hab',
    minRight: -1.4,
    maxRight: 1.4,
    minForward: -13.4,
    maxForward: -10.4,
    floorUp: HAB_FLOOR_UP,
    height: 2.7,
  },
  {
    id: 'lobby',
    floorId: 'lobby',
    minRight: -14,
    maxRight: 14,
    minForward: -12,
    maxForward: 12,
    floorUp: LOBBY_FLOOR_UP,
    height: 5,
  },
  {
    id: 'hangar-1',
    floorId: 'hangar',
    minRight: -56,
    maxRight: -20,
    minForward: -22,
    maxForward: 22,
    floorUp: HANGAR_FLOOR_UP,
    height: 14,
    openSides: ['maxForward'],
  },
  {
    id: 'hangar-2',
    floorId: 'hangar',
    minRight: -18,
    maxRight: 18,
    minForward: -22,
    maxForward: 22,
    floorUp: HANGAR_FLOOR_UP,
    height: 14,
    openSides: ['maxForward'],
  },
  {
    id: 'hangar-3',
    floorId: 'hangar',
    minRight: 20,
    maxRight: 56,
    minForward: -22,
    maxForward: 22,
    floorUp: HANGAR_FLOOR_UP,
    height: 14,
    openSides: ['maxForward'],
  },
];

export const STATION_DOORWAYS: StationDoorway[] = [
  {
    id: 'door-hab-room',
    floorId: 'hab',
    crossAxis: 'right',
    crossFrom: -1.9,
    crossTo: -1.5,
    alongCenter: 5.2,
    width: 1.8,
    walkWidth: 1.4,
    height: 2.25,
    floorUp: HAB_FLOOR_UP,
  },
  {
    id: 'door-hab-lift',
    floorId: 'hab',
    crossAxis: 'forward',
    crossFrom: -10.4,
    crossTo: -10,
    alongCenter: 0,
    width: 1.8,
    walkWidth: 1.4,
    height: 2.25,
    floorUp: HAB_FLOOR_UP,
  },
];

export const STATION_WINDOWS: StationWindow[] = [
  { roomId: 'hab-room', side: 'minRight', alongCenter: 5.2, width: 2.6, bottom: 1.0, top: 2.3 },
  { roomId: 'lobby', side: 'maxForward', alongCenter: -8, width: 3.2, bottom: 1.1, top: 3.6 },
  { roomId: 'lobby', side: 'maxForward', alongCenter: 0, width: 3.2, bottom: 1.1, top: 3.6 },
  { roomId: 'lobby', side: 'maxForward', alongCenter: 8, width: 3.2, bottom: 1.1, top: 3.6 },
];

const PAD_SURFACE_UP = HANGAR_FLOOR_UP + HANGAR_PAD_HEIGHT;

export const HANGARS: HangarSpec[] = [
  {
    index: 1,
    roomId: 'hangar-1',
    centerRight: -38,
    lobbyDoorForward: -6,
    padSurfaceLocal: { right: -38, up: PAD_SURFACE_UP, forward: 1.0 },
  },
  {
    index: 2,
    roomId: 'hangar-2',
    centerRight: 0,
    lobbyDoorForward: 0,
    padSurfaceLocal: { right: 0, up: PAD_SURFACE_UP, forward: 1.0 },
  },
  {
    index: 3,
    roomId: 'hangar-3',
    centerRight: 38,
    lobbyDoorForward: 6,
    padSurfaceLocal: { right: 38, up: PAD_SURFACE_UP, forward: 1.0 },
  },
];

export interface StationSpawnPose {
  roomId: string;
  right: number;
  up: number;
  forward: number;
  face: StationDir2;
}

/** Player spawn pose inside the hab room, facing the door. */
export const STATION_SPAWN: StationSpawnPose = {
  roomId: 'hab-room',
  right: -4.4,
  up: HAB_FLOOR_UP,
  forward: 5.2,
  face: { right: 1, forward: 0 },
};

export const STATION_ANCHORS = {
  habLiftHab: { floorId: 'hab', right: 0, forward: -11.9, radius: 2.2 } as StationAnchor,
  habLiftLobby: { floorId: 'lobby', right: 0, forward: -10.6, radius: 2.4 } as StationAnchor,
  terminal: { floorId: 'lobby', right: 0, forward: 7.4, radius: 2.4 } as StationAnchor,
  hangarBank: { floorId: 'lobby', right: 12.8, forward: 0, radius: 7.6 } as StationAnchor,
};

export function hangarLiftAnchor(hangar: HangarSpec): StationAnchor {
  return { floorId: 'hangar', right: hangar.centerRight, forward: -20.6, radius: 2.6 };
}

export const LOBBY_ARRIVAL_FROM_HAB: ElevatorDestination = {
  roomId: 'lobby',
  right: 0,
  forward: -9.8,
  face: { right: 0, forward: 1 },
  label: 'Descending to the lobby',
};

export const HAB_ARRIVAL_FROM_LOBBY: ElevatorDestination = {
  roomId: 'hab-lift',
  right: 0,
  forward: -11.9,
  face: { right: 0, forward: 1 },
  label: 'Ascending to the habs',
};

export function hangarArrival(hangar: HangarSpec): ElevatorDestination {
  return {
    roomId: hangar.roomId,
    right: hangar.centerRight,
    forward: -19.6,
    face: { right: 0, forward: 1 },
    label: `Descending to Hangar ${hangar.index}`,
  };
}

export function lobbyArrivalFromHangar(hangar: HangarSpec): ElevatorDestination {
  return {
    roomId: 'lobby',
    right: 12.2,
    forward: hangar.lobbyDoorForward,
    face: { right: -1, forward: 0 },
    label: 'Ascending to the lobby',
  };
}

const frameCache = new Map<string, StationFrame>();

export function getStationFrame(planet: Planet): StationFrame {
  const key = `${planet.name ?? 'planet'}:${planet.radiusMeters}`;
  const cached = frameCache.get(key);
  if (cached) return cached;

  const origin = cartesianFromLatLonAlt(
    DEFAULT_SPAWN_SITE.latRadians,
    DEFAULT_SPAWN_SITE.lonRadians,
    STATION_ALTITUDE_METERS,
    planet.radiusMeters,
  );
  const up = radialUp(origin);
  const forward = eastVector(origin);
  const right = normalize(cross(forward, up));
  const frame: StationFrame = { origin, right, up, forward };
  frameCache.set(key, frame);
  return frame;
}

export function stationLocalToWorld(frame: StationFrame, local: StationLocalPoint): Vec3 {
  return add(
    add(frame.origin, scale(frame.right, local.right)),
    add(scale(frame.up, local.up), scale(frame.forward, local.forward)),
  );
}

export function worldToStationLocal(frame: StationFrame, position: Vec3): StationLocalPoint {
  const delta = sub(position, frame.origin);
  return {
    right: dot(delta, frame.right),
    up: dot(delta, frame.up),
    forward: dot(delta, frame.forward),
  };
}

export function stationDirToWorld(frame: StationFrame, dir: StationDir2): Vec3 {
  return normalize(
    add(scale(frame.right, dir.right), scale(frame.forward, dir.forward)),
  );
}

/**
 * Prefab-driven station layouts (dev preview via ?stationPrefab=<id>).
 *
 * When an override is active the room/walk/hangar/spawn queries below read
 * from it instead of the hand-authored constants. The default path (no
 * override) is bit-identical to the original behavior. Elevator and info
 * markers replace the bespoke anchor wiring in station_interaction.ts.
 */
export interface StationElevatorMarker {
  /** Markers sharing a pairId form one elevator; ride goes to the marker on targetFloor. */
  pairId: string;
  floorId: StationFloorId;
  roomId: string;
  right: number;
  up: number;
  forward: number;
  radius: number;
  targetFloor: StationFloorId;
  face: StationDir2;
}

export interface StationInfoMarker {
  id: string;
  floorId: StationFloorId;
  right: number;
  up: number;
  forward: number;
  radius: number;
  prompt: string;
  interactionType?: "info" | "animation";
  targetAnimationId?: string;
  keyLabel?: string;
  proximitySoundUrl?: string;
  interactSoundUrl?: string;
}

export interface StationAvmsMarker {
  id: string;
  floorId: StationFloorId;
  right: number;
  up: number;
  forward: number;
  radius: number;
}

export interface StationLayoutOverride {
  rooms: StationRoom[];
  doorways: StationDoorway[];
  hangars: HangarSpec[];
  colliders: GameplayCollider[];
  spawn: StationSpawnPose;
  elevatorMarkers: StationElevatorMarker[];
  infoMarkers: StationInfoMarker[];
  avmsMarkers: StationAvmsMarker[];
  sounds: PrefabSoundSpec[];
}

let layoutOverride: StationLayoutOverride | null = null;

export function setStationLayoutOverride(override: StationLayoutOverride | null): void {
  layoutOverride = override;
}

export function getStationLayoutOverride(): StationLayoutOverride | null {
  return layoutOverride;
}

export function getStationSpawn(): StationSpawnPose {
  return layoutOverride?.spawn ?? STATION_SPAWN;
}

export function getStationHangars(): HangarSpec[] {
  return layoutOverride?.hangars ?? HANGARS;
}

export function getStationColliders(): GameplayCollider[] {
  return layoutOverride?.colliders ?? [];
}

export function getStationRoom(roomId: string): StationRoom | null {
  const rooms = layoutOverride?.rooms ?? STATION_ROOMS;
  return rooms.find((room) => room.id === roomId) ?? null;
}

export interface HangarRestSample {
  hangar: HangarSpec;
  /** Station-local up of the surface under the ship (pad or hangar floor). */
  surfaceUp: number;
  /** Station-local up the ship origin rests at on deployed gear. */
  restUp: number;
}

/** Vertical slack below a hangar floor/pad so a settling ship never tunnels through. */
const HANGAR_REST_BELOW_SLACK_METERS = 4;
/** Ceiling above the pad for pad-only (no walk-volume room) hangar rest checks. */
const HANGAR_PAD_REST_HEIGHT_METERS = 20;
/**
 * Horizontal slack beyond the pad half-extent for the ship origin. Prefab
 * stations have no room AABB; the origin must still count as "in hangar"
 * while parked slightly off pad center.
 */
const HANGAR_PAD_ORIGIN_SLACK_METERS = 4;

function hangarRestSample(
  hangar: HangarSpec,
  surfaceUp: number,
  shipRestHeightMeters: number,
): HangarRestSample {
  return {
    hangar,
    surfaceUp,
    restUp: surfaceUp + shipRestHeightMeters,
  };
}

function inRoomHangarVolume(
  local: StationLocalPoint,
  room: StationRoom,
): boolean {
  if (local.right < room.minRight || local.right > room.maxRight) return false;
  if (local.forward < room.minForward || local.forward > room.maxForward) {
    return false;
  }
  return (
    local.up >= room.floorUp - HANGAR_REST_BELOW_SLACK_METERS &&
    local.up <= room.floorUp + room.height
  );
}

function withinPadHorizontal(
  local: StationLocalPoint,
  pad: StationLocalPoint,
  halfMeters: number,
): boolean {
  return (
    Math.abs(local.right - pad.right) <= halfMeters &&
    Math.abs(local.forward - pad.forward) <= halfMeters
  );
}

function withinPadVertical(local: StationLocalPoint, pad: StationLocalPoint): boolean {
  return (
    local.up >= pad.up - HANGAR_REST_BELOW_SLACK_METERS &&
    local.up <= pad.up + HANGAR_PAD_REST_HEIGHT_METERS
  );
}

/**
 * Returns the parking surface under a world position when it is inside a
 * hangar volume (with a little vertical slack below the floor so a settling
 * ship never tunnels through), or null in open space. The caller supplies
 * the active ship's gear-rest height (world/ does not know the ship layout).
 *
 * Prefab stations often have empty walk-volume rooms (collider-based walking),
 * so this falls back to pad proximity when no room AABB exists for the hangar.
 */
export function sampleHangarRest(
  frame: StationFrame,
  position: Vec3,
  shipRestHeightMeters: number,
): HangarRestSample | null {
  const local = worldToStationLocal(frame, position);
  for (const hangar of getStationHangars()) {
    const room = getStationRoom(hangar.roomId);
    if (room) {
      if (!inRoomHangarVolume(local, room)) continue;
      const onPad = withinPadHorizontal(
        local,
        hangar.padSurfaceLocal,
        HANGAR_PAD_HALF_METERS,
      );
      const surfaceUp = onPad ? hangar.padSurfaceLocal.up : room.floorUp;
      return hangarRestSample(hangar, surfaceUp, shipRestHeightMeters);
    }

    // Pad-only hangar (prefab station with no walk-volume rooms).
    const pad = hangar.padSurfaceLocal;
    if (
      !withinPadHorizontal(
        local,
        pad,
        HANGAR_PAD_HALF_METERS + HANGAR_PAD_ORIGIN_SLACK_METERS,
      ) ||
      !withinPadVertical(local, pad)
    ) {
      continue;
    }
    return hangarRestSample(hangar, pad.up, shipRestHeightMeters);
  }
  return null;
}

/** Look up a hangar by pad index (assignedHangar), or null if missing. */
export function getHangarByIndex(index: number): HangarSpec | null {
  return getStationHangars().find((hangar) => hangar.index === index) ?? null;
}

