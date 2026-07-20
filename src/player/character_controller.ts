import {
  add,
  cross,
  dot,
  length,
  lerp,
  normalize,
  rotateAroundAxis,
  scale,
  sub,
  vec3,
} from "../math/vec3";
import {
  eastVector,
  radialUp,
  surfacePointFromPosition,
} from "../world/coordinates";
import { sampleFootPlanetSurface } from "../world/planet_surface";
import type {
  CharacterInput,
  CharacterState,
  JumpPhase,
  Planet,
  Vec3,
} from "../types";
import {
  getDefaultAnimationController,
  locomotionFromGameplay,
  resolveControllerClip,
} from "./animation";
import type { WeaponAnimStanceId } from "./inventory/weapon_select";

export const CHARACTER_GROUND_OFFSET_METERS = 0.05;
export const WALK_SPEED_METERS_PER_SECOND = 2.0;
export const SPRINT_SPEED_METERS_PER_SECOND = 5.3;
const AIR_CONTROL = 0.18;
/** ~1.4 m apex at Earth gravity — snappy, not moon-bounce. */
export const JUMP_SPEED_METERS_PER_SECOND = 5.2;
/** Extra pull on the way down so hang time doesn't feel floaty. */
const FALL_GRAVITY_MULTIPLIER = 1.7;
const JUMP_START_SECONDS = 0.18;
const JUMP_LAND_SECONDS = 0.18;
const TURN_SPEED_RADIANS_PER_SECOND = 10;
export const ORBIT_PITCH_LIMIT = 1.15;
export const FIRST_PERSON_PITCH_LIMIT = 1.5;
export const CHARACTER_EYE_HEIGHT_METERS = 1.62;
const CAMERA_REF_ZOOM = 7.4;
const CLOSE_ZOOM_SHOULDER_BONUS_METERS = 0.18;

interface TangentBasis {
  east: Vec3;
  north: Vec3;
  up: Vec3;
}

export interface OrbitCamera {
  forward: Vec3;
  pitchRadians: number;
  right: Vec3;
  up: Vec3;
}

export interface CharacterCameraRig {
  positionOffset: Vec3;
  targetOffset: Vec3;
}

function clamp(value: number, min: number, max: number): number {
  return Math.max(min, Math.min(max, value));
}

function tangentBasis(position: Vec3): TangentBasis {
  const up = radialUp(position);
  const east = eastVector(position);
  const north = normalize(cross(up, east));
  return { east, north, up };
}

function tangentize(vector: Vec3, up: Vec3): Vec3 {
  return sub(vector, scale(up, dot(vector, up)));
}

function forwardFromYaw(position: Vec3, yawRadians: number): Vec3 {
  const { east, north } = tangentBasis(position);
  return normalize(
    add(scale(east, Math.cos(yawRadians)), scale(north, Math.sin(yawRadians))),
  );
}

function movementDirection(
  position: Vec3,
  moveX: number,
  moveY: number,
  cameraYawRadians: number,
): Vec3 {
  const up = radialUp(position);
  const cameraForward = forwardFromYaw(position, cameraYawRadians);
  const cameraRight = normalize(cross(cameraForward, up));
  const desired = add(scale(cameraRight, moveX), scale(cameraForward, moveY));
  const tangentDesired = tangentize(desired, up);
  if (length(tangentDesired) < 1e-6) return vec3(0, 0, 0);
  return normalize(tangentDesired);
}

const UAL_FALLBACK: Record<string, string> = {
  jump_start: "Jump_Start",
  jump_loop: "Jump_Loop",
  jump_land: "Jump_Land",
  sprint: "Sprint_Loop",
  walk: "Walk_Loop",
  idle: "Idle_Loop",
};

export function animationFromState(
  state: Pick<CharacterState, "jumpPhase">,
  isMoving: boolean,
  isSprinting: boolean,
  stanceId: WeaponAnimStanceId = "unarmed",
): string {
  const locomotion = locomotionFromGameplay(state.jumpPhase, isMoving, isSprinting);
  const clip = resolveControllerClip(getDefaultAnimationController(), locomotion, stanceId);
  return clip ?? UAL_FALLBACK[locomotion] ?? "Idle_Loop";
}

