import {
  add,
  cross,
  dot,
  length,
  normalize,
  scale,
  sub,
  tangentize,
  vec3,
} from "../math/vec3";
import {
  ORBIT_PITCH_LIMIT,
  resolveCharacterCameraRig,
} from "./character_controller";
import {
  advanceJumpAnimationPhase,
  animationLayersFromState,
  resolveWalkAiming,
  resolveWalkFacing,
  resolveWalkInputIntent,
  shouldLockFacingToCamera,
} from "./character_locomotion";
import {
  sampleColliderGroundHeight,
  type ShipColliderRigState,
} from "../physics/colliders";
import type { ShipPhysics } from "../physics/ship_physics";
import {
  getShipPlayerLocal,
  getShipPlayerWorldPosition,
  isShipPlayerGrounded,
  moveShipPlayer,
  shipHasFloorBelow,
  stepShipPhysics,
} from "../physics/ship_physics";
import {
  getShipLayout,
  type ShipBedSpec,
  type ShipCameraBounds,
  type ShipSeatSpec,
} from "./ship_layout";
import {
  getShipRight,
  localOffsetToWorld,
} from "./ship_interaction";
import { resolveDeckCameraOrbit } from "../flight/flight_aim";
import type {
  CharacterInput,
  CharacterState,
  FlightBody,
  Pose,
  Vec3,
} from "../types";
import type { WeaponAnimStanceId } from "./inventory/weapon_select";

/**
 * Walkable ship interior via ship-local Rapier colliders (including the ramp).
 * Seats, doors, beds, and camera bounds still read from the active ship layout.
 */

export type ShipZoneId = string;

export interface DeckLocal {
  right: number;
  forward: number;
}

export interface DeckCharacterState extends CharacterState {
  deckLocal: DeckLocal;
  deckZone: ShipZoneId;
  /** Consecutive frames airborne with no deck collider below (collider-deck ships). */
  airborneOffDeckFrames?: number;
  /**
   * Frames remaining where tip / fell-off exits are ignored. Set on mount so a
   * brief Rapier miss at the ramp foot cannot instantly eject the player.
   */
  deckExitGraceFrames?: number;
  /** Vertical velocity for Rapier kinematic deck locomotion. */
  shipVerticalVelocity?: number;
}

/** Matches the offset baked into getDeckWorldPose. */
export const DECK_FLOOR_OFFSET_METERS = 0.02;
/** Max vertical step between collider floor samples when walking. */
const COLLIDER_STEP_HEIGHT_METERS = 0.55;
const COLLIDER_GROUND_PROBE_MARGIN = 0.75;
/** Fallback probe height when character ship-local up is unknown. */
const COLLIDER_GROUND_PROBE_FALLBACK_UP = 1.5;
/** Airborne frames with no ship collider below before leaving deck mode. */
const AIRBORNE_OFF_DECK_FRAMES = 6;
/** ~0.25s at 60fps — ignore deck exits right after boarding. */
const MOUNT_EXIT_GRACE_FRAMES = 15;

function probeColliderDeckFloor(
  local: DeckLocal,
  rig?: ShipColliderRigState,
  probeUp?: number,
): number | null {
  return sampleColliderGroundHeight(
    local.right,
    colliderProbeUp(probeUp),
    local.forward,
    getShipLayout().colliders,
    rig,
    probeUp === undefined
      ? undefined
      : probeUp + COLLIDER_STEP_HEIGHT_METERS,
  );
}

function deckSpawnCandidates(): DeckLocal[] {
  const layout = getShipLayout();
  const candidates: DeckLocal[] = [];
  if (layout.deckSpawn) candidates.push({ ...layout.deckSpawn });
  const pilot = layout.seats.find((seat) => seat.role === "pilot");
  if (pilot) {
    candidates.push({ right: pilot.stand.right, forward: pilot.stand.forward });
  }
  for (const bound of layout.cameraBounds) {
    if (bound.openToOutside) continue;
    candidates.push({
      right: (bound.minRight + bound.maxRight) / 2,
      forward: (bound.minForward + bound.maxForward) / 2,
    });
  }
  candidates.push({ right: 0, forward: 0 });
  return candidates;
}

function clamp(value: number, min: number, max: number): number {
  return Math.max(min, Math.min(max, value));
}

