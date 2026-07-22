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
  getDefaultAnimationController,
  locomotionFromGameplay,
  resolveControllerClip,
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

function clamp(value: number, min: number, max: number): number {
  return Math.max(min, Math.min(max, value));
}

export interface WalkInputIntent {
  moveX: number;
  moveY: number;
  isSprinting: boolean;
  wantsJump: boolean;
  moveMagnitude: number;
  isMoving: boolean;
  moveSpeedMetersPerSecond: number;
  jumpSpeedMetersPerSecond: number;
}

/** Normalize raw character input into walk speeds and movement flags. */
export function resolveWalkInputIntent(input: CharacterInput): WalkInputIntent {
  const moveX = input.moveX ?? 0;
  const moveY = input.moveY ?? 0;
  const isSprinting = Boolean(input.sprint);
  const moveMagnitude = Math.min(1, Math.hypot(moveX, moveY));
  const settings = getCharacterSettings();
  return {
    moveX,
    moveY,
    isSprinting,
    wantsJump: Boolean(input.jumpPressed),
    moveMagnitude,
    isMoving: moveMagnitude > WALK_MOVE_THRESHOLD,
    moveSpeedMetersPerSecond:
      (isSprinting
        ? settings.sprintSpeedMetersPerSecond
        : settings.walkSpeedMetersPerSecond) * moveMagnitude,
    jumpSpeedMetersPerSecond: settings.jumpSpeedMetersPerSecond,
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
  /** Camera forward projected on the walk plane — the aim-idle facing target. */
  cameraForward: Vec3;
  up: Vec3;
  aiming: boolean;
  isMoving: boolean;
}

/**
 * Resolve this frame's facing. Aiming while stationary squares the body up to
 * the camera so the aim pose tracks the player's view; otherwise the character
 * faces its movement (or holds its last facing when idle).
 */
export function resolveWalkFacing(
  params: WalkFacingParams,
  dt: number,
): Vec3 {
  const desired =
    params.aiming && !params.isMoving ? params.cameraForward : params.moveDirection;
  const turned = rotateCharacterToward(params.currentForward, desired, params.up, dt);
  return length(turned) < 1e-6
    ? normalize(tangentize(params.currentForward, params.up))
    : normalize(tangentize(turned, params.up));
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
  aiming = false,
): string {
  const locomotion = locomotionFromGameplay(state.jumpPhase, isMoving, isSprinting, aiming);
  const controller = getDefaultAnimationController();
  const clip =
    resolveControllerClip(controller, locomotion, stanceId) ??
    // Controllers saved before idle_aiming existed fall back to plain idle.
    (locomotion === "idle_aiming"
      ? resolveControllerClip(controller, "idle", stanceId)
      : null);
  return clip ?? UAL_FALLBACK[locomotion] ?? UAL_FALLBACK.idle;
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
