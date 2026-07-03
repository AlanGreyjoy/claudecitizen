import { cross, dot, normalize, scale, sub } from '../math/vec3';
import { createFlightBody } from '../flight/flight_body';
import {
  CHARACTER_GROUND_OFFSET_METERS,
  createCharacterState,
} from './character_controller';
import {
  cartesianFromLatLonAlt,
  eastVector,
  radialUp,
  surfacePointFromPosition,
} from '../world/coordinates';
import { resolveLandingSite } from '../world/landing_sites';
import { sampleFootPlanetSurface, sampleRenderablePlanetSurface } from '../world/planet_surface';
import type { CharacterState, FlightBody, Planet, Vec3 } from '../types';

import { SHIP_GEAR_REST_HEIGHT_METERS } from '../world/station';

/** Parked ships rest on deployed landing gear. */
const SHIP_SPAWN_ALTITUDE_METERS = SHIP_GEAR_REST_HEIGHT_METERS;
const CHARACTER_SPAWN_SIDE_METERS = 12;

function tangentize(vector: Vec3, up: Vec3): Vec3 {
  return sub(vector, scale(up, dot(vector, up)));
}

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
  const position = cartesianFromLatLonAlt(
    latRadians,
    lonRadians,
    surface.heightMeters + SHIP_SPAWN_ALTITUDE_METERS,
    planet.radiusMeters,
  );
  return createFlightBody(position, eastVector(position), surface.normal ?? radialUp(position));
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
