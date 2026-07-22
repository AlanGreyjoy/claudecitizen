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
import {
  resolveProRifleClip,
  type MoveOctant,
  type ProRifleGait,
} from "./animation/pro_rifle_clips";
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
  isWalking: boolean;
  isCrouching: boolean;
  wantsJump: boolean;
  moveMagnitude: number;
  isMoving: boolean;
  moveSpeedMetersPerSecond: number;
  jumpSpeedMetersPerSecond: number;
  gait: ProRifleGait;
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
  const gait: ProRifleGait = isSprinting ? "sprint" : isWalking || isCrouching ? "walk" : "run";
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
  /** Camera forward projected on the walk plane — the aim-idle facing target. */
  cameraForward: Vec3;
  up: Vec3;
  aiming: boolean;
  isMoving: boolean;
  /**
   * When true, face the camera while aiming or moving (rifle 8-way strafe).
   * Unarmed/pistol keep face-into-move unless aiming while idle.
   */
  cameraLockedFacing?: boolean;
}

/**
 * Resolve this frame's facing. Aiming while stationary squares the body up to
 * the camera so the aim pose tracks the player's view; otherwise the character
 * faces its movement (or holds its last facing when idle).
 * Rifle camera-lock also faces the camera while moving so strafe clips read.
 */
export function resolveWalkFacing(
  params: WalkFacingParams,
  dt: number,
): Vec3 {
  const lockToCamera =
    Boolean(params.cameraLockedFacing) && (params.aiming || params.isMoving);
  const desired = lockToCamera
    ? params.cameraForward
    : params.aiming && !params.isMoving
      ? params.cameraForward
      : params.moveDirection;
  const turned = rotateCharacterToward(params.currentForward, desired, params.up, dt);
  return length(turned) < 1e-6
    ? normalize(tangentize(params.currentForward, params.up))
    : normalize(tangentize(turned, params.up));
}

/**
 * Quantize move direction into an 8-way octant relative to character facing.
 * Returns `forward` when move is below threshold / zero.
 */
export function quantizeMoveOctant(
  moveDirection: Vec3,
  facing: Vec3,
  up: Vec3,
): MoveOctant {
  const move = tangentize(moveDirection, up);
  if (length(move) < 1e-6) return "forward";
  const forward = normalize(tangentize(facing, up));
  if (length(forward) < 1e-6) return "forward";
  const right = normalize(cross(forward, up));
  const moveN = normalize(move);
  const forwardDot = clamp(dot(moveN, forward), -1, 1);
  const rightDot = clamp(dot(moveN, right), -1, 1);
  // atan2(right, forward): 0 = forward, +π/2 = right, ±π = backward, -π/2 = left.
  const angle = Math.atan2(rightDot, forwardDot);
  const sector = Math.round(angle / (Math.PI / 4));
  const index = ((sector % 8) + 8) % 8;
  // sector 0 forward, 1 forward_right, 2 right, 3 backward_right, ...
  const bySector: MoveOctant[] = [
    "forward",
    "forward_right",
    "right",
    "backward_right",
    "backward",
    "backward_left",
    "left",
    "forward_left",
  ];
  return bySector[index] ?? "forward";
}

const UAL_FALLBACK: Record<string, string> = {
  jump_start: "Jump_Start",
  jump_loop: "Jump_Loop",
  jump_land: "Jump_Land",
  sprint: "Sprint_Loop",
  walk: "Walk_Loop",
  idle: "Idle_Loop",
};

export interface AnimationFromStateParams {
  jumpPhase: JumpPhase;
  isMoving: boolean;
  isSprinting: boolean;
  stanceId?: WeaponAnimStanceId;
  aiming?: boolean;
  crouch?: boolean;
  walk?: boolean;
  gait?: ProRifleGait;
  /** Move direction in world/walk space (camera-relative). */
  moveDirection?: Vec3;
  /** Character facing after this frame's turn. */
  facing?: Vec3;
  up?: Vec3;
}

function resolveGait(params: AnimationFromStateParams): ProRifleGait {
  if (params.gait) return params.gait;
  if (params.isSprinting) return "sprint";
  if (params.walk || params.crouch) return "walk";
  return "run";
}

export function animationFromState(params: AnimationFromStateParams): string {
  const stanceId = params.stanceId ?? "unarmed";
  const aiming = Boolean(params.aiming);
  const crouch = Boolean(params.crouch);
  const gait = resolveGait(params);

  if (stanceId === "rifle") {
    const up = params.up ?? { x: 0, y: 1, z: 0 };
    const facing = params.facing ?? { x: 0, y: 0, z: 1 };
    const moveDirection = params.moveDirection ?? { x: 0, y: 0, z: 0 };
    const octant = params.isMoving
      ? quantizeMoveOctant(moveDirection, facing, up)
      : "forward";
    return resolveProRifleClip({
      jumpPhase: params.jumpPhase,
      isMoving: params.isMoving,
      gait,
      octant,
      crouch,
      aiming,
    });
  }

  const locomotion = locomotionFromGameplay(
    params.jumpPhase,
    params.isMoving,
    params.isSprinting,
    aiming,
  );
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
