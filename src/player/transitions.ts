import { vec3 } from '../math/vec3';
import { integrateHoveringShip } from '../flight/flight_body';
import { placeCharacterOnSurface } from './character_controller';
import {
  ENTER_TRANSITION_SECONDS,
  EXIT_TRANSITION_SECONDS,
  LEAVE_PILOT_TRANSITION_SECONDS,
  MODE_ENTERING_SHIP,
  MODE_EXITING_SHIP,
  MODE_IN_SHIP,
  MODE_LEAVING_PILOT,
  MODE_ON_FOOT,
  MODE_ON_SHIP_DECK,
  MODE_RETURNING_PILOT,
  RETURN_PILOT_TRANSITION_SECONDS,
} from './modes';
import {
  createDeckCharacterState,
  getLeavePilotStandPose,
} from './ship_deck';
import {
  createTransitionPose,
  getPilotWheelAnchor,
  getShipExitPosition,
  getShipExitRampAnchor,
} from './ship_interaction';
import type { GameMode, Planet, Pose } from '../types';
import type { DeckCharacterState } from './ship_deck';
import type { TransitionType, WorldState } from './world_state';

function clamp01(value: number): number {
  return Math.max(0, Math.min(1, value));
}

function smoothstep01(value: number): number {
  const clamped = clamp01(value);
  return clamped * clamped * (3 - 2 * clamped);
}

function zeroVelocity() {
  return vec3(0, 0, 0);
}

function transitionAnimation(type: TransitionType): string {
  if (type === 'enter' || type === 'return-pilot') return 'Sitting_Enter';
  if (type === 'exit' || type === 'leave-pilot') return 'Sitting_Exit';
  return 'Idle_Loop';
}

function seatedCharacterFromPose(
  pose: Pose,
  animation: string,
  deckLocal: DeckCharacterState['deckLocal'] | undefined,
) {
  return {
    animation,
    deckLocal,
    forward: pose.forward,
    grounded: true as const,
    jumpPhase: 'grounded' as const,
    jumpPhaseTime: 0,
    position: pose.position,
    up: pose.up,
    velocity: zeroVelocity(),
  };
}

export interface TransitionContext {
  planet: Planet;
  seed: number;
  setControlsMode: (mode: GameMode | 'on-foot' | 'in-ship') => void;
}

export function beginEnterTransition(world: WorldState): void {
  const anchor = getPilotWheelAnchor(world.ship);
  world.mode = MODE_ENTERING_SHIP;
  world.prompt = '';
  world.transition = {
    duration: ENTER_TRANSITION_SECONDS,
    elapsed: 0,
    endPose: anchor,
    startPose: {
      forward: world.character.forward,
      position: world.character.position,
      up: world.character.up,
    },
    type: 'enter',
  };
}

export function beginExitTransition(world: WorldState, planet: Planet, seed: number): void {
  const ramp = getShipExitRampAnchor(world.ship);
  const exitPose = getShipExitPosition(world.ship, planet, seed);
  world.mode = MODE_EXITING_SHIP;
  world.prompt = '';
  world.transition = {
    duration: EXIT_TRANSITION_SECONDS,
    elapsed: 0,
    endPose: exitPose,
    startPose: ramp,
    type: 'exit',
  };
  world.character = seatedCharacterFromPose(ramp, 'Sitting_Exit', world.character.deckLocal);
}

export function beginLeavePilotTransition(world: WorldState): void {
  const wheel = getPilotWheelAnchor(world.ship);
  const stand = getLeavePilotStandPose(world.ship);
  world.ship = {
    ...world.ship,
    velocity: zeroVelocity(),
  };
  world.mode = MODE_LEAVING_PILOT;
  world.prompt = '';
  world.transition = {
    duration: LEAVE_PILOT_TRANSITION_SECONDS,
    elapsed: 0,
    endPose: stand,
    startPose: wheel,
    type: 'leave-pilot',
  };
  world.character = seatedCharacterFromPose(wheel, 'Sitting_Exit', world.character?.deckLocal);
}

export function beginReturnToPilotTransition(world: WorldState): void {
  const wheel = getPilotWheelAnchor(world.ship);
  const stand = getLeavePilotStandPose(world.ship);
  world.mode = MODE_RETURNING_PILOT;
  world.prompt = '';
  world.transition = {
    duration: RETURN_PILOT_TRANSITION_SECONDS,
    elapsed: 0,
    endPose: wheel,
    startPose: stand,
    type: 'return-pilot',
  };
  world.character = seatedCharacterFromPose(stand, 'Sitting_Enter', world.character.deckLocal);
}

export function updateTransition(world: WorldState, dt: number, ctx: TransitionContext): void {
  const transition = world.transition;
  if (!transition) return;

  if (
    transition.type === 'leave-pilot' ||
    transition.type === 'return-pilot' ||
    transition.type === 'exit'
  ) {
    world.ship = integrateHoveringShip(world.ship, dt, ctx.planet, ctx.seed);
  }

  transition.elapsed = Math.min(transition.duration, transition.elapsed + dt);
  const eased = smoothstep01(transition.elapsed / transition.duration);
  const pose = createTransitionPose(transition.startPose, transition.endPose, eased);
  world.character = seatedCharacterFromPose(
    pose,
    transitionAnimation(transition.type),
    world.character.deckLocal,
  );

  if (transition.elapsed < transition.duration) return;

  if (transition.type === 'enter') {
    world.mode = MODE_IN_SHIP;
    world.transition = null;
    ctx.setControlsMode(MODE_IN_SHIP);
    return;
  }

  if (transition.type === 'leave-pilot') {
    world.character = createDeckCharacterState(world.ship);
    world.mode = MODE_ON_SHIP_DECK;
    world.transition = null;
    ctx.setControlsMode(MODE_ON_FOOT);
    return;
  }

  if (transition.type === 'return-pilot') {
    world.mode = MODE_IN_SHIP;
    world.transition = null;
    ctx.setControlsMode(MODE_IN_SHIP);
    return;
  }

  world.character = placeCharacterOnSurface(
    transition.endPose.position,
    transition.endPose.forward,
  );
  world.ship = {
    ...world.ship,
    velocity: zeroVelocity(),
  };
  world.mode = MODE_ON_FOOT;
  world.transition = null;
  ctx.setControlsMode(MODE_ON_FOOT);
}
