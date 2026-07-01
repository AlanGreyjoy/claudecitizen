import type { CameraOrbit, CharacterState, FlightBody, GameMode, Planet, Pose } from '../types';
import type { DeckCharacterState } from './ship_deck';
import { MODE_ON_FOOT } from './modes';
import { createSpawnCharacter, createSpawnShip, initialCameraYaw } from './spawn';

export type TransitionType = 'enter' | 'exit' | 'leave-pilot' | 'return-pilot';

export interface WorldTransition {
  duration: number;
  elapsed: number;
  endPose: Pose;
  startPose: Pose;
  type: TransitionType;
}

export type WorldCharacter = CharacterState & Partial<Pick<DeckCharacterState, 'deckLocal'>>;

export interface WorldState {
  cameraOrbit: CameraOrbit;
  shipCameraZoom: number;
  character: WorldCharacter;
  mode: GameMode;
  prompt: string;
  ship: FlightBody;
  transition: WorldTransition | null;
}

export function createWorldState(planet: Planet, seed: number): WorldState {
  const ship = createSpawnShip(planet, seed);
  const character = createSpawnCharacter(planet, seed, ship);
  return {
    cameraOrbit: {
      pitchRadians: -0.35,
      yawRadians: initialCameraYaw(character),
      zoomDistance: 7.4,
    },
    shipCameraZoom: 1.0,
    character,
    mode: MODE_ON_FOOT,
    prompt: '',
    ship,
    transition: null,
  };
}
