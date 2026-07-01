import { add, cross, distance, dot, length, normalize, scale, sub, vec3 } from '../math/vec3';
import { CHARACTER_GROUND_OFFSET_METERS } from './character_controller';
import { radialUp, surfacePointFromPosition } from '../world/coordinates';
import { sampleRenderablePlanetSurface } from '../world/planet_surface';
import type {
  CharacterState,
  FlightBody,
  LocalOffset,
  Planet,
  PlanetSurfaceSample,
  Pose,
  Vec3,
} from '../types';

export const ENTER_DISTANCE_METERS = 7;
export const EXIT_MAX_ALTITUDE_METERS = 5;
export const EXIT_MAX_SPEED_METERS_PER_SECOND = 12;

/** Ship-local offset from ship origin to the pilot wheel (right, up, forward). */
export const PILOT_WHEEL_LOCAL: LocalOffset = { right: 3.8, up: 1.3, forward: -0.6 };

/** Standing pose beside the wheel when leaving pilot mode (toward deck center). */
export const LEAVE_PILOT_STAND_LOCAL: LocalOffset = { right: 2.6, up: 1.3, forward: -0.6 };

/** Deck disembark point on the hull side away from the wheel. */
export const EXIT_RAMP_LOCAL: LocalOffset = { right: 5.0, up: 1.3, forward: -0.6 };

export const PILOT_INTERACT_DISTANCE_METERS = 2;
export const EXIT_RAMP_INTERACT_DISTANCE_METERS = 2.4;

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

export function getPilotWheelAnchor(ship: FlightBody): ShipAnchor {
  const right = getShipRight(ship);
  const wheelPosition = localOffsetToWorld(ship, PILOT_WHEEL_LOCAL);
  return {
    forward: normalize(tangentize(ship.forward, ship.up)),
    position: wheelPosition,
    right,
    up: ship.up,
  };
}

/** @deprecated Use getPilotWheelAnchor */
export function getShipInteractionAnchor(ship: FlightBody): ShipAnchor {
  return getPilotWheelAnchor(ship);
}

export function getDeckPoseFromLocal(ship: FlightBody, local: LocalOffset): ShipAnchor {
  const right = getShipRight(ship);
  const position = localOffsetToWorld(ship, local);
  return {
    forward: normalize(tangentize(ship.forward, ship.up)),
    position,
    right,
    up: ship.up,
  };
}

export function getShipExitRampAnchor(ship: FlightBody): ShipAnchor {
  return getDeckPoseFromLocal(ship, EXIT_RAMP_LOCAL);
}

export function getShipExitPosition(ship: FlightBody, planet: Planet, seed: number): Pose {
  const ramp = getShipExitRampAnchor(ship);
  const exitProbe = add(ramp.position, scale(ramp.right, 2.4));
  const surface = sampleRenderablePlanetSurface(planet, seed, exitProbe);
  const position = surfacePointFromPosition(
    exitProbe,
    surface.surfaceRadiusMeters + CHARACTER_GROUND_OFFSET_METERS,
  );
  const up = surface.normal ?? radialUp(position);
  return {
    forward: normalize(tangentize(ship.forward, up)),
    position,
    up,
  };
}

export function canEnterShip(character: Pick<CharacterState, 'position'>, ship: FlightBody): boolean {
  const anchor = getPilotWheelAnchor(ship);
  return distance(character.position, anchor.position) <= ENTER_DISTANCE_METERS;
}

export function canExitShip(
  ship: FlightBody,
  surface?: Pick<PlanetSurfaceSample, 'altitudeMeters'> | null,
): boolean {
  const shipSurface = surface ?? { altitudeMeters: 0 };
  return (
    shipSurface.altitudeMeters <= EXIT_MAX_ALTITUDE_METERS &&
    length(ship.velocity) <= EXIT_MAX_SPEED_METERS_PER_SECOND
  );
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
