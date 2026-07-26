import { add, normalize, scale, vec3 } from '../math/vec3';
import {
  advanceLadderClimb,
  clampLadderAlong,
  ladderSnapVelocity,
  type LadderExit,
  type LadderPoint,
  type LadderSpec,
} from '../world/ladders';
import { CHARACTER_GROUND_OFFSET_METERS } from './character-controller';
import { resolveWalkInputIntent } from './character-locomotion';
import type { CharacterInput, Vec3 } from '../types';

/**
 * Surface-agnostic ladder climbing. Station-local and ship-local frames both
 * hand over their world basis vectors and their own capsule position, so the
 * climb math lives here once.
 *
 * There is no authored climb clip yet — the character holds an idle pose while
 * sliding up the rail. Swap this for a `climb_loop` state once one exists.
 */
export const LADDER_CLIMB_ANIMATION = 'Idle_Loop';

/** World-space axes of the surface the ladder is authored in. */
export interface LadderSurfaceBasis {
  right: Vec3;
  up: Vec3;
  forward: Vec3;
}

/**
 * Capsule origins sit a fixed offset above the floor the marker was authored
 * on, so `along` (a foot height) and the capsule height differ by that offset.
 */
export function ladderAlongFromCapsule(ladder: LadderSpec, capsuleUp: number): number {
  return clampLadderAlong(
    ladder,
    capsuleUp - CHARACTER_GROUND_OFFSET_METERS - ladder.base.up,
  );
}

/** Capsule-space local point for a foot-space ladder point. */
export function ladderCapsuleLocal(point: LadderPoint): LadderPoint {
  return {
    right: point.right,
    up: point.up + CHARACTER_GROUND_OFFSET_METERS,
    forward: point.forward,
  };
}

/** World facing that puts the climber's back to the step-off side. */
export function ladderFacing(ladder: LadderSpec, basis: LadderSurfaceBasis): Vec3 {
  return normalize(
    add(
      scale(basis.right, -ladder.outward.right),
      scale(basis.forward, -ladder.outward.forward),
    ),
  );
}

export interface LadderStep {
  /** Foot height on the rail after this step. */
  along: number;
  exit: LadderExit;
  /** World velocity to hand to the surface's kinematic move. */
  velocity: Vec3;
  /** True while the player is actually moving up or down. */
  climbing: boolean;
}

/**
 * One climb step. `capsuleLocal` is the player's current surface-local capsule
 * position; `along` is re-derived from it so a blocked climb (Rapier refusing
 * the move) cannot drift the tracked height away from the body.
 */
export function stepLadderClimb(args: {
  ladder: LadderSpec;
  capsuleLocal: LadderPoint;
  basis: LadderSurfaceBasis;
  input: CharacterInput;
  dt: number;
}): LadderStep {
  const { ladder, capsuleLocal, basis, input, dt } = args;
  const intent = resolveWalkInputIntent(input);
  const climbInput = Math.max(-1, Math.min(1, intent.moveY));
  const measured = ladderAlongFromCapsule(ladder, capsuleLocal.up);
  const advanced = advanceLadderClimb(ladder, measured, climbInput, dt);
  if (advanced.exit !== 'none') {
    return {
      along: advanced.along,
      exit: advanced.exit,
      velocity: vec3(0, 0, 0),
      climbing: false,
    };
  }

  const snap = ladderSnapVelocity(ladder, capsuleLocal, dt);
  const velocity = add(
    scale(basis.up, climbInput * ladder.climbSpeed),
    add(scale(basis.right, snap.right), scale(basis.forward, snap.forward)),
  );
  return {
    along: advanced.along,
    exit: 'none',
    velocity,
    climbing: Math.abs(climbInput) > 0.05,
  };
}
