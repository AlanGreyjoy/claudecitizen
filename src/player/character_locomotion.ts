import {
  cross,
  dot,
  length,
  normalize,
  rotateAroundAxis,
  tangentize,
} from "../math/vec3";
import type {
  CharacterInput,
  CharacterState,
  JumpPhase,
  Vec3,
} from "../types";
import {
  resolveLocomotionClip,
  resolveLocomotionAiming,
  resolveLocomotionLayers,
  type LocomotionGait,
  type LocomotionLayers,
} from "./animation";
import { getCharacterSettings } from "./character_settings";
import type { WeaponAnimStanceId } from "./inventory/weapon_select";

/**
 * Shared on-foot locomotion policy for every walker (planet surface, station
 * interior, ship deck): normalizing move input, choosing the facing direction,
 * and resolving the animation clip. Walkers own only their context-specific
 * movement integration and camera-frame math.
 */

/** Move-input magnitude above which locomotion counts as moving. */
export const WALK_MOVE_THRESHOLD = 0.08;

const TURN_SPEED_RADIANS_PER_SECOND = 10;
export const JUMP_START_SECONDS = 0.18;
export const JUMP_LAND_SECONDS = 0.18;

/** Movement speed band — also selects walk/run/sprint clips when not aiming. */
export type WalkGait = LocomotionGait;

function clamp(value: number, min: number, max: number): number {
  return Math.max(min, Math.min(max, value));
}

export interface WalkInputIntent {
  moveX: number;
  moveY: number;
  isSprinting: boolean;
  isWalking: boolean;
  isCrouching: boolean;
  wantsJump: boolean;
  moveMagnitude: number;
  isMoving: boolean;
  moveSpeedMetersPerSecond: number;
  jumpSpeedMetersPerSecond: number;
  gait: WalkGait;
}

/** Normalize raw character input into walk speeds and movement flags. */
export function resolveWalkInputIntent(input: CharacterInput): WalkInputIntent {
  const moveX = input.moveX ?? 0;
  const moveY = input.moveY ?? 0;
  const isCrouching = Boolean(input.crouch);
  // Crouch blocks sprint; walk toggle selects slow gait when not sprinting.
  const isSprinting = Boolean(input.sprint) && !isCrouching;
  const isWalking = Boolean(input.walk) && !isSprinting;
  const moveMagnitude = Math.min(1, Math.hypot(moveX, moveY));
  const settings = getCharacterSettings();
  const gait: WalkGait = isSprinting ? "sprint" : isWalking || isCrouching ? "walk" : "run";
  const baseSpeed =
    gait === "sprint"
      ? settings.sprintSpeedMetersPerSecond
      : gait === "walk"
        ? settings.walkSpeedMetersPerSecond
        : settings.runSpeedMetersPerSecond;
  return {
    moveX,
    moveY,
    isSprinting,
    isWalking,
    isCrouching,
    wantsJump: Boolean(input.jumpPressed),
    moveMagnitude,
    isMoving: moveMagnitude > WALK_MOVE_THRESHOLD,
    moveSpeedMetersPerSecond: baseSpeed * moveMagnitude,
    jumpSpeedMetersPerSecond: settings.jumpSpeedMetersPerSecond,
    gait,
  };
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

export interface WalkFacingParams {
  currentForward: Vec3;
  /** Camera-relative move direction (zero vector when there is no move input). */
  moveDirection: Vec3;
  /** Camera forward projected on the walk plane — the active-aim facing target. */
  cameraForward: Vec3;
  up: Vec3;
  aiming: boolean;
  /**
   * When true, the whole character stays camera-aligned.
   * Non-aim locomotion faces the movement direction.
   */
  lockFacingToCamera?: boolean;
}

/** Active ADS rotates the whole character toward the camera/aim direction. */
export function shouldLockFacingToCamera(aiming: boolean): boolean {
  return aiming;
}

/** Resolve raw RMB aim against locomotion rules shared by every walker. */
export function resolveWalkAiming(
  aiming: boolean,
  locomotion: Pick<WalkInputIntent, "gait" | "isMoving">,
): boolean {
  return resolveLocomotionAiming({
    aiming,
    gait: locomotion.gait,
    isMoving: locomotion.isMoving,
  });
}

/**
 * Resolve this frame's facing. Active aim squares the whole character to the
 * view; otherwise it faces movement (or holds its last facing when idle).
 */
export function resolveWalkFacing(
  params: WalkFacingParams,
  dt: number,
): Vec3 {
  const lockToCamera = params.lockFacingToCamera
    ?? params.aiming;
  const desired = lockToCamera ? params.cameraForward : params.moveDirection;
  const turned = rotateCharacterToward(params.currentForward, desired, params.up, dt);
  return length(turned) < 1e-6
    ? normalize(tangentize(params.currentForward, params.up))
    : normalize(tangentize(turned, params.up));
}

export interface AnimationFromStateParams {
  stanceId?: WeaponAnimStanceId;
  aiming?: boolean;
  isMoving?: boolean;
  gait?: WalkGait;
  jumpPhase?: JumpPhase;
}

/**
 * Resolve the stance / gait base clip (CharacterState.animation).
 * Rifle ADS idle → idle_aiming; walk/run ADS → loco base + upper layer.
 * Sprint suppresses ADS and uses its normal full-body clip.
 */
export function animationFromState(params: AnimationFromStateParams): string {
  return resolveLocomotionClip({
    stanceId: params.stanceId ?? "unarmed",
    aiming: params.aiming,
    isMoving: params.isMoving,
    gait: params.gait,
    jumpPhase: params.jumpPhase,
  });
}

/** Base + optional upper ADS overlay for rifle aim while walking/running. */
export function animationLayersFromState(
  params: AnimationFromStateParams,
): LocomotionLayers {
  return resolveLocomotionLayers({
    stanceId: params.stanceId ?? "unarmed",
    aiming: params.aiming,
    isMoving: params.isMoving,
    gait: params.gait,
    jumpPhase: params.jumpPhase,
  });
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
