import { add, cross, dot, length, lerp, normalize, scale, sub, vec3 } from '../math/vec3';
import {
  CHARACTER_GROUND_OFFSET_METERS,
  integrateCharacterLocomotion,
  SPRINT_SPEED_METERS_PER_SECOND,
  WALK_SPEED_METERS_PER_SECOND,
} from './character_controller';
import {
  getStationFrame,
  getStationRoom,
  getStationSpawn,
  getStationWalkRects,
  stationDirToWorld,
  stationLocalToWorld,
  worldToStationLocal,
  type ElevatorDestination,
  type StationDir2,
  type StationFrame,
  type StationWalkRect,
} from '../world/station';
import type { CharacterInput, CharacterState, Planet, Vec3 } from '../types';

export interface StationLocal2 {
  right: number;
  forward: number;
}

export interface StationCharacterState extends CharacterState {
  stationLocal: StationLocal2;
  /** Last room (never a doorway) that contained the character. */
  stationRoomId: string;
}

const TURN_SPEED = 10;

function clamp(value: number, min: number, max: number): number {
  return Math.max(min, Math.min(max, value));
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

function rotateToward(currentForward: Vec3, desiredForward: Vec3, up: Vec3, dt: number): Vec3 {
  if (length(desiredForward) < 1e-6) return normalize(currentForward);
  const current = normalize(tangentize(currentForward, up));
  const desired = normalize(tangentize(desiredForward, up));
  const mixed = normalize(lerp(current, desired, clamp(dt * TURN_SPEED, 0, 1)));
  if (length(mixed) < 1e-6) return desired;
  return mixed;
}

function rectContains(rect: StationWalkRect, local: StationLocal2): boolean {
  return (
    local.right >= rect.minRight &&
    local.right <= rect.maxRight &&
    local.forward >= rect.minForward &&
    local.forward <= rect.maxForward
  );
}

/** Rooms win over doorways so stationRoomId tracks the last real room. */
function findContainingRect(rects: StationWalkRect[], local: StationLocal2): StationWalkRect | null {
  let doorwayHit: StationWalkRect | null = null;
  for (const rect of rects) {
    if (!rectContains(rect, local)) continue;
    if (rect.kind === 'room') return rect;
    doorwayHit = doorwayHit ?? rect;
  }
  return doorwayHit;
}

interface ResolvedStep {
  local: StationLocal2;
  roomId: string;
  floorUp: number;
}

function resolveStationStep(
  rects: StationWalkRect[],
  currentLocal: StationLocal2,
  currentRoomId: string,
  deltaRight: number,
  deltaForward: number,
  fallbackFloorUp: number,
): ResolvedStep {
  const candidates: StationLocal2[] = [
    { right: currentLocal.right + deltaRight, forward: currentLocal.forward + deltaForward },
    { right: currentLocal.right + deltaRight, forward: currentLocal.forward },
    { right: currentLocal.right, forward: currentLocal.forward + deltaForward },
  ];
  for (const candidate of candidates) {
    const rect = findContainingRect(rects, candidate);
    if (rect) {
      return {
        local: candidate,
        roomId: rect.kind === 'room' ? rect.id : currentRoomId,
        floorUp: rect.floorUp,
      };
    }
  }
  return { local: currentLocal, roomId: currentRoomId, floorUp: fallbackFloorUp };
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
): StationCharacterState {
  const room = getStationRoom(roomId);
  const floorUp = room?.floorUp ?? 0;
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
): StationCharacterState {
  const moveX = input.moveX ?? 0;
  const moveY = input.moveY ?? 0;
  const wantsSprint = Boolean(input.sprint);
  const desiredDirection = stationMovementDirection(frame, moveX, moveY, input.cameraYawRadians ?? 0);
  const moveMagnitude = Math.min(1, Math.hypot(moveX, moveY));
  const moveSpeed =
    (wantsSprint ? SPRINT_SPEED_METERS_PER_SECOND : WALK_SPEED_METERS_PER_SECOND) * moveMagnitude;

  const room = getStationRoom(state.stationRoomId);
  const rects = getStationWalkRects(room?.floorId ?? 'lobby');
  const desiredFacing = input.faceCameraYaw
    ? stationCameraForward(frame, input.cameraYawRadians ?? 0)
    : desiredDirection;

  let resolved: ResolvedStep = {
    local: state.stationLocal,
    roomId: state.stationRoomId,
    floorUp: room?.floorUp ?? 0,
  };
  const isMoving = moveMagnitude > 0.08;

  const motion = integrateCharacterLocomotion(
    state,
    {
      wantsJump: Boolean(input.jumpPressed),
      wantsSprint,
      isMoving,
      desiredDirection,
      moveSpeed,
    },
    dt,
    frame.up,
    gravityMetersPerSecond2,
    {
      onGroundedStep: () => {
        if (isMoving) {
          const step = scale(desiredDirection, moveSpeed * dt);
          resolved = resolveStationStep(
            rects,
            state.stationLocal,
            state.stationRoomId,
            dot(step, frame.right),
            dot(step, frame.forward),
            room?.floorUp ?? 0,
          );
        } else {
          resolved = {
            local: state.stationLocal,
            roomId: state.stationRoomId,
            floorUp: room?.floorUp ?? 0,
          };
        }
        const position = stationWalkPose(frame, resolved.local, resolved.floorUp);
        return { position, up: frame.up };
      },
      tryLand: (candidate) => {
        const local = worldToStationLocal(frame, candidate);
        const rect = findContainingRect(rects, { right: local.right, forward: local.forward });
        const floorUp = rect?.floorUp ?? resolved.floorUp;
        const restUp = floorUp + CHARACTER_GROUND_OFFSET_METERS;
        if (local.up > restUp) return null;
        resolved = {
          local: { right: local.right, forward: local.forward },
          roomId: rect?.kind === 'room' ? rect.id : state.stationRoomId,
          floorUp,
        };
        const position = stationWalkPose(frame, resolved.local, resolved.floorUp);
        return { position, up: frame.up };
      },
    },
  );

  let forward = rotateToward(state.forward, desiredFacing, motion.up, dt);
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
    stationLocal: resolved.local,
    stationRoomId: resolved.roomId,
    up: motion.up,
    velocity: motion.velocity,
  };
}
