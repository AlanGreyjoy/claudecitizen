import { add, cross, dot, length, lerp, normalize, scale, sub, vec3 } from '../math/vec3';
import { getShipRight, PILOT_SEAT_LOCAL, SEAT_STAND_LOCAL } from './ship_interaction';
import type { CharacterInput, CharacterState, FlightBody, Pose, Vec3 } from '../types';

/**
 * Walkable Phobos Starhopper interior, measured from the model rig:
 * a main cabin, the cockpit behind sliding doors at forward ~2.7 (with a
 * raised floor), and the rear boarding ramp that slopes from the cabin floor
 * down to the ground plane at the tail. Coordinates are ship-local
 * right/forward meters; floor height is ship-local up.
 */

export const SHIP_FLOOR_UP = -1.42;
export const SHIP_COCKPIT_FLOOR_UP = -0.97;

export type ShipZoneId = 'cabin' | 'cockpit' | 'cockpit-door' | 'ramp';

export interface ShipWalkZone {
  id: ShipZoneId;
  minRight: number;
  maxRight: number;
  minForward: number;
  maxForward: number;
}

export const SHIP_WALK_ZONES: ShipWalkZone[] = [
  { id: 'cabin', minRight: -2.35, maxRight: 2.35, minForward: -6.6, maxForward: 2.62 },
  { id: 'cockpit', minRight: -1.65, maxRight: 1.65, minForward: 2.83, maxForward: 7.1 },
  { id: 'cockpit-door', minRight: -0.85, maxRight: 0.85, minForward: 2.42, maxForward: 3.03 },
  { id: 'ramp', minRight: -1.05, maxRight: 1.05, minForward: -8.55, maxForward: -6.4 },
];

/** Interior ceiling above the cabin/cockpit floor, for camera containment. */
export const SHIP_INTERIOR_CEILING_UP = 1.66;

/** Ramp slope: cabin floor at its top, ground plane at its tail end. */
const RAMP_TOP_FORWARD = -6.4;
const RAMP_TIP_FORWARD = -8.55;
const RAMP_TIP_UP = -3.14;

/** Step up through the cockpit doorway onto the raised cockpit floor. */
const COCKPIT_STEP_START_FORWARD = 2.42;
const COCKPIT_STEP_END_FORWARD = 3.03;

/** Walking past this ship-local forward on the ramp steps off onto the ground. */
export const RAMP_DISMOUNT_FORWARD = -8.5;

export interface DeckLocal {
  right: number;
  forward: number;
}

