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
import type { DeckCharacterState } from './ship_deck';
import type { ShipRigState } from './ship_rig';
import type { StationElevatorRide } from './station_interaction';
import type { StationCharacterState } from './station_walk';
import { MODE_IN_STATION } from './modes';
import { createShipRigState } from './ship_rig';
import { createSpawnShip } from './spawn';
import { createStationSpawnCharacter, initialStationCameraYaw } from './station_walk';

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
  Partial<Pick<StationCharacterState, 'stationLocal' | 'stationRoomId'>>;

export interface WorldState {
  cameraOrbit: CameraOrbit;
  cameraView: CameraView;
  /** Piloting camera: seated cockpit eye (default) or external chase view. */
  shipCameraView: ShipCameraView;
  shipCameraZoom: number;
  character: WorldCharacter;
  mode: GameMode;
  prompt: string;
  ship: FlightBody;
  shipRig: ShipRigState;
  transition: WorldTransition | null;
  /** Hangar the ship was delivered to via the lobby terminal, if called. */
  assignedHangar: number | null;
  stationElevator: StationElevatorRide | null;
  /** 0..1 black overlay opacity used for elevator rides. */
  screenFade: number;
}

export function createWorldState(planet: Planet, seed: number): WorldState {
  const ship = createSpawnShip(planet, seed);
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
    ship,
    shipRig: createShipRigState({ gearDown: true, rampDown: false }),
    transition: null,
    assignedHangar: null,
    stationElevator: null,
    screenFade: 0,
  };
}
