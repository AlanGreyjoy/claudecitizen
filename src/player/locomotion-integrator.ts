import { add, dot, lerp, scale, sub, tangentize, vec3 } from "../math/vec3";
import type { CharacterState, JumpPhase, Vec3 } from "../types";
import { JUMP_LAND_SECONDS, JUMP_START_SECONDS } from "./character-locomotion";

/**
 * Shared grounded/airborne integration for walkers that own their own ground
 * query instead of a Rapier controller: the planet surface, the sandbox pad,
 * and the editor play-test stage. The caller supplies the ground step and the
 * landing test; this module owns gravity, air control, and the jump phase
 * machine so those three stay identical everywhere.
 *
 * Rapier-driven walkers (station, ship deck) do not use this — they integrate
 * through the character controller and only borrow the animation-phase helpers
 * in `character-locomotion.ts`.
 */

/**
 * Air-control response rate. Tangent velocity chases the input direction with
 * this time constant, so a held direction takes roughly a second to bite —
 * enough to steer a jump, not enough to fly.
 */
const AIR_CONTROL_RESPONSE_PER_SECOND = 1.44;
/** Extra pull on the way down so hang time doesn't feel floaty. */
const FALL_GRAVITY_MULTIPLIER = 1.7;

export interface LocomotionMotionInput {
  wantsJump: boolean;
  /** Unit tangent move direction, or the zero vector when there is no input. */
  desiredDirection: Vec3;
  moveSpeed: number;
  jumpSpeed: number;
}

export interface LocomotionIntegrationResult {
  grounded: boolean;
  jumpPhase: JumpPhase;
  jumpPhaseTime: number;
  position: Vec3;
  up: Vec3;
  velocity: Vec3;
}

export interface GroundContact {
  position: Vec3;
  up: Vec3;
}

export interface LocomotionCallbacks {
  /** Apply this frame's ground movement and return the resting foot pose. */
  onGroundedStep: () => GroundContact;
  /** Foot pose if the candidate position is at or below ground, else null. */
  tryLand: (position: Vec3) => GroundContact | null;
  /** When set, recomputes up each airborne frame (planet radial gravity). */
  sampleAirborneUp?: (position: Vec3) => Vec3;
}

type LocomotionState = Pick<
  CharacterState,
  "position" | "velocity" | "grounded" | "jumpPhase" | "jumpPhaseTime"
>;

function clamp(value: number, min: number, max: number): number {
  return Math.max(min, Math.min(max, value));
}

/** Only `jump-land` runs on a timer while grounded; the rest is a steady state. */
function advanceGroundedJumpPhase(
  state: Pick<CharacterState, "jumpPhase" | "jumpPhaseTime">,
  dt: number,
): JumpPhase {
  if (state.jumpPhase !== "jump-land") return state.jumpPhase;
  return state.jumpPhaseTime + dt >= JUMP_LAND_SECONDS
    ? "grounded"
    : "jump-land";
}

function integrateGrounded(
  state: LocomotionState,
  motion: LocomotionMotionInput,
  dt: number,
  callbacks: LocomotionCallbacks,
): LocomotionIntegrationResult {
  const { position, up } = callbacks.onGroundedStep();
  const velocity =
    dt > 0 ? scale(sub(position, state.position), 1 / dt) : vec3(0, 0, 0);

  if (motion.wantsJump) {
    // That velocity came from differencing two ground-snapped positions, so on
    // a slope it carries a vertical component. Keeping it would let downhill
    // walking eat the jump and uphill walking inflate it — launch from the
    // tangent part only.
    return {
      grounded: false,
      jumpPhase: "jump-start",
      jumpPhaseTime: 0,
      position,
      up,
      velocity: add(tangentize(velocity, up), scale(up, motion.jumpSpeed)),
    };
  }

  const jumpPhase = advanceGroundedJumpPhase(state, dt);
  return {
    grounded: true,
    jumpPhase,
    jumpPhaseTime: jumpPhase === "grounded" ? 0 : state.jumpPhaseTime + dt,
    position,
    up,
    velocity,
  };
}

/** Jump phase for a frame that stayed airborne. */
function advanceAirborneJumpPhase(
  jumpPhase: JumpPhase,
  jumpPhaseTime: number,
): { jumpPhase: JumpPhase; jumpPhaseTime: number } {
  if (jumpPhase === "jump-start" && jumpPhaseTime < JUMP_START_SECONDS) {
    return { jumpPhase, jumpPhaseTime };
  }
  if (jumpPhase === "jump-loop") return { jumpPhase, jumpPhaseTime };
  // Walked off a ledge, or the start clip just finished.
  return { jumpPhase: "jump-loop", jumpPhaseTime: 0 };
}

interface AirborneInput {
  callbacks: LocomotionCallbacks;
  dt: number;
  gravityMetersPerSecond2: number;
  jumpPhase: JumpPhase;
  jumpPhaseTime: number;
  motion: LocomotionMotionInput;
  state: LocomotionState;
  up: Vec3;
}

function integrateAirborne(input: AirborneInput): LocomotionIntegrationResult {
  const { motion, dt, state, up, gravityMetersPerSecond2, callbacks } = input;

  const desiredVelocity = scale(motion.desiredDirection, motion.moveSpeed);
  const airControl01 = 1 - Math.exp(-AIR_CONTROL_RESPONSE_PER_SECOND * Math.max(0, dt));
  const blendedTangent = lerp(
    tangentize(state.velocity, up),
    desiredVelocity,
    clamp(airControl01, 0, 1),
  );
  const verticalSpeed = dot(state.velocity, up);
  const gravityScale = verticalSpeed < 0 ? FALL_GRAVITY_MULTIPLIER : 1;
  const nextVelocity = add(
    blendedTangent,
    scale(up, verticalSpeed - gravityMetersPerSecond2 * gravityScale * dt),
  );
  const nextPosition = add(state.position, scale(nextVelocity, dt));

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

  return {
    grounded: false,
    ...advanceAirborneJumpPhase(input.jumpPhase, input.jumpPhaseTime),
    position: nextPosition,
    up: callbacks.sampleAirborneUp?.(nextPosition) ?? up,
    velocity: nextVelocity,
  };
}

/** One locomotion frame: ground step and land/fall, plus the jump phase. */
export function integrateCharacterLocomotion(
  state: LocomotionState,
  motion: LocomotionMotionInput,
  dt: number,
  initialUp: Vec3,
  gravityMetersPerSecond2: number,
  callbacks: LocomotionCallbacks,
): LocomotionIntegrationResult {
  if (state.grounded) {
    return integrateGrounded(state, motion, dt, callbacks);
  }

  return integrateAirborne({
    motion,
    dt,
    state,
    up: initialUp,
    jumpPhase: state.jumpPhase,
    jumpPhaseTime:
      state.jumpPhase === "grounded" ? 0 : state.jumpPhaseTime + dt,
    gravityMetersPerSecond2,
    callbacks,
  });
}
