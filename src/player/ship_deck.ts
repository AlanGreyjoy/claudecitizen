import { add, cross, dot, length, lerp, normalize, scale, sub, vec3 } from '../math/vec3';
import {
  EXIT_RAMP_INTERACT_DISTANCE_METERS,
  EXIT_RAMP_LOCAL,
  getShipRight,
  LEAVE_PILOT_STAND_LOCAL,
  PILOT_INTERACT_DISTANCE_METERS,
  PILOT_WHEEL_LOCAL,
  canExitShip,
} from './ship_interaction';
import type { CharacterInput, CharacterState, FlightBody, LocalOffset, Pose, Vec3 } from '../types';

export const DECK_STANDING_HEIGHT = PILOT_WHEEL_LOCAL.up;

/** Walkable upper deck bounds in ship-local right/forward meters. */
export const DECK_BOUNDS = {
  minRight: -2.4,
  maxRight: 5.5,
  minForward: -7.5,
  maxForward: 7.5,
} as const;

interface DeckLocal {
  right: number;
  forward: number;
}

interface DeckBounds {
  minRight: number;
  maxRight: number;
  minForward: number;
  maxForward: number;
}

export interface DeckCharacterState extends CharacterState {
  deckLocal: DeckLocal;
}

const WALK_SPEED_METERS_PER_SECOND = 4.2;
const SPRINT_SPEED_METERS_PER_SECOND = 7.9;
const TURN_SPEED = 10;

function clamp(value: number, min: number, max: number): number {
  return Math.max(min, Math.min(max, value));
}

function tangentize(vector: Vec3, up: Vec3): Vec3 {
  return sub(vector, scale(up, dot(vector, up)));
}

function deckMovementDirection(
  ship: FlightBody,
  moveX: number,
  moveY: number,
  cameraYawRadians: number,
): Vec3 {
  const up = ship.up;
  const right = getShipRight(ship);
  const deckForward = normalize(tangentize(ship.forward, up));
  const cameraForward = normalize(
    add(
      scale(right, Math.cos(cameraYawRadians)),
      scale(deckForward, Math.sin(cameraYawRadians)),
    ),
  );
  const cameraRight = normalize(cross(cameraForward, up));
  const desired = add(scale(cameraRight, moveX), scale(cameraForward, moveY));
  const tangentDesired = tangentize(desired, up);
  if (length(tangentDesired) < 1e-6) return vec3(0, 0, 0);
  return normalize(tangentDesired);
}

function rotateToward(currentForward: Vec3, desiredForward: Vec3, up: Vec3, dt: number): Vec3 {
  if (length(desiredForward) < 1e-6) return normalize(currentForward);
  const current = normalize(tangentize(currentForward, up));
  const desired = normalize(tangentize(desiredForward, up));
  const mixed = normalize(lerp(current, desired, clamp(dt * TURN_SPEED, 0, 1)));
  if (length(mixed) < 1e-6) return desired;
  return mixed;
}

function clampDeckLocal(local: DeckLocal): DeckLocal {
  const bounds: DeckBounds = DECK_BOUNDS;
  return {
    forward: clamp(local.forward, bounds.minForward, bounds.maxForward),
    right: clamp(local.right, bounds.minRight, bounds.maxRight),
  };
}

function localDistance(a: DeckLocal, b: Pick<LocalOffset, 'right' | 'forward'>): number {
  return Math.hypot(a.right - b.right, a.forward - b.forward);
}

export function getDeckWorldPose(ship: FlightBody, local: DeckLocal): Pose {
  const right = getShipRight(ship);
  const position = add(
    add(ship.position, scale(right, local.right)),
    add(scale(ship.up, DECK_STANDING_HEIGHT), scale(ship.forward, local.forward)),
  );
  return {
    forward: normalize(tangentize(ship.forward, ship.up)),
    position,
    up: ship.up,
  };
}

export function createDeckCharacterState(
  ship: FlightBody,
  local: DeckLocal = LEAVE_PILOT_STAND_LOCAL,
): DeckCharacterState {
  const clamped = clampDeckLocal(local);
  const pose = getDeckWorldPose(ship, clamped);
  return {
    animation: 'Idle_Loop',
    deckLocal: clamped,
    forward: pose.forward,
    grounded: true,
    jumpPhase: 'grounded',
    jumpPhaseTime: 0,
    position: pose.position,
    up: pose.up,
    velocity: vec3(0, 0, 0),
  };
}

export function getLeavePilotStandPose(ship: FlightBody): Pose {
  return getDeckWorldPose(ship, LEAVE_PILOT_STAND_LOCAL);
}

export function canReturnToPilot(deckLocal: DeckLocal): boolean {
  return localDistance(deckLocal, PILOT_WHEEL_LOCAL) <= PILOT_INTERACT_DISTANCE_METERS;
}

export function canExitFromDeck(
  ship: FlightBody,
  deckLocal: DeckLocal,
  surface?: Parameters<typeof canExitShip>[1],
): boolean {
  if (!canExitShip(ship, surface)) return false;
  return localDistance(deckLocal, EXIT_RAMP_LOCAL) <= EXIT_RAMP_INTERACT_DISTANCE_METERS;
}

export function updateCharacterOnDeck(
  state: DeckCharacterState,
  ship: FlightBody,
  input: CharacterInput,
  dt: number,
): DeckCharacterState {
  const moveX = input.moveX ?? 0;
  const moveY = input.moveY ?? 0;
  const wantsSprint = Boolean(input.sprint);
  const desiredDirection = deckMovementDirection(ship, moveX, moveY, input.cameraYawRadians ?? 0);
  const moveMagnitude = Math.min(1, Math.hypot(moveX, moveY));
  const moveSpeed =
    (wantsSprint ? SPRINT_SPEED_METERS_PER_SECOND : WALK_SPEED_METERS_PER_SECOND) * moveMagnitude;

  const right = getShipRight(ship);
  const up = ship.up;
  let deckLocal = { ...state.deckLocal };
  let forward = rotateToward(state.forward, desiredDirection, up, dt);

  if (moveMagnitude > 0.08) {
    const step = scale(desiredDirection, moveSpeed * dt);
    const deltaRight = dot(step, right);
    const deltaForward = dot(step, normalize(tangentize(ship.forward, up)));
    deckLocal = clampDeckLocal({
      right: deckLocal.right + deltaRight,
      forward: deckLocal.forward + deltaForward,
    });
  }

  const pose = getDeckWorldPose(ship, deckLocal);
  const velocity =
    dt > 0 ? scale(sub(pose.position, state.position), 1 / dt) : vec3(0, 0, 0);
  const isMoving = moveMagnitude > 0.08;
  const animation = isMoving && wantsSprint ? 'Sprint_Loop' : isMoving ? 'Walk_Loop' : 'Idle_Loop';

  if (length(forward) < 1e-6) {
    forward = normalize(tangentize(state.forward, up));
  } else {
    forward = normalize(tangentize(forward, up));
  }

  return {
    animation,
    deckLocal,
    forward,
    grounded: true,
    jumpPhase: 'grounded',
    jumpPhaseTime: 0,
    position: pose.position,
    up: pose.up,
    velocity,
  };
}