/** Turn a character across the tangent plane without stalling at a 180-degree reversal. */
export function rotateCharacterToward(
  currentForward: Vec3,
  desiredForward: Vec3,
  up: Vec3,
  dt: number,
): Vec3 {
  const tangentDesired = tangentize(desiredForward, up);
  if (length(tangentDesired) < 1e-6) {
    return normalize(tangentize(currentForward, up));
  }

  const desired = normalize(tangentDesired);
  const tangentCurrent = tangentize(currentForward, up);
  if (length(tangentCurrent) < 1e-6) return desired;

  const current = normalize(tangentCurrent);
  const turnAxis = normalize(up);
  const signedAngle = Math.atan2(
    dot(turnAxis, cross(current, desired)),
    clamp(dot(current, desired), -1, 1),
  );
  const maxTurn = Math.max(0, dt) * TURN_SPEED_RADIANS_PER_SECOND;
  const turn = clamp(signedAngle, -maxTurn, maxTurn);
  return normalize(rotateAroundAxis(current, turnAxis, turn));
}

function clampToGround(position: Vec3, surfaceRadiusMeters: number): Vec3 {
  return surfacePointFromPosition(
    position,
    surfaceRadiusMeters + CHARACTER_GROUND_OFFSET_METERS,
  );
}

function updateGroundJumpState(
  state: Pick<CharacterState, "jumpPhase" | "jumpPhaseTime">,
  dt: number,
): JumpPhase {
  if (state.jumpPhase !== "jump-land") return state.jumpPhase;
  return state.jumpPhaseTime + dt >= JUMP_LAND_SECONDS
    ? "grounded"
    : "jump-land";
}

export interface JumpAnimationPhaseState {
  jumpPhase: JumpPhase;
  jumpPhaseTime: number;
}

/** Advance animation-only jump phases for Rapier-controlled walkers. */
export function advanceJumpAnimationPhase(
  state: Pick<CharacterState, "jumpPhase" | "jumpPhaseTime">,
  dt: number,
  airborne: boolean,
  startedJump: boolean,
): JumpAnimationPhaseState {
  if (startedJump) return { jumpPhase: "jump-start", jumpPhaseTime: 0 };

  const elapsed = state.jumpPhase === "grounded"
    ? 0
    : state.jumpPhaseTime + Math.max(0, dt);
  if (airborne) {
    if (state.jumpPhase === "jump-start" && elapsed < JUMP_START_SECONDS) {
      return { jumpPhase: "jump-start", jumpPhaseTime: elapsed };
    }
    return {
      jumpPhase: "jump-loop",
      jumpPhaseTime: state.jumpPhase === "jump-loop" ? elapsed : 0,
    };
  }

  if (state.jumpPhase === "jump-start" || state.jumpPhase === "jump-loop") {
    return { jumpPhase: "jump-land", jumpPhaseTime: 0 };
  }
  if (state.jumpPhase === "jump-land" && elapsed < JUMP_LAND_SECONDS) {
    return { jumpPhase: "jump-land", jumpPhaseTime: elapsed };
  }
  return { jumpPhase: "grounded", jumpPhaseTime: 0 };
}

export interface LocomotionMotionInput {
  wantsJump: boolean;
  wantsSprint: boolean;
  isMoving: boolean;
  desiredDirection: Vec3;
  moveSpeed: number;
}

export interface LocomotionIntegrationResult {
  animation: string;
  grounded: boolean;
  jumpPhase: JumpPhase;
  jumpPhaseTime: number;
  position: Vec3;
  up: Vec3;
  velocity: Vec3;
}

export interface LocomotionCallbacks {
  onGroundedStep: () => { position: Vec3; up: Vec3 };
  tryLand: (position: Vec3) => { position: Vec3; up: Vec3 } | null;
  /** When set, recomputes up each airborne frame (planet radial gravity). */
  sampleAirborneUp?: (position: Vec3) => Vec3;
}

