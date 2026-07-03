import { add, cross, dot, length, lerp, normalize, rotateAroundAxis, scale, sub, vec3 } from '../math/vec3';
import { eastVector, radialUp, surfacePointFromPosition } from '../world/coordinates';
import { sampleFootPlanetSurface } from '../world/planet_surface';
import type { CharacterInput, CharacterState, JumpPhase, Planet, Vec3 } from '../types';

export const CHARACTER_GROUND_OFFSET_METERS = 0.05;
const WALK_SPEED_METERS_PER_SECOND = 4.2;
const SPRINT_SPEED_METERS_PER_SECOND = 7.9;
const AIR_CONTROL = 0.18;
const JUMP_SPEED_METERS_PER_SECOND = 7.8;
const JUMP_START_SECONDS = 0.18;
const JUMP_LAND_SECONDS = 0.18;
const TURN_SPEED = 10;
export const ORBIT_PITCH_LIMIT = 1.15;
export const FIRST_PERSON_PITCH_LIMIT = 1.5;
export const FIRST_PERSON_EYE_HEIGHT_METERS = 1.62;
// Nudges the eye ahead of the neck so shoulders stay behind the near plane.
const FIRST_PERSON_FORWARD_OFFSET_METERS = 0.22;
const FIRST_PERSON_LOOK_DISTANCE_METERS = 10;
const CAMERA_REF_ZOOM = 7.4;

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
  return normalize(add(scale(east, Math.cos(yawRadians)), scale(north, Math.sin(yawRadians))));
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

function animationFromState(
  state: Pick<CharacterState, 'jumpPhase'>,
  isMoving: boolean,
  isSprinting: boolean,
): string {
  if (state.jumpPhase === 'jump-start') return 'Jump_Start';
  if (state.jumpPhase === 'jump-loop') return 'Jump_Loop';
  if (state.jumpPhase === 'jump-land') return 'Jump_Land';
  if (isMoving && isSprinting) return 'Sprint_Loop';
  if (isMoving) return 'Walk_Loop';
  return 'Idle_Loop';
}

function rotateToward(currentForward: Vec3, desiredForward: Vec3, up: Vec3, dt: number): Vec3 {
  if (length(desiredForward) < 1e-6) return normalize(currentForward);
  const current = normalize(tangentize(currentForward, up));
  const desired = normalize(tangentize(desiredForward, up));
  const mixed = normalize(lerp(current, desired, clamp(dt * TURN_SPEED, 0, 1)));
  if (length(mixed) < 1e-6) return desired;
  return mixed;
}

function clampToGround(position: Vec3, surfaceRadiusMeters: number): Vec3 {
  return surfacePointFromPosition(position, surfaceRadiusMeters + CHARACTER_GROUND_OFFSET_METERS);
}

function updateGroundJumpState(state: CharacterState, dt: number): JumpPhase {
  if (state.jumpPhase !== 'jump-land') return state.jumpPhase;
  return state.jumpPhaseTime + dt >= JUMP_LAND_SECONDS ? 'grounded' : 'jump-land';
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
  const forward = normalize(rotateAroundAxis(planarForward, right, clampedPitch));
  return {
    forward,
    pitchRadians: clampedPitch,
    right,
    up,
  };
}

export function resolveCharacterCameraRig(orbit: OrbitCamera, zoomDistance: number): CharacterCameraRig {
  const zoomRatio = clamp(zoomDistance / CAMERA_REF_ZOOM, 0.22, 1.35);
  const shoulderUp = 3.2 * zoomRatio;
  const shoulderRight = 0.75 * Math.sqrt(zoomRatio);
  const targetUp = 1.75;

  return {
    positionOffset: add(
      add(scale(orbit.forward, -zoomDistance), scale(orbit.right, shoulderRight)),
      scale(orbit.up, shoulderUp),
    ),
    targetOffset: add(scale(orbit.right, shoulderRight), scale(orbit.up, targetUp)),
  };
}

export function resolveFirstPersonCameraRig(orbit: OrbitCamera): CharacterCameraRig {
  // Planar (yaw-only) forward, so pitching the view does not slide the eye.
  const planarForward = normalize(cross(orbit.up, orbit.right));
  const eyeOffset = add(
    scale(orbit.up, FIRST_PERSON_EYE_HEIGHT_METERS),
    scale(planarForward, FIRST_PERSON_FORWARD_OFFSET_METERS),
  );
  return {
    positionOffset: eyeOffset,
    targetOffset: add(eyeOffset, scale(orbit.forward, FIRST_PERSON_LOOK_DISTANCE_METERS)),
  };
}