function colliderProbeUp(localUp?: number): number {
  return (localUp ?? COLLIDER_GROUND_PROBE_FALLBACK_UP) + COLLIDER_GROUND_PROBE_MARGIN;
}

export function shipFloorUpAt(
  local: DeckLocal,
  rig?: ShipColliderRigState,
  localUp?: number,
): number {
  const floor = colliderFloorAt(local, rig, localUp);
  if (floor !== null) return floor;
  // Mesh sample miss (threshold gaps, inverted tris): prefer authored
  // camera-bound floor over y=0, which drops the avatar through the deck.
  return findCameraBoundAt(local)?.floorUp ?? 0;
}

function cameraBoundContains(bound: ShipCameraBounds, local: DeckLocal): boolean {
  return (
    local.right >= bound.minRight &&
    local.right <= bound.maxRight &&
    local.forward >= bound.minForward &&
    local.forward <= bound.maxForward
  );
}

function findCameraBoundContaining(local: DeckLocal): ShipCameraBounds | null {
  for (const bound of getShipLayout().cameraBounds) {
    if (cameraBoundContains(bound, local)) return bound;
  }
  return null;
}

function findCameraBoundAt(local: DeckLocal): ShipCameraBounds | null {
  const hit = findCameraBoundContaining(local);
  if (hit) return hit;
  const bounds = getShipLayout().cameraBounds;
  let best: { bound: ShipCameraBounds; distance: number } | null = null;
  for (const bound of bounds) {
    const right = clamp(local.right, bound.minRight, bound.maxRight);
    const forward = clamp(local.forward, bound.minForward, bound.maxForward);
    const distance = Math.hypot(right - local.right, forward - local.forward);
    if (!best || distance < best.distance) {
      best = { bound, distance };
    }
  }
  return best?.bound ?? null;
}

export function isOnShipRampDeck(deckLocal: DeckLocal): boolean {
  const bound = findCameraBoundContaining(deckLocal);
  return bound?.id === "ramp" || bound?.openToOutside === true;
}

/**
 * True when feet are on an interior walk volume (cabin / deck / ramp), not the
 * outer hull roof. Roof tops often share right/forward with a cabin bound but
 * sit above that zone's ceiling.
 */
export function isShipInteriorWalkPose(
  local: DeckLocal,
  localUp: number,
  structureFloorUp: number | null,
): boolean {
  if (structureFloorUp === null) return false;
  if (
    localUp < structureFloorUp - 0.12 ||
    localUp > structureFloorUp + 0.85
  ) {
    return false;
  }
  const bounds = getShipLayout().cameraBounds;
  if (bounds.length === 0) return true;
  const bound = findCameraBoundContaining(local);
  if (!bound) return false;
  if (bound.openToOutside) return true;
  if (localUp > bound.ceilingUp - 0.2) return false;
  const floorTarget =
    bound.slopeMinUp === undefined
      ? bound.floorUp
      : // Approximate ramp/cabin floor along the bound's forward span.
        bound.slopeMinUp +
        ((local.forward - bound.minForward) /
          Math.max(1e-3, bound.maxForward - bound.minForward)) *
          (bound.floorUp - bound.slopeMinUp);
  return Math.abs(localUp - floorTarget) <= 0.9;
}

