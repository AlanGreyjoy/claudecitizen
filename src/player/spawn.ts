import { cross, dot, normalize, scale, sub, tangentize } from '../math/vec3';
import { createFlightBody } from '../flight/flight-body';
import {
  CHARACTER_GROUND_OFFSET_METERS,
  createCharacterState,
} from './character-controller';
import {
  cartesianFromLatLonAlt,
  eastVector,
  radialUp,
  surfacePointFromPosition,
} from '../world/coordinates';
import { resolveLandingSite } from '../world/landing-sites';
import { sampleFootPlanetSurface, sampleRenderablePlanetSurface } from '../world/planet-surface';
import type { CharacterState, FlightBody, Planet, Vec3 } from '../types';
import type { HangarOpenSpaceExitWorldPose } from '../world/hangar-open-space-exit';

import { getShipRestHeightMeters } from './ship-layout';
import { getPilotSeatAnchor } from './ship-interaction';

const CHARACTER_SPAWN_SIDE_METERS = 12;
/** Open-space spawn altitude, as a multiple of the planet's atmosphere height. */
const SPACE_SPAWN_ATMOSPHERE_MULTIPLE = 1.5;

function yawFromForward(position: Vec3, forward: Vec3): number {
  const up = radialUp(position);
  const east = eastVector(position);
  const north = normalize(cross(up, east));
  return Math.atan2(dot(forward, north), dot(forward, east));
}

export function createSpawnShip(planet: Planet, seed: number): FlightBody {
  const { latRadians, lonRadians } = resolveLandingSite(planet, seed);
  const probe = cartesianFromLatLonAlt(latRadians, lonRadians, 0, planet.radiusMeters);
  const surface = sampleRenderablePlanetSurface(planet, seed, probe);
  // Parked ships rest on deployed landing gear (prefab-authored when set).
  const position = cartesianFromLatLonAlt(
    latRadians,
    lonRadians,
    surface.heightMeters + getShipRestHeightMeters(),
    planet.radiusMeters,
  );
  return createFlightBody(position, eastVector(position), surface.normal ?? radialUp(position));
}

/**
 * Ship pose for an open-space arrival.
 *
 * Flying out of a hangar hands the session to another scene, so the hull has to
 * be re-created somewhere that reads as space rather than at the parked landing
 * site. Altitude comes off the planet's own atmosphere height so a small moon
 * and a gas giant both spawn you *above* the sky rather than inside it.
 */
export function createSpaceSpawnShip(planet: Planet, seed: number): FlightBody {
  const { latRadians, lonRadians } = resolveLandingSite(planet, seed);
  const position = cartesianFromLatLonAlt(
    latRadians,
    lonRadians,
    planet.atmosphereHeightMeters * SPACE_SPAWN_ATMOSPHERE_MULTIPLE,
    planet.radiusMeters,
  );
  // Facing along the orbit track, upright relative to the planet below.
  return createFlightBody(position, eastVector(position), radialUp(position));
}

/** Open-space arrival at a station hangar mouth (`hangar-open-space-exit`). */
export function createSpaceSpawnShipAtPose(pose: HangarOpenSpaceExitWorldPose): FlightBody {
  return createFlightBody(pose.position, pose.forward, pose.up);
}

/** Character already seated at the controls, for an arrival that is mid-flight. */
export function createPilotSpawnCharacter(ship: FlightBody): CharacterState {
  const seat = getPilotSeatAnchor(ship);
  return {
    ...createCharacterState(seat.position, seat.forward),
    animation: 'Sitting_Idle',
    forward: seat.forward,
    up: seat.up,
  };
}

export function createSpawnCharacter(
  planet: Planet,
  seed: number,
  ship: FlightBody,
): CharacterState {
  const shipUp = radialUp(ship.position);
  const shipRight = normalize(cross(ship.forward, shipUp));
  const probe = sub(ship.position, scale(shipRight, CHARACTER_SPAWN_SIDE_METERS));
  const surface = sampleFootPlanetSurface(planet, seed, probe);
  const position = surfacePointFromPosition(
    probe,
    surface.surfaceRadiusMeters + CHARACTER_GROUND_OFFSET_METERS,
  );
  const forward = normalize(tangentize(sub(ship.position, position), radialUp(position)));
  return createCharacterState(position, forward);
}

export function initialCameraYaw(character: CharacterState): number {
  return yawFromForward(character.position, character.forward);
}
