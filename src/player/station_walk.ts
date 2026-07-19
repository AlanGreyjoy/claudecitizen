import { add, cross, dot, length, normalize, scale, sub, vec3 } from '../math/vec3';
import {
  animationFromState,
  CHARACTER_GROUND_OFFSET_METERS,
  JUMP_SPEED_METERS_PER_SECOND,
  rotateCharacterToward,
  SPRINT_SPEED_METERS_PER_SECOND,
  WALK_SPEED_METERS_PER_SECOND,
} from './character_controller';

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

function tangentize(vector: Vec3, up: Vec3): Vec3 {
  return sub(vector, scale(up, dot(vector, up)));
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
): StationCharacterState {
  const moveX = input.moveX ?? 0;
  const moveY = input.moveY ?? 0;
  const wantsSprint = Boolean(input.sprint);
  const desiredDirection = stationMovementDirection(frame, moveX, moveY, input.cameraYawRadians ?? 0);
  const moveMagnitude = Math.min(1, Math.hypot(moveX, moveY));
  const moveSpeed =
    (wantsSprint ? SPRINT_SPEED_METERS_PER_SECOND : WALK_SPEED_METERS_PER_SECOND) * moveMagnitude;

  const desiredFacing = desiredDirection;

  if (!physics) {
    // Physics is required for station locomotion once walk volumes are removed.
    return state;
  }

  const grounded = isStationPlayerGrounded(physics);
  let verticalVelocity = state.stationVerticalVelocity ?? 0;
  if (grounded && verticalVelocity <= 0) {
    verticalVelocity = 0;
  }
  if (input.jumpPressed && grounded) {
    verticalVelocity = JUMP_SPEED_METERS_PER_SECOND;
  }
  verticalVelocity -= gravityMetersPerSecond2 * dt;

  const velocity = add(
    scale(desiredDirection, moveSpeed),
    scale(frame.up, verticalVelocity),
  );
  moveStationPlayer(physics, frame, velocity, dt);
  stepStationPhysics(physics);

  const position = getStationPlayerPosition(physics, frame);
  const local = worldToStationLocal(frame, position);
  const forward = rotateCharacterToward(state.forward, desiredFacing, frame.up, dt);

  return {
    ...state,
    animation: animationFromState(
      { jumpPhase: 'grounded' },
      moveMagnitude > 0.08,
      wantsSprint,
      stanceId,
    ),
    forward: length(forward) < 1e-6 ? normalize(tangentize(state.forward, frame.up)) : normalize(tangentize(forward, frame.up)),
    grounded,
    jumpPhase: 'grounded',
    jumpPhaseTime: 0,
    position,
    stationLocal: { right: local.right, forward: local.forward },
    stationVerticalVelocity: verticalVelocity,
    up: frame.up,
    velocity,
  };
}
