import { vec3 } from '../math/vec3';
import { MODE_IN_STATION, MODE_RIDING_ELEVATOR } from './modes';
import {
  getStationFrame,
  getStationHangars,
  getStationLayoutOverride,
  getStationRoom,
  HAB_ARRIVAL_FROM_LOBBY,
  hangarArrival,
  hangarLiftAnchor,
  LOBBY_ARRIVAL_FROM_HAB,
  lobbyArrivalFromHangar,
  STATION_ANCHORS,
  stationLocalToWorld,
  type ElevatorDestination,
  type HangarSpec,
  type StationAnchor,
  type StationElevatorMarker,
  type StationFrame,
} from '../world/station';
import { getShipRestHeightMeters } from './ship_layout';
import { characterAtElevatorDestination, type StationCharacterState } from './station_walk';
import type { Planet } from '../types';
import { getActiveShip, type WorldState } from './world_state';

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
  | { kind: 'hangar-lift-up'; hangar: HangarSpec }
  | { kind: 'prefab-elevator'; marker: StationElevatorMarker }
  | { kind: 'prefab-info'; prompt: string };

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

/** Prefab-driven stations resolve interactions from placed markers. */
function resolvePrefabInteraction(
  character: StationCharacterState,
): StationInteraction | null {
  const override = getStationLayoutOverride();
  if (!override) return null;
  const room = getStationRoom(character.stationRoomId);
  if (!room) return null;

  for (const marker of override.elevatorMarkers) {
    if (marker.floorId !== room.floorId) continue;
    const near =
      Math.hypot(
        character.stationLocal.right - marker.right,
        character.stationLocal.forward - marker.forward,
      ) <= marker.radius;
    if (near) return { kind: 'prefab-elevator', marker };
  }

  for (const info of override.infoMarkers) {
    if (info.floorId !== room.floorId) continue;
    const near =
      Math.hypot(
        character.stationLocal.right - info.right,
        character.stationLocal.forward - info.forward,
      ) <= info.radius;
    if (near) return { kind: 'prefab-info', prompt: info.prompt };
  }

  return null;
}

export function resolveStationInteraction(
  character: StationCharacterState,
): StationInteraction | null {
  if (getStationLayoutOverride()) return resolvePrefabInteraction(character);

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

  for (const hangar of getStationHangars()) {
    if (hangar.roomId !== character.stationRoomId) continue;
    if (nearAnchor(character, hangarLiftAnchor(hangar))) {
      return { kind: 'hangar-lift-up', hangar };
    }
  }
  return null;
}

function floorLabel(floor: StationElevatorMarker['targetFloor']): string {
  if (floor === 'hab') return 'the habs';
  if (floor === 'hangar') return 'the hangar deck';
  return 'the lobby';
}

/** Destination for a paired prefab elevator: the marker with the same pairId on the target floor. */
function prefabElevatorDestination(marker: StationElevatorMarker): ElevatorDestination | null {
  const override = getStationLayoutOverride();
  if (!override) return null;
  const target = override.elevatorMarkers.find(
    (candidate) =>
      candidate !== marker &&
      candidate.pairId === marker.pairId &&
      candidate.floorId === marker.targetFloor,
  );
  if (!target) {
    console.warn(
      `Prefab elevator "${marker.pairId}" has no matching marker on floor "${marker.targetFloor}".`,
    );
    return null;
  }
  return {
    roomId: target.roomId,
    right: target.right,
    forward: target.forward,
    face: target.face,
    label: `Riding to ${floorLabel(marker.targetFloor)}`,
  };
}

export function elevatorDestinationFor(
  interaction: StationInteraction,
  hangarIndex?: number,
): ElevatorDestination | null {
  if (interaction.kind === 'prefab-elevator') return prefabElevatorDestination(interaction.marker);
  if (interaction.kind === 'hab-lift-down') return LOBBY_ARRIVAL_FROM_HAB;
  if (interaction.kind === 'hab-lift-up') return HAB_ARRIVAL_FROM_LOBBY;
  if (interaction.kind === 'hangar-lift-up') return lobbyArrivalFromHangar(interaction.hangar);
  if (interaction.kind === 'hangar-bank' && hangarIndex) {
    const hangar = getStationHangars().find((entry) => entry.index === hangarIndex);
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
 * zero velocity, grounded, nose facing the hangar mouth. Returns null when
 * the active station layout has no hangar pads.
 */
export function callShipToHangar(
  world: WorldState,
  planet: Planet,
  seed: number,
): HangarSpec | null {
  const hangars = getStationHangars();
  if (hangars.length === 0) return null;
  const hangar = hangars[Math.abs(seed) % hangars.length];
  const instance = getActiveShip(world);
  const frame = getStationFrame(planet);
  const restLocal = {
    ...hangar.padSurfaceLocal,
    up: hangar.padSurfaceLocal.up + getShipRestHeightMeters(),
  };
  instance.body = {
    forward: frame.forward,
    grounded: true,
    position: stationLocalToWorld(frame, restLocal),
    up: frame.up,
    velocity: vec3(0, 0, 0),
  };
  world.assignedHangar = hangar.index;
  return hangar;
}