export function createCharacterState(
  position: Vec3,
  forward: Vec3 = eastVector(position),
): CharacterState {
  const up = radialUp(position);
  const tangentForward = normalize(tangentize(forward, up));
  return {
    animation: 'Idle_Loop',
    forward: tangentForward,
    grounded: true,
    jumpPhase: 'grounded',
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
    animation: 'Idle_Loop',
    forward: tangentForward,
    grounded: true,
    jumpPhase: 'grounded',
    jumpPhaseTime: 0,
    position,
    up,
    velocity: vec3(0, 0, 0),
  };
}

export function updateCharacterState(
  state: CharacterState,
  input: CharacterInput,
  dt: number,
  planet: Planet,
  seed: number,
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
    (wantsSprint ? SPRINT_SPEED_METERS_PER_SECOND : WALK_SPEED_METERS_PER_SECOND) * moveMagnitude;

  let position = state.position;
  let velocity = state.velocity;
  let grounded = state.grounded;
  let jumpPhase = state.jumpPhase;
  let jumpPhaseTime = state.jumpPhase === 'grounded' ? 0 : state.jumpPhaseTime + dt;
  let up = radialUp(position);
  const desiredFacing = input.faceCameraYaw
    ? forwardFromYaw(position, input.cameraYawRadians ?? 0)
    : desiredDirection;
  let forward = rotateToward(state.forward, desiredFacing, up, dt);

  if (grounded) {
    const step = scale(desiredDirection, moveSpeed * dt);
    position = add(position, step);
      const nextSurface = sampleFootPlanetSurface(planet, seed, position);
    position = clampToGround(position, nextSurface.surfaceRadiusMeters);
    up = radialUp(position);
    velocity = dt > 0 ? scale(sub(position, state.position), 1 / dt) : vec3(0, 0, 0);

    if (wantsJump) {
      grounded = false;
      jumpPhase = 'jump-start';
      jumpPhaseTime = 0;
      velocity = add(velocity, scale(up, JUMP_SPEED_METERS_PER_SECOND));
    } else {
      jumpPhase = updateGroundJumpState(state, dt);
      if (jumpPhase === 'grounded') jumpPhaseTime = 0;
    }
  }

  if (!grounded) {
    const tangentVelocity = tangentize(velocity, up);
    const desiredVelocity = scale(desiredDirection, moveSpeed);
    const blendedTangent = lerp(tangentVelocity, desiredVelocity, clamp(dt * AIR_CONTROL * 8, 0, 1));
    const verticalVelocity = dot(velocity, up) - planet.gravityMetersPerSecond2! * dt;
    velocity = add(blendedTangent, scale(up, verticalVelocity));
    position = add(position, scale(velocity, dt));
      const nextSurface = sampleFootPlanetSurface(planet, seed, position);
    const landingRadius = nextSurface.surfaceRadiusMeters + CHARACTER_GROUND_OFFSET_METERS;
    const radialDistance = length(position);
    if (radialDistance <= landingRadius) {
      position = clampToGround(position, nextSurface.surfaceRadiusMeters);
      up = radialUp(position);
      const residualTangent = tangentize(velocity, up);
      velocity = residualTangent;
      grounded = true;
      jumpPhase = 'jump-land';
      jumpPhaseTime = 0;
    } else {
      up = radialUp(position);
      if (jumpPhase === 'jump-start' && jumpPhaseTime >= JUMP_START_SECONDS) {
        jumpPhase = 'jump-loop';
        jumpPhaseTime = 0;
      } else if (jumpPhase === 'grounded') {
        jumpPhase = 'jump-loop';
        jumpPhaseTime = 0;
      }
    }
  }

  if (length(forward) < 1e-6) {
    forward = normalize(tangentize(state.forward, up));
  } else {
    forward = normalize(tangentize(forward, up));
  }

  const isMoving = moveMagnitude > 0.08;
  const animation = animationFromState({ jumpPhase }, isMoving, wantsSprint);

  return {
    animation,
    forward,
    grounded,
    jumpPhase,
    jumpPhaseTime,
    position,
    up,
    velocity,
  };
}
