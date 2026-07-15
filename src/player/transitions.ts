import { vec3 } from '../math/vec3';
import { integrateHoveringShip } from '../flight/flight_body';
import {
  MODE_ENTERING_SHIP,
  MODE_IN_SHIP,
  MODE_LEAVING_PILOT,
  MODE_ON_FOOT,
  MODE_ON_SHIP_DECK,
  SIT_TRANSITION_SECONDS,
  STAND_TRANSITION_SECONDS,
} from './modes';
import { createDeckCharacterState, getDeckSpawnFloorHint, getLeavePilotStandPose } from './ship_deck';
import { createTransitionPose, getPilotSeatAnchor, worldToShipLocal } from './ship_interaction';
import type { GameMode, Planet, Pose } from '../types';
import type { TransitionType, WorldState } from './world_state';
import { getActiveShip, getActiveShipBody } from './world_state';

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
  return type === 'sit' ? 'Sitting_Enter' : 'Sitting_Exit';
}

function transitionCharacterFromPose(pose: Pose, animation: string) {
  return {
    animation,
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
  /** Called when standing up lands back on the deck (Rapier teleport hook). */
  onDeckEntered?: (
    local: { right: number; forward: number },
    floorUp: number,
  ) => void;
}

/** Deck character near the chair sits down and takes the controls. */
export function beginSitTransition(world: WorldState): void {
  const ship = getActiveShipBody(world);
  const seat = getPilotSeatAnchor(ship);
  world.mode = MODE_ENTERING_SHIP;
  world.prompt = '';
  world.transition = {
    duration: SIT_TRANSITION_SECONDS,
    elapsed: 0,
    endPose: seat,
    startPose: {
      forward: world.character.forward,
      position: world.character.position,
      up: world.character.up,
    },
    type: 'sit',
  };
}

/** Pilot stands up out of the chair to the spot just behind it. */
export function beginStandTransition(world: WorldState): void {
  const instance = getActiveShip(world);
  const ship = instance.body;
  const seat = getPilotSeatAnchor(ship);
  const stand = getLeavePilotStandPose(ship);
  instance.body = {
    ...ship,
    velocity: zeroVelocity(),
  };
  world.mode = MODE_LEAVING_PILOT;
  world.prompt = '';
  world.transition = {
    duration: STAND_TRANSITION_SECONDS,
    elapsed: 0,
    endPose: stand,
    startPose: seat,
    type: 'stand',
  };
  world.character = transitionCharacterFromPose(seat, 'Sitting_Exit');
}

export function updateTransition(world: WorldState, dt: number, ctx: TransitionContext): void {
  const transition = world.transition;
  if (!transition) return;

  const instance = getActiveShip(world);
  instance.body = integrateHoveringShip(instance.body, dt, ctx.planet, ctx.seed, {
    maxSpeedMps: instance.spec.maxSpeedMps,
    throttleAccelMps2: instance.spec.throttleAccelMps2,
  });

  transition.elapsed = Math.min(transition.duration, transition.elapsed + dt);
  const eased = smoothstep01(transition.elapsed / transition.duration);
  const pose = createTransitionPose(transition.startPose, transition.endPose, eased);
  world.character = transitionCharacterFromPose(pose, transitionAnimation(transition.type));

  if (transition.elapsed < transition.duration) return;

  if (transition.type === 'sit') {
    world.mode = MODE_IN_SHIP;
    world.transition = null;
    ctx.setControlsMode(MODE_IN_SHIP);
    return;
  }

  const leave = getLeavePilotStandPose(instance.body);
  const leaveLocal = worldToShipLocal(instance.body, leave.position);
  const resumeLocal = {
    right: leaveLocal.right,
    forward: leaveLocal.forward,
  };
  const floorHint = getDeckSpawnFloorHint(resumeLocal);
  world.character = createDeckCharacterState(
    instance.body,
    resumeLocal,
    undefined,
    undefined,
    floorHint,
  );
  world.mode = MODE_ON_SHIP_DECK;
  world.transition = null;
  ctx.setControlsMode(MODE_ON_FOOT);
  ctx.onDeckEntered?.(resumeLocal, floorHint);
}
