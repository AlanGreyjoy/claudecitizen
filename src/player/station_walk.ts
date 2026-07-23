import { add, cross, length, normalize, scale, tangentize, vec3 } from '../math/vec3';
import { CHARACTER_GROUND_OFFSET_METERS } from './character_controller';
import {
  advanceJumpAnimationPhase,
  animationLayersFromState,
  resolveWalkAiming,
  resolveWalkFacing,
  resolveWalkInputIntent,
  shouldLockFacingToCamera,
} from './character_locomotion';

import type { StationPhysics } from '../physics/station_physics';
import {
  getStationPlayerPosition,
  isStationPlayerGrounded,
  moveStationPlayer,
  stepStationPhysics,
} from '../physics/station_physics';
import {
  getStationFrame,
  getStationRoom,
  getStationSpawn,
  stationDirToWorld,
  stationLocalToWorld,
  worldToStationLocal,
  type ElevatorDestination,
  type StationDir2,
  type StationFrame,
} from '../world/station';
import type { CharacterInput, CharacterState, Planet, Vec3 } from '../types';
import type { WeaponAnimStanceId } from './inventory/weapon_select';

export interface StationLocal2 {
  right: number;
  forward: number;
}

export interface StationCharacterState extends CharacterState {
  stationLocal: StationLocal2;
  /** Last room (never a doorway) that contained the character. */
  stationRoomId: string;
  /** Vertical velocity used by the Rapier kinematic character controller. */
  stationVerticalVelocity?: number;
}

function stationCameraForward(frame: StationFrame, cameraYawRadians: number): Vec3 {
  const yaw = -cameraYawRadians;
  return normalize(
    add(scale(frame.forward, Math.cos(yaw)), scale(frame.right, Math.sin(yaw))),
  );
}

function stationMovementDirection(
  frame: StationFrame,
  moveX: number,
  moveY: number,
  cameraYawRadians: number,
): Vec3 {
  const cameraForward = stationCameraForward(frame, cameraYawRadians);
  const cameraRight = normalize(cross(cameraForward, frame.up));
  const desired = add(scale(cameraRight, moveX), scale(cameraForward, moveY));
  const tangentDesired = tangentize(desired, frame.up);
  if (length(tangentDesired) < 1e-6) return vec3(0, 0, 0);
  return normalize(tangentDesired);
}

function stationWalkPose(
  frame: StationFrame,
  local: StationLocal2,
  floorUp: number,
): Vec3 {
  return stationLocalToWorld(frame, {
    right: local.right,
    up: floorUp + CHARACTER_GROUND_OFFSET_METERS,
    forward: local.forward,
  });
}

export function createStationCharacterAt(
  frame: StationFrame,
  roomId: string,
  local: StationLocal2,
  face: StationDir2,
  /** Override floor height when the room has no walk-volume (prefab hangars). */
  floorUpOverride?: number,
): StationCharacterState {
  const room = getStationRoom(roomId);
  const floorUp = floorUpOverride ?? room?.floorUp ?? 0;
  const position = stationWalkPose(frame, local, floorUp);
  return {
    animation: 'Idle_Loop',
    forward: stationDirToWorld(frame, face),
    grounded: true,
    jumpPhase: 'grounded',
    jumpPhaseTime: 0,
    position,
    stationLocal: { ...local },
    stationRoomId: roomId,
    up: frame.up,
    velocity: vec3(0, 0, 0),
  };
}

export function createStationSpawnCharacter(planet: Planet): StationCharacterState {
  const frame = getStationFrame(planet);
  const spawn = getStationSpawn();
  return createStationCharacterAt(
    frame,
    spawn.roomId,
    { right: spawn.right, forward: spawn.forward },
    spawn.face,
  );
}

export function characterAtElevatorDestination(
  frame: StationFrame,
  destination: ElevatorDestination,
): StationCharacterState {
  return createStationCharacterAt(
    frame,
    destination.roomId,
    { right: destination.right, forward: destination.forward },
    destination.face,
  );
}

/** Camera yaw that points the station orbit camera along a station-local direction. */
export function stationYawForDir(dir: StationDir2): number {
  return -Math.atan2(dir.right, dir.forward);
}

export function initialStationCameraYaw(): number {
  return stationYawForDir(getStationSpawn().face);
}

export function updateCharacterInStation(
  state: StationCharacterState,
  frame: StationFrame,
  input: CharacterInput,
  dt: number,
  gravityMetersPerSecond2: number,
  physics: StationPhysics | null,
  stanceId: WeaponAnimStanceId = 'unarmed',
  aiming = false,
): StationCharacterState {
  const intent = resolveWalkInputIntent(input);
  const poseAiming = resolveWalkAiming(aiming, intent);
  const cameraYawRadians = input.cameraYawRadians ?? 0;
  const desiredDirection = stationMovementDirection(frame, intent.moveX, intent.moveY, cameraYawRadians);
  const cameraForward = stationMovementDirection(frame, 0, 1, cameraYawRadians);

  if (!physics) {
    // Physics is required for station locomotion once walk volumes are removed.
    return state;
  }

  const groundedBefore = isStationPlayerGrounded(physics);
  let verticalVelocity = state.stationVerticalVelocity ?? 0;
  if (groundedBefore && verticalVelocity <= 0) {
    verticalVelocity = 0;
  }
  const startedJump = Boolean(intent.wantsJump && groundedBefore);
  if (startedJump) {
    verticalVelocity = intent.jumpSpeedMetersPerSecond;
  }
  verticalVelocity -= gravityMetersPerSecond2 * dt;

  const velocity = add(
    scale(desiredDirection, intent.moveSpeedMetersPerSecond),
    scale(frame.up, verticalVelocity),
  );
  moveStationPlayer(physics, frame, velocity, dt);
  stepStationPhysics(physics);

  const groundedAfter = isStationPlayerGrounded(physics);
  const airborne = startedJump || !groundedAfter || verticalVelocity > 0.15;
  const jump = advanceJumpAnimationPhase(state, dt, airborne, startedJump);
  const position = getStationPlayerPosition(physics, frame);
  const local = worldToStationLocal(frame, position);
  const forward = resolveWalkFacing(
    {
      currentForward: state.forward,
      moveDirection: desiredDirection,
      cameraForward,
      up: frame.up,
      aiming: poseAiming,
      lockFacingToCamera: shouldLockFacingToCamera(poseAiming),
    },
    dt,
  );

  const layers = animationLayersFromState({
    stanceId,
    aiming: poseAiming,
    isMoving: intent.isMoving,
    isCrouching: intent.isCrouching,
    gait: intent.gait,
    jumpPhase: jump.jumpPhase,
  });
  return {
    ...state,
    animation: layers.baseClip,
    upperBodyAnimation: layers.upperClip,
    forward,
    grounded: !airborne,
    jumpPhase: jump.jumpPhase,
    jumpPhaseTime: jump.jumpPhaseTime,
    position,
    stationLocal: { right: local.right, forward: local.forward },
    stationVerticalVelocity: verticalVelocity,
    up: frame.up,
    velocity,
  };
}
