import { vec3 } from '../math/vec3';
import { MODE_IN_STATION, MODE_RIDING_ELEVATOR } from './modes';
import {
  getStationFrame,
  getStationRoom,
  HAB_ARRIVAL_FROM_LOBBY,
  HANGARS,
  hangarArrival,
  hangarLiftAnchor,
  LOBBY_ARRIVAL_FROM_HAB,
  lobbyArrivalFromHangar,
  STATION_ANCHORS,
  stationLocalToWorld,
  type ElevatorDestination,
  type HangarSpec,
  type StationAnchor,
  type StationFrame,
} from '../world/station';
import { characterAtElevatorDestination, type StationCharacterState } from './station_walk';
import type { Planet } from '../types';
import type { WorldState } from './world_state';

export const ELEVATOR_RIDE_SECONDS = 2.4;
export const ELEVATOR_FADE_SECONDS = 0.45;
const ELEVATOR_TELEPORT_AT_SECONDS = 1.3;

export interface StationElevatorRide {
  destination: ElevatorDestination;
  duration: number;
  elapsed: number;
  teleported: boolean;
}

export type StationInteraction =
  | { kind: 'hab-lift-down' }
  | { kind: 'hab-lift-up' }
  | { kind: 'terminal' }
  | { kind: 'hangar-bank' }
  | { kind: 'hangar-lift-up'; hangar: HangarSpec };

function nearAnchor(character: StationCharacterState, anchor: StationAnchor): boolean {
  const room = getStationRoom(character.stationRoomId);
  if (!room || room.floorId !== anchor.floorId) return false;
  return (
    Math.hypot(
      character.stationLocal.right - anchor.right,
      character.stationLocal.forward - anchor.forward,
    ) <= anchor.radius
  );
}

export function resolveStationInteraction(
  character: StationCharacterState,
): StationInteraction | null {
  const room = getStationRoom(character.stationRoomId);
  if (!room) return null;

  if (room.floorId === 'hab') {
    if (nearAnchor(character, STATION_ANCHORS.habLiftHab)) return { kind: 'hab-lift-down' };
    return null;
  }

  if (room.floorId === 'lobby') {
    if (nearAnchor(character, STATION_ANCHORS.habLiftLobby)) return { kind: 'hab-lift-up' };
    if (nearAnchor(character, STATION_ANCHORS.terminal)) return { kind: 'terminal' };
    if (nearAnchor(character, STATION_ANCHORS.hangarBank)) return { kind: 'hangar-bank' };
    return null;
  }

  for (const hangar of HANGARS) {
    if (hangar.roomId !== character.stationRoomId) continue;
    if (nearAnchor(character, hangarLiftAnchor(hangar))) {
      return { kind: 'hangar-lift-up', hangar };
    }
  }
  return null;
}

export function elevatorDestinationFor(
  interaction: StationInteraction,
  hangarIndex?: number,
): ElevatorDestination | null {
  if (interaction.kind === 'hab-lift-down') return LOBBY_ARRIVAL_FROM_HAB;
  if (interaction.kind === 'hab-lift-up') return HAB_ARRIVAL_FROM_LOBBY;
  if (interaction.kind === 'hangar-lift-up') return lobbyArrivalFromHangar(interaction.hangar);
  if (interaction.kind === 'hangar-bank' && hangarIndex) {
    const hangar = HANGARS.find((entry) => entry.index === hangarIndex);
    if (hangar) return hangarArrival(hangar);
  }
  return null;
}

export function beginElevatorRide(world: WorldState, destination: ElevatorDestination): void {
  world.mode = MODE_RIDING_ELEVATOR;
  world.prompt = '';
  world.stationElevator = {
    destination,
    duration: ELEVATOR_RIDE_SECONDS,
    elapsed: 0,
    teleported: false,
  };
}

export interface ElevatorRideResult {
  teleportedNow: boolean;
  destination: ElevatorDestination | null;
}

export function updateElevatorRide(
  world: WorldState,
  frame: StationFrame,
  dt: number,
): ElevatorRideResult {
  const ride = world.stationElevator;
  if (!ride) {
    world.mode = MODE_IN_STATION;
    world.screenFade = 0;
    return { teleportedNow: false, destination: null };
  }

  ride.elapsed = Math.min(ride.duration, ride.elapsed + dt);
  const fadeIn = Math.min(1, ride.elapsed / ELEVATOR_FADE_SECONDS);
  const fadeOut = Math.min(1, (ride.duration - ride.elapsed) / ELEVATOR_FADE_SECONDS);
  world.screenFade = Math.max(0, Math.min(fadeIn, fadeOut));

  let teleportedNow = false;
  if (!ride.teleported && ride.elapsed >= ELEVATOR_TELEPORT_AT_SECONDS) {
    ride.teleported = true;
    teleportedNow = true;
    world.character = characterAtElevatorDestination(frame, ride.destination);
  }

  if (ride.elapsed >= ride.duration) {
    world.mode = MODE_IN_STATION;
    world.stationElevator = null;
    world.screenFade = 0;
  }

  return { teleportedNow, destination: ride.destination };
}

/**
 * Assigns a hangar and parks the player's ship on its pad: engines off,
 * zero velocity, grounded, nose facing the hangar mouth.
 */
export function callShipToHangar(world: WorldState, planet: Planet, seed: number): HangarSpec {
  const hangar = HANGARS[Math.abs(seed) % HANGARS.length];
  const frame = getStationFrame(planet);
  world.ship = {
    forward: frame.forward,
    grounded: true,
    position: stationLocalToWorld(frame, hangar.padLocal),
    up: frame.up,
    velocity: vec3(0, 0, 0),
  };
  world.assignedHangar = hangar.index;
  return hangar;
}
