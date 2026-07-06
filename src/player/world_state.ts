import type {
  CameraOrbit,
  CameraView,
  CharacterState,
  FlightBody,
  GameMode,
  Planet,
  Pose,
  ShipCameraView,
} from '../types';
import type { ShipInstance } from '../flight/ship_instance';
import {
  clearShipWorld,
  getShipInstance,
  registerShipInstance,
} from '../flight/ship_world';
import { createShipInstance } from '../flight/ship_instance';
import type { DeckCharacterState } from './ship_deck';
import type { ShipRigState } from './ship_rig';
import type { StationElevatorRide } from './station_interaction';
import type { StationCharacterState } from './station_walk';
import { MODE_IN_STATION } from './modes';
import { createSpawnShip } from './spawn';
import { createStationSpawnCharacter, initialStationCameraYaw } from './station_walk';
import {
  DEFAULT_SHIP_LAYOUT,
  getShipLayoutForPrefab,
} from './ship_layout';
import { DEFAULT_SHIP_PREFAB_ID } from '../world/ships';

export type TransitionType = 'sit' | 'stand';

export interface WorldTransition {
  duration: number;
  elapsed: number;
  endPose: Pose;
  startPose: Pose;
  type: TransitionType;
}

export type WorldCharacter = CharacterState &
  Partial<Pick<DeckCharacterState, 'deckLocal' | 'deckZone'>> &
  Partial<
    Pick<
      StationCharacterState,
      'stationLocal' | 'stationRoomId' | 'stationVerticalVelocity'
    >
  >;

export interface WorldState {
  cameraOrbit: CameraOrbit;
  cameraView: CameraView;
  /** Piloting camera: seated cockpit eye (default) or external chase view. */
  shipCameraView: ShipCameraView;
  shipCameraZoom: number;
  character: WorldCharacter;
  mode: GameMode;
  prompt: string;
  /** Id of the ship the player is piloting / boarding. */
  activeShipId: string;
  transition: WorldTransition | null;
  /** Hangar the ship was delivered to via the lobby terminal, if called. */
  assignedHangar: number | null;
  stationElevator: StationElevatorRide | null;
  /** 0..1 black overlay opacity used for elevator rides. */
  screenFade: number;
}

export const PLAYER_SHIP_INSTANCE_ID = 'player-ship-primary';

export function getActiveShip(world: WorldState): ShipInstance {
  const ship = getShipInstance(world.activeShipId);
  if (!ship) {
    throw new Error(`Missing ship instance "${world.activeShipId}".`);
  }
  return ship;
}

export function getActiveShipBody(world: WorldState): FlightBody {
  return getActiveShip(world).body;
}

export function getActiveShipRig(world: WorldState): ShipRigState {
  return getActiveShip(world).rig;
}

export function createWorldState(planet: Planet, seed: number): WorldState {
  clearShipWorld();
  const prefabId = DEFAULT_SHIP_PREFAB_ID;
  const layout = getShipLayoutForPrefab(prefabId) ?? DEFAULT_SHIP_LAYOUT;
  const body = createSpawnShip(planet, seed);
  const instance = createShipInstance({
    id: PLAYER_SHIP_INSTANCE_ID,
    prefabId,
    layout,
    body,
    instanceId: 'planet:asteron',
    rig: { gearDown: true, rampDown: false },
  });
  registerShipInstance(instance);

  const character = createStationSpawnCharacter(planet);
  return {
    cameraOrbit: {
      pitchRadians: -0.12,
      yawRadians: initialStationCameraYaw(),
      zoomDistance: 5.2,
    },
    cameraView: 'first-person',
    shipCameraView: 'cockpit',
    shipCameraZoom: 1.0,
    character,
    mode: MODE_IN_STATION,
    prompt: '',
    activeShipId: instance.id,
    transition: null,
    assignedHangar: null,
    stationElevator: null,
    screenFade: 0,
  };
}