/** Shared grounded/airborne jump integration for planet, deck, and station walkers. */
export function integrateCharacterLocomotion(
  state: Pick<
    CharacterState,
    "position" | "velocity" | "grounded" | "jumpPhase" | "jumpPhaseTime"
  >,
  motion: LocomotionMotionInput,
  dt: number,
  initialUp: Vec3,
  gravityMetersPerSecond2: number,
  callbacks: LocomotionCallbacks,
  stanceId: WeaponAnimStanceId = "unarmed",
): LocomotionIntegrationResult {
  let position = state.position;
  let velocity = state.velocity;
  let grounded = state.grounded;
  let jumpPhase = state.jumpPhase;
  let jumpPhaseTime =
    state.jumpPhase === "grounded" ? 0 : state.jumpPhaseTime + dt;
  let up = initialUp;

  if (grounded) {
    const stepped = callbacks.onGroundedStep();
    position = stepped.position;
    up = stepped.up;
    velocity =
      dt > 0 ? scale(sub(position, state.position), 1 / dt) : vec3(0, 0, 0);

    if (motion.wantsJump) {
      grounded = false;
      jumpPhase = "jump-start";
      jumpPhaseTime = 0;
      velocity = add(velocity, scale(up, JUMP_SPEED_METERS_PER_SECOND));
    } else {
      jumpPhase = updateGroundJumpState(state, dt);
      if (jumpPhase === "grounded") jumpPhaseTime = 0;
    }
  }

  if (!grounded) {
    const tangentVelocity = tangentize(velocity, up);
    const desiredVelocity = scale(motion.desiredDirection, motion.moveSpeed);
    const blendedTangent = lerp(
      tangentVelocity,
      desiredVelocity,
      clamp(dt * AIR_CONTROL * 8, 0, 1),
    );
    const verticalSpeed = dot(velocity, up);
    const gravityScale = verticalSpeed < 0 ? FALL_GRAVITY_MULTIPLIER : 1;
    const verticalVelocity =
      verticalSpeed - gravityMetersPerSecond2 * gravityScale * dt;
    velocity = add(blendedTangent, scale(up, verticalVelocity));
    position = add(position, scale(velocity, dt));

    const landed = callbacks.tryLand(position);
    if (landed) {
      position = landed.position;
      up = landed.up;
      velocity = tangentize(velocity, up);
      grounded = true;
      jumpPhase = "jump-land";
      jumpPhaseTime = 0;
    } else {
      if (callbacks.sampleAirborneUp) up = callbacks.sampleAirborneUp(position);
      if (jumpPhase === "jump-start" && jumpPhaseTime >= JUMP_START_SECONDS) {
        jumpPhase = "jump-loop";
        jumpPhaseTime = 0;
      } else if (jumpPhase === "grounded") {
        jumpPhase = "jump-loop";
        jumpPhaseTime = 0;
      }
    }
  }

  const animation = animationFromState(
    { jumpPhase },
    motion.isMoving,
    motion.wantsSprint,
    stanceId,
  );

  return {
    animation,
    grounded,
    jumpPhase,
    jumpPhaseTime,
    position,
    up,
    velocity,
  };
}

export function resolveOrbitCamera(
  position: Vec3,
  yawRadians: number,
  pitchRadians: number,
  pitchLimit: number = ORBIT_PITCH_LIMIT,
): OrbitCamera {
  const up = radialUp(position);
  const planarForward = forwardFromYaw(position, yawRadians);
  const right = normalize(cross(planarForward, up));
  const clampedPitch = clamp(pitchRadians, -pitchLimit, pitchLimit);
  const forward = normalize(
    rotateAroundAxis(planarForward, right, clampedPitch),
  );
  return {
    forward,
    pitchRadians: clampedPitch,
    right,
    up,
  };
}

export function resolveCharacterCameraRig(
  orbit: OrbitCamera,
  zoomDistance: number,
): CharacterCameraRig {
  const zoomRatio = clamp(zoomDistance / CAMERA_REF_ZOOM, 0.22, 1.35);
  const shoulderUp = 3.2 * zoomRatio;
  const closeZoom01 = 1 - clamp(zoomDistance / CAMERA_REF_ZOOM, 0, 1);
  const shoulderRight =
    0.75 * Math.sqrt(zoomRatio) + CLOSE_ZOOM_SHOULDER_BONUS_METERS * closeZoom01;
  const targetUp = 1.75;

  return {
    positionOffset: add(
      add(
        scale(orbit.forward, -zoomDistance),
        scale(orbit.right, shoulderRight),
      ),
      scale(orbit.up, shoulderUp),
    ),
    targetOffset: add(
      scale(orbit.right, shoulderRight),
      scale(orbit.up, targetUp),
    ),
  };
}

export function createCharacterState(
  position: Vec3,
  forward: Vec3 = eastVector(position),
): CharacterState {
  const up = radialUp(position);
  const tangentForward = normalize(tangentize(forward, up));
  return {
    animation: "Idle_Loop",
    forward: tangentForward,
    grounded: true,
    jumpPhase: "grounded",
    jumpPhaseTime: 0,
    position,
    up,
    velocity: vec3(0, 0, 0),
  };
}

