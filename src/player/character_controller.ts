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
  tangentize,
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
  animationLayersFromState,
  JUMP_LAND_SECONDS,
  JUMP_START_SECONDS,
  resolveWalkFacing,
  resolveWalkAiming,
  resolveWalkInputIntent,
  shouldLockFacingToCamera,
} from "./character_locomotion";
import type { WeaponAnimStanceId } from "./inventory/weapon_select";
import { getCharacterSettings } from "./character_settings";

export const CHARACTER_GROUND_OFFSET_METERS = 0.05;
const AIR_CONTROL = 0.18;
/** Extra pull on the way down so hang time doesn't feel floaty. */
const FALL_GRAVITY_MULTIPLIER = 1.7;
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

export interface LocomotionMotionInput {
  wantsJump: boolean;
  wantsSprint: boolean;
  isMoving: boolean;
  desiredDirection: Vec3;
  moveSpeed: number;
}

export interface LocomotionIntegrationResult {
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

type LocomotionState = Pick<
  CharacterState,
  "position" | "velocity" | "grounded" | "jumpPhase" | "jumpPhaseTime"
>;

function integrateGroundedLocomotion(
  state: LocomotionState,
  motion: LocomotionMotionInput,
  dt: number,
  callbacks: LocomotionCallbacks,
): Pick<LocomotionIntegrationResult, "grounded" | "jumpPhase" | "jumpPhaseTime" | "position" | "up" | "velocity"> {
  const stepped = callbacks.onGroundedStep();
  const position = stepped.position;
  const nextUp = stepped.up;
  const velocity =
    dt > 0 ? scale(sub(position, state.position), 1 / dt) : vec3(0, 0, 0);

  if (motion.wantsJump) {
    return {
      grounded: false,
      jumpPhase: "jump-start",
      jumpPhaseTime: 0,
      position,
      up: nextUp,
      velocity: add(velocity, scale(nextUp, getCharacterSettings().jumpSpeedMetersPerSecond)),
    };
  }

  const jumpPhase = updateGroundJumpState(state, dt);
  return {
    grounded: true,
    jumpPhase,
    jumpPhaseTime: jumpPhase === "grounded" ? 0 : state.jumpPhaseTime + dt,
    position,
    up: nextUp,
    velocity,
  };
}

interface AirborneLocomotionInput {
  callbacks: LocomotionCallbacks;
  dt: number;
  gravityMetersPerSecond2: number;
  jumpPhase: JumpPhase;
  jumpPhaseTime: number;
  motion: LocomotionMotionInput;
  position: Vec3;
  up: Vec3;
  velocity: Vec3;
}

function integrateAirborneLocomotion(
  input: AirborneLocomotionInput,
): Pick<LocomotionIntegrationResult, "grounded" | "jumpPhase" | "jumpPhaseTime" | "position" | "up" | "velocity"> {
  const {
    motion,
    dt,
    position,
    up,
    velocity,
    jumpPhase,
    jumpPhaseTime,
    gravityMetersPerSecond2,
    callbacks,
  } = input;
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
  const nextVelocity = add(blendedTangent, scale(up, verticalVelocity));
  const nextPosition = add(position, scale(nextVelocity, dt));

  const landed = callbacks.tryLand(nextPosition);
  if (landed) {
    return {
      grounded: true,
      jumpPhase: "jump-land",
      jumpPhaseTime: 0,
      position: landed.position,
      up: landed.up,
      velocity: tangentize(nextVelocity, landed.up),
    };
  }

  let nextUp = up;
  if (callbacks.sampleAirborneUp) nextUp = callbacks.sampleAirborneUp(nextPosition);

  let nextJumpPhase = jumpPhase;
  let nextJumpPhaseTime = jumpPhaseTime;
  if (jumpPhase === "jump-start" && jumpPhaseTime >= JUMP_START_SECONDS) {
    nextJumpPhase = "jump-loop";
    nextJumpPhaseTime = 0;
  } else if (jumpPhase === "grounded") {
    nextJumpPhase = "jump-loop";
    nextJumpPhaseTime = 0;
  }

  return {
    grounded: false,
    jumpPhase: nextJumpPhase,
    jumpPhaseTime: nextJumpPhaseTime,
    position: nextPosition,
    up: nextUp,
    velocity: nextVelocity,
  };
}

/** Shared grounded/airborne jump integration for planet, deck, and station walkers. */
export function integrateCharacterLocomotion(
  state: LocomotionState,
  motion: LocomotionMotionInput,
  dt: number,
  initialUp: Vec3,
  gravityMetersPerSecond2: number,
  callbacks: LocomotionCallbacks,
): LocomotionIntegrationResult {
  const jumpPhaseTime =
    state.jumpPhase === "grounded" ? 0 : state.jumpPhaseTime + dt;

  if (state.grounded) {
    return integrateGroundedLocomotion(state, motion, dt, callbacks);
  }

  return integrateAirborneLocomotion({
    motion,
    dt,
    position: state.position,
    up: initialUp,
    velocity: state.velocity,
    jumpPhase: state.jumpPhase,
    jumpPhaseTime,
    gravityMetersPerSecond2,
    callbacks,
  });
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
  aiming = false,
): CharacterState {
  const intent = resolveWalkInputIntent(input);
  const poseAiming = resolveWalkAiming(aiming, intent);
  const cameraYawRadians = input.cameraYawRadians ?? 0;
  const desiredDirection = movementDirection(
    state.position,
    intent.moveX,
    intent.moveY,
    cameraYawRadians,
  );
  const cameraForward = movementDirection(state.position, 0, 1, cameraYawRadians);

  const gravity = planet.gravityMetersPerSecond2 ?? 9.8;
  const motion = integrateCharacterLocomotion(
    state,
    {
      wantsJump: intent.wantsJump,
      wantsSprint: intent.isSprinting,
      isMoving: intent.isMoving,
      desiredDirection,
      moveSpeed: intent.moveSpeedMetersPerSecond,
    },
    dt,
    radialUp(state.position),
    gravity,
    {
      onGroundedStep: () => {
        const step = scale(desiredDirection, intent.moveSpeedMetersPerSecond * dt);
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
  );

  const forward = resolveWalkFacing(
    {
      currentForward: state.forward,
      moveDirection: desiredDirection,
      cameraForward,
      up: motion.up,
      aiming: poseAiming,
      lockFacingToCamera: shouldLockFacingToCamera(poseAiming),
    },
    dt,
  );

  const layers = animationLayersFromState({
    stanceId,
    aiming: poseAiming,
    isMoving: intent.isMoving,
    gait: intent.gait,
    jumpPhase: motion.jumpPhase,
  });
  return {
    animation: layers.baseClip,
    upperBodyAnimation: layers.upperClip,
    forward,
    grounded: motion.grounded,
    jumpPhase: motion.jumpPhase,
    jumpPhaseTime: motion.jumpPhaseTime,
    position: motion.position,
    up: motion.up,
    velocity: motion.velocity,
  };
}