function colliderFloorAt(
  local: DeckLocal,
  rig: ShipColliderRigState | undefined,
  localUp?: number,
): number | null {
  return sampleColliderGroundHeight(
    local.right,
    colliderProbeUp(localUp),
    local.forward,
    getShipLayout().colliders,
    rig,
    localUp === undefined
      ? undefined
      : localUp + COLLIDER_STEP_HEIGHT_METERS,
  );
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

function localDistance(
  a: DeckLocal,
  b: { right: number; forward: number },
): number {
  return Math.hypot(a.right - b.right, a.forward - b.forward);
}

export function getDeckWorldPose(
  ship: FlightBody,
  local: DeckLocal,
  rig?: ShipColliderRigState,
  localUp?: number,
): Pose {
  const right = getShipRight(ship);
  const floorUp = shipFloorUpAt(local, rig, localUp) + DECK_FLOOR_OFFSET_METERS;
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
  local?: DeckLocal,
  zone?: ShipZoneId,
  colliderRig?: ShipColliderRigState,
  /** Explicit feet height (Rapier spawn); skips BVH "highest hit" probe. */
  floorUp?: number,
): DeckCharacterState {
  const spot = local ?? getDefaultDeckSpawnLocal(colliderRig);
  const floor =
    floorUp !== undefined
      ? floorUp
      : (probeColliderDeckFloor(spot, colliderRig) ??
        findCameraBoundAt(spot)?.floorUp ??
        null);
  const grounded = floor !== null;
  const pose =
    floor !== null
      ? (() => {
          const right = getShipRight(ship);
          const feet = floor + DECK_FLOOR_OFFSET_METERS;
          return {
            forward: normalize(tangentize(ship.forward, ship.up)),
            position: add(
              add(ship.position, scale(right, spot.right)),
              add(scale(ship.up, feet), scale(ship.forward, spot.forward)),
            ),
            up: ship.up,
          } satisfies Pose;
        })()
      : getDeckWorldPose(ship, spot, colliderRig, undefined);
  return {
    animation: "Idle_Loop",
    deckLocal: { ...spot },
    deckZone: zone ?? findZoneIdAt(spot),
    forward: pose.forward,
    grounded,
    jumpPhase: grounded ? "grounded" : "jump-loop",
    jumpPhaseTime: 0,
    position: pose.position,
    up: pose.up,
    velocity: vec3(0, 0, 0),
    airborneOffDeckFrames: 0,
    deckExitGraceFrames: MOUNT_EXIT_GRACE_FRAMES,
    shipVerticalVelocity: 0,
  };
}

/** Camera-bound id for UI labeling (cabin / ramp / cockpit). */
function findZoneIdAt(local: DeckLocal): ShipZoneId {
  return findCameraBoundAt(local)?.id ?? "deck";
}

/**
 * Safe initial deck spawn: authored deck spawn / pilot stand / camera-bound
 * center, preferring a spot that samples a collider floor.
 */
export function getDefaultDeckSpawnLocal(
  rig?: ShipColliderRigState,
): DeckLocal {
  const seen = new Set<string>();
  for (const candidate of deckSpawnCandidates()) {
    const key = `${candidate.right},${candidate.forward}`;
    if (seen.has(key)) continue;
    seen.add(key);
    if (!rig || probeColliderDeckFloor(candidate, rig) !== null) {
      return candidate;
    }
  }
  return deckSpawnCandidates()[0] ?? { right: 0, forward: 0 };
}

/** Authored camera-bound floor at a deck point (Rapier spawn hint). */
export function getDeckSpawnFloorHint(local: DeckLocal): number {
  return findCameraBoundAt(local)?.floorUp ?? 0;
}

/**
 * Preview Ship / sandbox spawn. Prefers a prefab empty named "Test Spawn"
 * (full ship-local pose). Floor is probed from that marker's height so the
 * hull roof does not steal the highest-hit sample.
 */
export function getSandboxDeckSpawn(rig?: ShipColliderRigState): {
  local: DeckLocal;
  floorUp: number;
} {
  const test = getShipLayout().testSpawn;
  if (test) {
    const local = { right: test.right, forward: test.forward };
    const floor =
      probeColliderDeckFloor(local, rig, test.up) ??
      test.up;
    return { local, floorUp: floor };
  }
  const local = getDefaultDeckSpawnLocal(rig);
  return {
    local,
    floorUp:
      probeColliderDeckFloor(local, rig) ?? getDeckSpawnFloorHint(local),
  };
}

export function getLeavePilotStandPose(ship: FlightBody): Pose {
  const pose = getDeckWorldPose(ship, getShipLayout().seatStand);
  // Standing up out of the chair, you face back into the cabin.
  return {
    ...pose,
    forward: normalize(tangentize(scale(ship.forward, -1), ship.up)),
  };
}

/** Prompt anchor sits just in front of the stand spot so you interact standing. */
const SEAT_INTERACT_FORWARD_OFFSET = 0.35;

function seatInteractPoint(seat: ShipSeatSpec): {
  right: number;
  forward: number;
} {
  const deltaRight = seat.seat.right - seat.stand.right;
  const deltaForward = seat.seat.forward - seat.stand.forward;
  const len = Math.hypot(deltaRight, deltaForward);
  if (len < 1e-4) {
    return {
      right: seat.stand.right,
      forward: seat.stand.forward + SEAT_INTERACT_FORWARD_OFFSET,
    };
  }
  const backset = Math.min(0.55, len * 0.35);
  return {
    right: seat.stand.right + (deltaRight / len) * backset,
    forward: seat.stand.forward + (deltaForward / len) * backset,
  };
}

/** Nearest authored seat within interact reach, or null. */
export function nearestSeat(deckLocal: DeckLocal): ShipSeatSpec | null {
  let best: { seat: ShipSeatSpec; distance: number } | null = null;
  for (const seat of getShipLayout().seats) {
    const anchor = seatInteractPoint(seat);
    const distance = localDistance(deckLocal, anchor);
    if (distance > seat.interactRadius) continue;
    if (!best || distance < best.distance) best = { seat, distance };
  }
  return best?.seat ?? null;
}

export function seatInteractPrompt(seat: ShipSeatSpec, interactLabel = "F"): string {
  switch (seat.role) {
    case "pilot":
      return `Press ${interactLabel} — take the seat`;
    case "copilot":
      return `Press ${interactLabel} — take the copilot seat`;
    case "turret":
      return `Press ${interactLabel} — man the turret`;
    default:
      return `Press ${interactLabel} — sit down`;
  }
}

/** True when near an authored pilot seat (not legacy fallback anchors). */
export function canReturnToPilot(deckLocal: DeckLocal): boolean {
  const nearby = nearestSeat(deckLocal);
  return nearby?.role === "pilot";
}
/** Camera aim for raycast ship-door triggers (world space). */
export interface DoorInteractAim {
  ship: FlightBody;
  cameraPos: Vec3;
  cameraForward: Vec3;
}

/** Build deck camera aim from orbit look (matches on-deck camera rig). */
export function resolveDoorInteractAim(
  ship: FlightBody,
  characterPosition: Vec3,
  yawRadians: number,
  pitchRadians: number,
  zoomDistance = 7.4,
): DoorInteractAim {
  const orbit = resolveDeckCameraOrbit(
    ship.forward,
    ship.up,
    yawRadians,
    pitchRadians,
    ORBIT_PITCH_LIMIT,
  );
  const rig = resolveCharacterCameraRig(orbit, zoomDistance);
  return {
    ship,
    cameraPos: add(characterPosition, rig.positionOffset),
    cameraForward: orbit.forward,
  };
}

/**
 * Score a raycast door like cockpit gaze: within maxDistance along the camera
 * ray and within aimRadius of the ray. Lower score is better.
 */
function scoreRaycastDoor(
  door: {
    interact: { right: number; up: number; forward: number };
    radius: number;
    aimRadius: number;
  },
  aim: DoorInteractAim,
): number | null {
  const worldPosition = localOffsetToWorld(aim.ship, door.interact);
  const forward = normalize(aim.cameraForward);
  if (length(forward) < 1e-6) return null;

  const toPoint = sub(worldPosition, aim.cameraPos);
  const distance = length(toPoint);
  if (distance > door.radius || distance < 1e-4) return null;

  const along = dot(toPoint, forward);
  if (along < 0.05) return null;

  const closestOnRay = scale(forward, along);
  const perpDistance = length(sub(toPoint, closestOnRay));
  if (perpDistance > door.aimRadius) return null;

  const angular = perpDistance / Math.max(along, 0.05);
  return angular * 10 + along * 0.05;
}

export function nearestDoor(
  deckLocal: DeckLocal,
  aim?: DoorInteractAim | null,
): { doorId: string } | null {
  let best: { doorId: string; score: number } | null = null;
  for (const door of getShipLayout().doors) {
    if (door.trigger === "raycast") {
      if (!aim) continue;
      const hit = scoreRaycastDoor(door, aim);
      if (hit == null) continue;
      if (!best || hit < best.score) best = { doorId: door.id, score: hit };
      continue;
    }
    const distance = localDistance(deckLocal, {
      right: door.interact.right,
      forward: door.interact.forward,
    });
    if (distance > door.radius) continue;
    if (!best || distance < best.score)
      best = { doorId: door.id, score: distance };
  }
  return best ? { doorId: best.doorId } : null;
}

/** Nearest authored bunk within interact reach, or null. */
export function nearestBed(
  deckLocal: DeckLocal,
  aim?: DoorInteractAim | null,
): ShipBedSpec | null {
  let best: { bed: ShipBedSpec; score: number } | null = null;
  for (const bed of getShipLayout().beds) {
    if (bed.trigger === "raycast") {
      if (!aim) continue;
      const hit = scoreRaycastDoor(
        {
          interact: bed.bed,
          radius: bed.radius,
          aimRadius: bed.aimRadius,
        },
        aim,
      );
      if (hit == null) continue;
      if (!best || hit < best.score) best = { bed, score: hit };
      continue;
    }
    const distance = localDistance(deckLocal, {
      right: bed.bed.right,
      forward: bed.bed.forward,
    });
    if (distance > bed.radius) continue;
    if (!best || distance < best.score) best = { bed, score: distance };
  }
  return best?.bed ?? null;
}

export function bedInteractPrompt(bed: ShipBedSpec, interactLabel = "F"): string {
  const label = bed.label?.trim();
  if (label && label.toLowerCase() !== "bed") {
    return `Press ${interactLabel} — lie down (${label})`;
  }
  return `Press ${interactLabel} — lie down`;
}

export function nearRampPanel(deckLocal: DeckLocal): boolean {
  return getShipLayout().rampInteracts.some(
    (panel) =>
      panel.placement === "deck" &&
      localDistance(deckLocal, panel) <= panel.radius,
  );
}

export interface DeckUpdateResult {
  state: DeckCharacterState;
  /**
   * Character has no ship/pad floor underfoot (true freefall eject).
   * Standing on the parked pad plane is still "aboard" ship Rapier.
   */
  dismounted: boolean;
  /** Alias of dismounted — kept for call-site compatibility. */
  fellOffDeck: boolean;
}

/**
 * Freefall eject when Rapier has no hull/ramp/pad underfoot.
 * Walk ramp ↔ pad continuously — pad contact is not an exit.
 */
function rapierDeckExitFlags(
  physics: ShipPhysics,
  grounded: boolean,
  airborneOffDeckFramesPrev: number,
  exitGraceFramesPrev: number,
): {
  leftDeck: boolean;
  airborneOffDeckFrames: number;
  deckExitGraceFrames: number;
} {
  const deckExitGraceFrames = Math.max(0, exitGraceFramesPrev - 1);
  if (deckExitGraceFrames > 0) {
    return {
      leftDeck: false,
      airborneOffDeckFrames: 0,
      deckExitGraceFrames,
    };
  }

  const hasFloor = shipHasFloorBelow(physics);
  const airborneOffDeckFrames =
    !grounded && !hasFloor ? airborneOffDeckFramesPrev + 1 : 0;
  return {
    leftDeck: airborneOffDeckFrames >= AIRBORNE_OFF_DECK_FRAMES,
    airborneOffDeckFrames,
    deckExitGraceFrames,
  };
}

export interface DeckLocomotionOptions {
  /**
   * Near-ship exterior on planet: Rapier has no pad floor, so treat planet
   * contact as grounded for jump / landing.
   */
  exteriorPlanetGrounded?: boolean;
  /** Skip freefall eject (parked exterior absorbs it via planet snap). */
  suppressDeckExit?: boolean;
  stanceId?: WeaponAnimStanceId;
  aiming?: boolean;
}

function resolveDeckVerticalMotion(
  state: DeckCharacterState,
  intent: ReturnType<typeof resolveWalkInputIntent>,
  groundedBefore: boolean,
  gravityMetersPerSecond2: number,
  dt: number,
): { startedJump: boolean; verticalVelocity: number } {
  let verticalVelocity = state.shipVerticalVelocity ?? 0;
  if (groundedBefore && verticalVelocity <= 0) verticalVelocity = 0;
  const startedJump = Boolean(intent.wantsJump && groundedBefore);
  if (startedJump) verticalVelocity = intent.jumpSpeedMetersPerSecond;
  verticalVelocity -= gravityMetersPerSecond2 * dt;
  return { startedJump, verticalVelocity };
}

function resolveDeckExitState(
  state: DeckCharacterState,
  physics: ShipPhysics,
  grounded: boolean,
  options?: DeckLocomotionOptions,
): ReturnType<typeof rapierDeckExitFlags> {
  if (options?.suppressDeckExit) {
    return {
      leftDeck: false,
      airborneOffDeckFrames: 0,
      deckExitGraceFrames: Math.max(0, (state.deckExitGraceFrames ?? 0) - 1),
    };
  }
  return rapierDeckExitFlags(
    physics,
    grounded,
    state.airborneOffDeckFrames ?? 0,
    state.deckExitGraceFrames ?? 0,
  );
}

function updateCharacterOnDeckRapier(
  state: DeckCharacterState,
  ship: FlightBody,
  input: CharacterInput,
  dt: number,
  gravityMetersPerSecond2: number,
  physics: ShipPhysics,
  options?: DeckLocomotionOptions,
): DeckUpdateResult {
  const stanceId = options?.stanceId ?? 'unarmed';
  const aiming = options?.aiming ?? false;
  const intent = resolveWalkInputIntent(input);
  const poseAiming = resolveWalkAiming(aiming, intent);
  const cameraYawRadians = input.cameraYawRadians ?? 0;
  const desiredDirection = deckMovementDirection(
    ship,
    intent.moveX,
    intent.moveY,
    cameraYawRadians,
  );
  const cameraForward = deckMovementDirection(ship, 0, 1, cameraYawRadians);

  const groundedBefore =
    isShipPlayerGrounded(physics) || Boolean(options?.exteriorPlanetGrounded);
  const { startedJump, verticalVelocity } = resolveDeckVerticalMotion(
    state,
    intent,
    groundedBefore,
    gravityMetersPerSecond2,
    dt,
  );

  const velocity = add(
    scale(desiredDirection, intent.moveSpeedMetersPerSecond),
    scale(ship.up, verticalVelocity),
  );
  moveShipPlayer(physics, ship, velocity, dt);
  stepShipPhysics(physics);

  const rapierGrounded = isShipPlayerGrounded(physics);
  const grounded =
    rapierGrounded ||
    (Boolean(options?.exteriorPlanetGrounded) && verticalVelocity <= 0.15);
  const localPose = getShipPlayerLocal(physics);
  const position = getShipPlayerWorldPosition(physics, ship);
  const deckLocal = { right: localPose.right, forward: localPose.forward };
  const bound = findCameraBoundAt(deckLocal);
  const forward = resolveWalkFacing(
    {
      currentForward: state.forward,
      moveDirection: desiredDirection,
      cameraForward,
      up: ship.up,
      aiming: poseAiming,
      lockFacingToCamera: shouldLockFacingToCamera(poseAiming),
    },
    dt,
  );
  const flags = resolveDeckExitState(state, physics, grounded, options);

  const airborne = startedJump || !grounded || verticalVelocity > 0.15;
  const jump = advanceJumpAnimationPhase(state, dt, airborne, startedJump);
  const layers = animationLayersFromState({
    stanceId,
    aiming: poseAiming,
    isMoving: intent.isMoving,
    isCrouching: intent.isCrouching,
    gait: intent.gait,
    jumpPhase: jump.jumpPhase,
  });
  return {
    dismounted: flags.leftDeck,
    fellOffDeck: flags.leftDeck,
    state: {
      animation: layers.baseClip,
      upperBodyAnimation: layers.upperClip,
      deckLocal,
      deckZone: bound?.id ?? state.deckZone,
      forward,
      grounded: !airborne,
      jumpPhase: jump.jumpPhase,
      jumpPhaseTime: jump.jumpPhaseTime,
      position,
      up: ship.up,
      velocity,
      airborneOffDeckFrames: flags.airborneOffDeckFrames,
      deckExitGraceFrames: flags.deckExitGraceFrames,
      shipVerticalVelocity: verticalVelocity,
    },
  };
}

export function updateCharacterOnDeck(
  state: DeckCharacterState,
  ship: FlightBody,
  input: CharacterInput,
  dt: number,
  gravityMetersPerSecond2: number,
  physics?: ShipPhysics | null,
  options?: DeckLocomotionOptions,
): DeckUpdateResult {
  if (!physics) {
    return {
      dismounted: false,
      fellOffDeck: false,
      state: { ...state, velocity: vec3(0, 0, 0) },
    };
  }
  return updateCharacterOnDeckRapier(
    state,
    ship,
    input,
    dt,
    gravityMetersPerSecond2,
    physics,
    options,
  );
}