export function placeCharacterOnSurface(
  position: Vec3,
  forward: Vec3 = eastVector(position),
): CharacterState {
  const up = radialUp(position);
  const tangentForward = normalize(tangentize(forward, up));
  return {
    animation: "Idle_Loop",
    forward: tangentForward,
    grounded: true,
    jumpPhase: "grounded",
    jumpPhaseTime: 0,
    position,
    up,
    velocity: vec3(0, 0, 0),
  };
}

export interface PlanetPropCollision {
  filterMovement: (from: Vec3, desiredDelta: Vec3, up: Vec3) => Vec3;
  /** Distance along -up from feet to a prop top, or null. */
  probeSupport: (from: Vec3, up: Vec3) => number | null;
}

export function updateCharacterState(
  state: CharacterState,
  input: CharacterInput,
  dt: number,
  planet: Planet,
  seed: number,
  propCollision?: PlanetPropCollision | null,
  stanceId: WeaponAnimStanceId = "unarmed",
): CharacterState {
  const moveX = input.moveX ?? 0;
  const moveY = input.moveY ?? 0;
  const wantsSprint = Boolean(input.sprint);
  const wantsJump = Boolean(input.jumpPressed);
  const desiredDirection = movementDirection(
    state.position,
    moveX,
    moveY,
    input.cameraYawRadians ?? 0,
  );
  const moveMagnitude = Math.min(1, Math.hypot(moveX, moveY));
  const moveSpeed =
    (wantsSprint
      ? SPRINT_SPEED_METERS_PER_SECOND
      : WALK_SPEED_METERS_PER_SECOND) * moveMagnitude;

  const isMoving = moveMagnitude > 0.08;
  const gravity = planet.gravityMetersPerSecond2 ?? 9.8;
  const motion = integrateCharacterLocomotion(
    state,
    { wantsJump, wantsSprint, isMoving, desiredDirection, moveSpeed },
    dt,
    radialUp(state.position),
    gravity,
    {
      onGroundedStep: () => {
        const step = scale(desiredDirection, moveSpeed * dt);
        const up0 = radialUp(state.position);
        const nextPosition = propCollision
          ? propCollision.filterMovement(state.position, step, up0)
          : add(state.position, step);
        const nextSurface = sampleFootPlanetSurface(planet, seed, nextPosition);
        const terrainPos = clampToGround(
          nextPosition,
          nextSurface.surfaceRadiusMeters,
        );
        const up = radialUp(terrainPos);
        const support = propCollision?.probeSupport(terrainPos, up) ?? null;
        // Prefer prop tops that sit above the terrain skin.
        if (support !== null && support > -0.05 && support < 1.25) {
          const propPos = add(terrainPos, scale(up, -support));
          if (length(propPos) > length(terrainPos) + 0.02) {
            return { position: propPos, up: radialUp(propPos) };
          }
        }
        return { position: terrainPos, up };
      },
      tryLand: (candidate) => {
        const nextSurface = sampleFootPlanetSurface(planet, seed, candidate);
        const up = radialUp(candidate);
        const support = propCollision?.probeSupport(candidate, up) ?? null;
        if (support !== null && support < 0.85) {
          const propped = add(candidate, scale(up, -support));
          const terrainRadius =
            nextSurface.surfaceRadiusMeters + CHARACTER_GROUND_OFFSET_METERS;
          if (length(propped) >= terrainRadius - 0.05) {
            return { position: propped, up: radialUp(propped) };
          }
        }
        const landingRadius =
          nextSurface.surfaceRadiusMeters + CHARACTER_GROUND_OFFSET_METERS;
        if (length(candidate) > landingRadius) return null;
        const snapped = clampToGround(
          candidate,
          nextSurface.surfaceRadiusMeters,
        );
        return { position: snapped, up: radialUp(snapped) };
      },
      sampleAirborneUp: radialUp,
    },
    stanceId,
  );

  const desiredFacing = desiredDirection;
  let forward = rotateCharacterToward(state.forward, desiredFacing, motion.up, dt);

  if (length(forward) < 1e-6) {
    forward = normalize(tangentize(state.forward, motion.up));
  } else {
    forward = normalize(tangentize(forward, motion.up));
  }

  return {
    animation: motion.animation,
    forward,
    grounded: motion.grounded,
    jumpPhase: motion.jumpPhase,
    jumpPhaseTime: motion.jumpPhaseTime,
    position: motion.position,
    up: motion.up,
    velocity: motion.velocity,
  };
}
