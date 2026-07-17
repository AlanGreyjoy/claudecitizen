import { vec3 } from '../math/vec3';
import { flightOptionsFromSpec, integrateHoveringShip } from '../flight/flight_body';
import {
  GET_UP_FROM_BED_SECONDS,
  LIE_TRANSITION_SECONDS,
  MODE_ENTERING_BED,
  MODE_ENTERING_SHIP,
  MODE_IN_BED,
  MODE_IN_SHIP,
  MODE_LEAVING_BED,
  MODE_LEAVING_PILOT,
  MODE_ON_FOOT,
  MODE_ON_SHIP_DECK,
  SIT_TRANSITION_SECONDS,
  STAND_TRANSITION_SECONDS,
} from './modes';
import {
  createDeckCharacterState,
  getDeckSpawnFloorHint,
  getDeckWorldPose,
  getLeavePilotStandPose,
} from './ship_deck';
import {
  createTransitionPose,
  getBedAnchor,
  getBedSpec,
  getPilotSeatAnchor,
  worldToShipLocal,
} from './ship_interaction';
import type { FlightBody, GameMode, Planet, Pose } from '../types';
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
  if (type === 'sit' || type === 'lie') return 'Sitting_Enter';
  return 'Sitting_Exit';
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

function getBedStandPose(ship: FlightBody, bedId: string): Pose {
  const bed = getBedSpec(bedId);
  const stand = bed?.stand ?? { right: 0, forward: 0 };
  const pose = getDeckWorldPose(ship, stand);
  return pose;
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
  world.activeBedId = null;
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

/** Deck character near a bunk lies down (no flight). */
export function beginLieTransition(world: WorldState, bedId: string): void {
  const ship = getActiveShipBody(world);
  const bed = getBedAnchor(ship, bedId);
  world.mode = MODE_ENTERING_BED;
  world.prompt = '';
  world.activeBedId = bedId;
  world.transition = {
    duration: LIE_TRANSITION_SECONDS,
    elapsed: 0,
    endPose: bed,
    startPose: {
      forward: world.character.forward,
      position: world.character.position,
      up: world.character.up,
    },
    type: 'lie',
  };
}

/** Character gets up from the active bunk onto the stand spot. */
export function beginGetUpFromBedTransition(world: WorldState): void {
  const bedId = world.activeBedId;
  if (!bedId) return;
  const ship = getActiveShipBody(world);
  const bed = getBedAnchor(ship, bedId);
  const stand = getBedStandPose(ship, bedId);
  world.mode = MODE_LEAVING_BED;
  world.prompt = '';
  world.transition = {
    duration: GET_UP_FROM_BED_SECONDS,
    elapsed: 0,
    endPose: stand,
    startPose: bed,
    type: 'get-up',
  };
  world.character = transitionCharacterFromPose(bed, 'Sitting_Exit');
}

export function updateTransition(world: WorldState, dt: number, ctx: TransitionContext): void {
  const transition = world.transition;
  if (!transition) return;

  const instance = getActiveShip(world);
  instance.body = integrateHoveringShip(
    instance.body,
    dt,
    ctx.planet,
    ctx.seed,
    flightOptionsFromSpec(instance.spec),
  );

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

  if (transition.type === 'lie') {
    world.mode = MODE_IN_BED;
    world.transition = null;
    ctx.setControlsMode(MODE_IN_BED);
    return;
  }

  const leave =
    transition.type === 'get-up' && world.activeBedId
      ? getBedStandPose(instance.body, world.activeBedId)
      : getLeavePilotStandPose(instance.body);
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
  world.activeBedId = null;
  world.transition = null;
  ctx.setControlsMode(MODE_ON_FOOT);
  ctx.onDeckEntered?.(resumeLocal, floorHint);
}
