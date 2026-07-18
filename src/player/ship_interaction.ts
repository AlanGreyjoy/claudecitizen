import { add, cross, dot, length, normalize, scale, sub, vec3 } from '../math/vec3';
import { getShipLayout, getShipRestHeightMeters } from './ship_layout';
import type {
  CharacterState,
  FlightBody,
  LocalOffset,
  Pose,
  Vec3,
} from '../types';

/** Must match `SHIP_NEAR_PAD_HALF_EXTENT_METERS` in ship_physics. */
const NEAR_PAD_HALF_EXTENT_METERS = 36;

/**
 * Ship gameplay anchors (pilot seat, ramp interacts) read from the active
 * ship layout. Values are ship-local right/up/forward meters.
 */

export const PARKED_MAX_SPEED_METERS_PER_SECOND = 1.0;

interface ShipAnchor extends Pose {
  right: Vec3;
}

function tangentize(vector: Vec3, up: Vec3): Vec3 {
  return sub(vector, scale(up, dot(vector, up)));
}

export function getShipRight(ship: FlightBody): Vec3 {
  return normalize(cross(ship.forward, ship.up));
}

export function localOffsetToWorld(ship: FlightBody, local: LocalOffset): Vec3 {
  const right = getShipRight(ship);
  return add(
    add(ship.position, scale(right, local.right)),
    add(scale(ship.up, local.up), scale(ship.forward, local.forward)),
  );
}

export interface ShipLocalPoint {
  right: number;
  up: number;
  forward: number;
}

export function worldToShipLocal(ship: FlightBody, position: Vec3): ShipLocalPoint {
  const delta = sub(position, ship.position);
  return {
    right: dot(delta, getShipRight(ship)),
    up: dot(delta, ship.up),
    forward: dot(delta, normalize(tangentize(ship.forward, ship.up))),
  };
}

export function getPilotSeatAnchor(ship: FlightBody): ShipAnchor {
  return {
    forward: normalize(tangentize(ship.forward, ship.up)),
    position: localOffsetToWorld(ship, getShipLayout().pilotSeat),
    right: getShipRight(ship),
    up: ship.up,
  };
}

export function getPilotEyeLocal(): LocalOffset {
  return getShipLayout().pilotEye;
}

export function getBedSpec(bedId: string | null | undefined) {
  if (!bedId) return null;
  return getShipLayout().beds.find((bed) => bed.id === bedId) ?? null;
}

export function getBedAnchor(ship: FlightBody, bedId: string): ShipAnchor {
  const bed = getBedSpec(bedId);
  const local = bed?.bed ?? { right: 0, up: 0, forward: 0 };
  return {
    forward: normalize(tangentize(ship.forward, ship.up)),
    position: localOffsetToWorld(ship, local),
    right: getShipRight(ship),
    up: ship.up,
  };
}

export function getBedEyeLocal(bedId: string | null | undefined): LocalOffset | null {
  return getBedSpec(bedId)?.eye ?? null;
}

export function isShipParked(ship: FlightBody): boolean {
  return ship.grounded && length(ship.velocity) <= PARKED_MAX_SPEED_METERS_PER_SECOND;
}

/**
 * Feet near the ground / pad plane under a parked ship.
 * Pad parking and open-planet gear rest both put feet near -restHeight.
 * A wider band also tolerates soft altitude mismatch without matching deck floors.
 */
export function atShipGroundLevel(localUp: number): boolean {
  return Math.abs(localUp + getShipRestHeightMeters()) <= 2.8;
}

/** Near an outside ramp button while standing on the ground. */
export function nearShipRampOutside(
  character: Pick<CharacterState, 'position'>,
  ship: FlightBody,
): boolean {
  const local = worldToShipLocal(ship, character.position);
  if (!atShipGroundLevel(local.up)) return false;
  return getShipLayout().rampInteracts.some(
    (panel) =>
      panel.placement === 'outside' &&
      Math.hypot(local.right - panel.right, local.forward - panel.forward) <= panel.radius,
  );
}

/** Horizontal pad interest (ignores height) — stay near ship while exterior-walking. */
export function isWithinShipPadHorizontal(
  character: Pick<CharacterState, 'position'>,
  ship: FlightBody,
  halfExtentMeters: number = NEAR_PAD_HALF_EXTENT_METERS,
): boolean {
  const local = worldToShipLocal(ship, character.position);
  return (
    Math.abs(local.right) <= halfExtentMeters &&
    Math.abs(local.forward) <= halfExtentMeters
  );
}

/**
 * True when a parked ship owns locomotion: feet near the gear-rest pad band
 * and inside the ship-local pad horizontal extent.
 */
export function isNearParkedShipPad(
  character: Pick<CharacterState, 'position'>,
  ship: FlightBody,
  halfExtentMeters: number = NEAR_PAD_HALF_EXTENT_METERS,
): boolean {
  if (!isShipParked(ship)) return false;
  const local = worldToShipLocal(ship, character.position);
  if (!atShipGroundLevel(local.up)) return false;
  return isWithinShipPadHorizontal(character, ship, halfExtentMeters);
}

export function createTransitionPose(start: Pose, end: Pose, t: number): Pose {
  const clamped = Math.max(0, Math.min(1, t));
  return {
    forward: normalize({
      x: start.forward.x + (end.forward.x - start.forward.x) * clamped,
      y: start.forward.y + (end.forward.y - start.forward.y) * clamped,
      z: start.forward.z + (end.forward.z - start.forward.z) * clamped,
    }),
    position: vec3(
      start.position.x + (end.position.x - start.position.x) * clamped,
      start.position.y + (end.position.y - start.position.y) * clamped,
      start.position.z + (end.position.z - start.position.z) * clamped,
    ),
    up: normalize({
      x: start.up.x + (end.up.x - start.up.x) * clamped,
      y: start.up.y + (end.up.y - start.up.y) * clamped,
      z: start.up.z + (end.up.z - start.up.z) * clamped,
    }),
  };
}