export interface DeckCharacterState extends CharacterState {
  deckLocal: DeckLocal;
  deckZone: ShipZoneId;
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

export function shipFloorUpAt(forward: number): number {
  if (forward >= COCKPIT_STEP_END_FORWARD) return SHIP_COCKPIT_FLOOR_UP;
  if (forward >= COCKPIT_STEP_START_FORWARD) {
    const t =
      (forward - COCKPIT_STEP_START_FORWARD) /
      (COCKPIT_STEP_END_FORWARD - COCKPIT_STEP_START_FORWARD);
    return SHIP_FLOOR_UP + (SHIP_COCKPIT_FLOOR_UP - SHIP_FLOOR_UP) * t;
  }
  if (forward >= RAMP_TOP_FORWARD) return SHIP_FLOOR_UP;
  const t = clamp((forward - RAMP_TOP_FORWARD) / (RAMP_TIP_FORWARD - RAMP_TOP_FORWARD), 0, 1);
  return SHIP_FLOOR_UP + (RAMP_TIP_UP - SHIP_FLOOR_UP) * t;
}

export interface ShipWalkGates {
  /** Ramp lowered and the ship parked, so the ramp is a walkable surface. */
  rampWalkable: boolean;
  cockpitOpen: boolean;
}

function zoneActive(zone: ShipWalkZone, gates: ShipWalkGates): boolean {
  if (zone.id === 'ramp') return gates.rampWalkable;
  if (zone.id === 'cockpit-door') return gates.cockpitOpen;
  return true;
}

function zoneContains(zone: ShipWalkZone, local: DeckLocal): boolean {
  return (
    local.right >= zone.minRight &&
    local.right <= zone.maxRight &&
    local.forward >= zone.minForward &&
    local.forward <= zone.maxForward
  );
}

/** Real rooms win over the door passage so deckZone tracks a camera-safe box. */
function findZone(local: DeckLocal, gates: ShipWalkGates): ShipWalkZone | null {
  let passage: ShipWalkZone | null = null;
  for (const zone of SHIP_WALK_ZONES) {
    if (!zoneActive(zone, gates)) continue;
    if (!zoneContains(zone, local)) continue;
    if (zone.id === 'cockpit-door') {
      passage = zone;
      continue;
    }
    return zone;
  }
  return passage;
}

interface ResolvedDeckStep {
  local: DeckLocal;
  zone: ShipZoneId;
}

function resolveDeckStep(
  state: DeckCharacterState,
  deltaRight: number,
  deltaForward: number,
  gates: ShipWalkGates,
): ResolvedDeckStep {
  const candidates: DeckLocal[] = [
    { right: state.deckLocal.right + deltaRight, forward: state.deckLocal.forward + deltaForward },
    { right: state.deckLocal.right + deltaRight, forward: state.deckLocal.forward },
    { right: state.deckLocal.right, forward: state.deckLocal.forward + deltaForward },
  ];
  for (const candidate of candidates) {
    const zone = findZone(candidate, gates);
    if (zone) {
      return {
        local: candidate,
        zone: zone.id === 'cockpit-door' ? state.deckZone : zone.id,
      };
    }
  }
  return { local: state.deckLocal, zone: state.deckZone };
}

function deckCameraForward(ship: FlightBody, cameraYawRadians: number): Vec3 {
  const up = ship.up;
  const right = getShipRight(ship);
  const deckForward = normalize(tangentize(ship.forward, up));
  const deckYawRadians = -cameraYawRadians;
  return normalize(
    add(
      scale(deckForward, Math.cos(deckYawRadians)),
      scale(right, Math.sin(deckYawRadians)),
    ),
  );
}

function deckMovementDirection(
  ship: FlightBody,
  moveX: number,
  moveY: number,
  cameraYawRadians: number,
): Vec3 {
  const up = ship.up;
  const cameraForward = deckCameraForward(ship, cameraYawRadians);
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

function localDistance(a: DeckLocal, b: { right: number; forward: number }): number {
  return Math.hypot(a.right - b.right, a.forward - b.forward);
}

export function getDeckWorldPose(ship: FlightBody, local: DeckLocal): Pose {
  const right = getShipRight(ship);
  const floorUp = shipFloorUpAt(local.forward) + 0.02;
  const position = add(
    add(ship.position, scale(right, local.right)),
    add(scale(ship.up, floorUp), scale(ship.forward, local.forward)),
  );
  return {
    forward: normalize(tangentize(ship.forward, ship.up)),
    position,
    up: ship.up,
  };
}

export function createDeckCharacterState(
  ship: FlightBody,
  local: DeckLocal = SEAT_STAND_LOCAL,
  zone: ShipZoneId = 'cockpit',
): DeckCharacterState {
  const pose = getDeckWorldPose(ship, local);
  return {
    animation: 'Idle_Loop',
    deckLocal: { ...local },
    deckZone: zone,
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
  const pose = getDeckWorldPose(ship, SEAT_STAND_LOCAL);
  // Standing up out of the chair, you face back into the cabin.
  return { ...pose, forward: normalize(tangentize(scale(ship.forward, -1), ship.up)) };
}

/** Interaction spots inside the ship. */
export const CHAIR_INTERACT_LOCAL = { right: 0, forward: 5.55 };
export const CHAIR_INTERACT_DISTANCE_METERS = 1.45;
export const COCKPIT_DOOR_INTERACT_LOCAL = { right: 0, forward: 2.72 };
export const COCKPIT_DOOR_INTERACT_DISTANCE_METERS = 1.55;
export const RAMP_PANEL_INTERACT_LOCAL = { right: 0, forward: -5.7 };
export const RAMP_PANEL_INTERACT_DISTANCE_METERS = 1.7;

export function nearChair(deckLocal: DeckLocal): boolean {
  return localDistance(deckLocal, CHAIR_INTERACT_LOCAL) <= CHAIR_INTERACT_DISTANCE_METERS;
}

export function nearCockpitDoor(deckLocal: DeckLocal): boolean {
  return (
    localDistance(deckLocal, COCKPIT_DOOR_INTERACT_LOCAL) <= COCKPIT_DOOR_INTERACT_DISTANCE_METERS
  );
}

export function nearRampPanel(deckLocal: DeckLocal): boolean {
  return localDistance(deckLocal, RAMP_PANEL_INTERACT_LOCAL) <= RAMP_PANEL_INTERACT_DISTANCE_METERS;
}

export function canReturnToPilot(deckLocal: DeckLocal): boolean {
  return nearChair(deckLocal) && deckLocal.forward > PILOT_SEAT_LOCAL.forward - 2.4;
}

export interface DeckUpdateResult {
  state: DeckCharacterState;
  /** Set when the character walked off the bottom of the lowered ramp. */
  dismounted: boolean;
}

export function updateCharacterOnDeck(
  state: DeckCharacterState,
  ship: FlightBody,
  gates: ShipWalkGates,
  input: CharacterInput,
  dt: number,
): DeckUpdateResult {
  const moveX = input.moveX ?? 0;
  const moveY = input.moveY ?? 0;
  const wantsSprint = Boolean(input.sprint);
  const desiredDirection = deckMovementDirection(ship, moveX, moveY, input.cameraYawRadians ?? 0);
  const moveMagnitude = Math.min(1, Math.hypot(moveX, moveY));
  const moveSpeed =
    (wantsSprint ? SPRINT_SPEED_METERS_PER_SECOND : WALK_SPEED_METERS_PER_SECOND) * moveMagnitude;

  const right = getShipRight(ship);
  const up = ship.up;
  const desiredFacing = input.faceCameraYaw
    ? deckCameraForward(ship, input.cameraYawRadians ?? 0)
    : desiredDirection;
  let forward = rotateToward(state.forward, desiredFacing, up, dt);

  let resolved: ResolvedDeckStep = { local: state.deckLocal, zone: state.deckZone };
  if (moveMagnitude > 0.08) {
    const step = scale(desiredDirection, moveSpeed * dt);
    resolved = resolveDeckStep(
      state,
      dot(step, right),
      dot(step, normalize(tangentize(ship.forward, up))),
      gates,
    );
  }

  const dismounted =
    resolved.zone === 'ramp' && resolved.local.forward <= RAMP_DISMOUNT_FORWARD;

  const pose = getDeckWorldPose(ship, resolved.local);
  const velocity = dt > 0 ? scale(sub(pose.position, state.position), 1 / dt) : vec3(0, 0, 0);
  const isMoving = moveMagnitude > 0.08;
  const animation = isMoving && wantsSprint ? 'Sprint_Loop' : isMoving ? 'Walk_Loop' : 'Idle_Loop';

  if (length(forward) < 1e-6) {
    forward = normalize(tangentize(state.forward, up));
  } else {
    forward = normalize(tangentize(forward, up));
  }

  return {
    dismounted,
    state: {
      animation,
      deckLocal: resolved.local,
      deckZone: resolved.zone,
      forward,
      grounded: true,
      jumpPhase: 'grounded',
      jumpPhaseTime: 0,
      position: pose.position,
      up: pose.up,
      velocity,
    },
  };
}
