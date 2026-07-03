import { add, cross, dot, length, normalize, scale, sub, vec3 } from '../math/vec3';
import type {
  CharacterState,
  FlightBody,
  LocalOffset,
  Pose,
  Vec3,
} from '../types';

/**
 * Phobos Starhopper gameplay anchors, measured from the model rig:
 * nose is +forward, the pilot seat sits in the cockpit at forward ~6.4 behind
 * sliding doors at ~2.7, and the boarding ramp drops from the tail at ~-8.4.
 */

/** Ship-local offset from ship origin to the seated pilot pose. */
export const PILOT_SEAT_LOCAL: LocalOffset = { right: 0, up: -0.62, forward: 6.05 };

/** Standing spot just behind the chair after getting up. */
export const SEAT_STAND_LOCAL = { right: 0, forward: 4.5 };

/** Outside interaction point at the foot of the (lowered) ramp. */
export const RAMP_OUTSIDE_LOCAL = { right: 0, forward: -9.7 };
export const RAMP_OUTSIDE_INTERACT_DISTANCE_METERS = 3.0;

/** Walking into this tail strip (parked, ramp down) steps onto the ramp. */
const MOUNT_MIN_FORWARD = -8.8;
const MOUNT_MAX_FORWARD = -8.0;
const MOUNT_MAX_RIGHT = 1.05;
/** Above the dismount line so mounting does not immediately step back off. */
const MOUNT_CLAMP_FORWARD = -8.2;

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
    position: localOffsetToWorld(ship, PILOT_SEAT_LOCAL),
    right: getShipRight(ship),
    up: ship.up,
  };
}

export function isShipParked(ship: FlightBody): boolean {
  return ship.grounded && length(ship.velocity) <= PARKED_MAX_SPEED_METERS_PER_SECOND;
}

/** Feet near the ground plane under a parked ship (rejects other station floors). */
function atShipGroundLevel(localUp: number): boolean {
  return Math.abs(localUp + 3.2) <= 2.4;
}

/** Near the tail ramp button while standing on the ground outside. */
export function nearShipRampOutside(
  character: Pick<CharacterState, 'position'>,
  ship: FlightBody,
): boolean {
  const local = worldToShipLocal(ship, character.position);
  if (!atShipGroundLevel(local.up)) return false;
  return (
    Math.hypot(local.right - RAMP_OUTSIDE_LOCAL.right, local.forward - RAMP_OUTSIDE_LOCAL.forward) <=
    RAMP_OUTSIDE_INTERACT_DISTANCE_METERS
  );
}

/**
 * Ship-local 2D spot to start deck-walking from when a character on the
 * ground walks into the foot of the lowered ramp, or null when outside it.
 */
export function sampleRampMount(
  character: Pick<CharacterState, 'position'>,
  ship: FlightBody,
): { right: number; forward: number } | null {
  const local = worldToShipLocal(ship, character.position);
  if (!atShipGroundLevel(local.up)) return null;
  if (Math.abs(local.right) > MOUNT_MAX_RIGHT) return null;
  if (local.forward < MOUNT_MIN_FORWARD || local.forward > MOUNT_MAX_FORWARD) return null;
  return { right: local.right, forward: Math.max(local.forward, MOUNT_CLAMP_FORWARD) };
}

/** Ground spot just past the ramp tip for a character stepping off. */
export const RAMP_DISMOUNT_GROUND_LOCAL = { right: 0, forward: -9.6 };

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
