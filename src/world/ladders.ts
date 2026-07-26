/**
 * Climbable ladders, shared by station-local and ship-local surfaces.
 *
 * Both surfaces express positions as right/up/forward meters in their own
 * frame, so one spec and one climb integrator serve both. Nothing here touches
 * physics or rendering: callers own the capsule move and read `along` back
 * from the resulting position, which keeps the climb self-correcting when the
 * character controller refuses a step.
 *
 * Authoring convention: the marker sits at the **foot** of the climb line —
 * the spot the player stands on to mount. Local +Y is the climb axis, local +Z
 * is `outward`: the side the player faces away from while climbing and steps
 * off toward once they reach the top.
 */

export interface LadderPoint {
  right: number;
  up: number;
  forward: number;
}

export interface LadderDir2 {
  right: number;
  forward: number;
}

export interface LadderSpec {
  id: string;
  /** Prompt noun, e.g. "ladder" / "access shaft". */
  label: string;
  /** Foot of the climb line in surface-local meters. */
  base: LadderPoint;
  /** Climb length above `base`, meters. */
  height: number;
  /** Unit direction the player steps off toward at the top. */
  outward: LadderDir2;
  /** Mount / dismount reach from the climb line, meters. */
  radius: number;
  /** Climb rate, meters per second. */
  climbSpeed: number;
}

/** Live climb, stored on world state while the player is attached. */
export interface LadderClimbState {
  surface: 'station' | 'ship';
  ladderId: string;
  /** Meters climbed above `base` — recomputed from the capsule each frame. */
  along: number;
}

export type LadderExit = 'none' | 'top' | 'bottom';

export const LADDER_DEFAULT_RADIUS = 1.2;
export const LADDER_DEFAULT_CLIMB_SPEED = 2.2;
export const LADDER_DEFAULT_LABEL = 'ladder';
/** How far past the rail the player is nudged when released at the top. */
export const LADDER_TOP_STEP_OFF_METERS = 0.6;
/** Cap on the sideways pull that keeps the climber on the rail. */
export const LADDER_SNAP_SPEED_METERS_PER_SECOND = 2.5;

export function clampLadderAlong(ladder: LadderSpec, along: number): number {
  return Math.max(0, Math.min(ladder.height, along));
}

/** Point on the climb line `along` meters above the foot. */
export function ladderPointAt(ladder: LadderSpec, along: number): LadderPoint {
  return {
    right: ladder.base.right,
    up: ladder.base.up + clampLadderAlong(ladder, along),
    forward: ladder.base.forward,
  };
}

/** Where the player is released once they climb off the top. */
export function ladderTopExitPoint(ladder: LadderSpec): LadderPoint {
  return {
    right: ladder.base.right + ladder.outward.right * LADDER_TOP_STEP_OFF_METERS,
    up: ladder.base.up + ladder.height,
    forward: ladder.base.forward + ladder.outward.forward * LADDER_TOP_STEP_OFF_METERS,
  };
}

export function findLadderById(
  ladders: readonly LadderSpec[],
  id: string,
): LadderSpec | null {
  return ladders.find((ladder) => ladder.id === id) ?? null;
}

export interface LadderMount {
  ladder: LadderSpec;
  /** Height on the ladder the player attaches at. */
  along: number;
  /** True when they mounted from the upper deck rather than the foot. */
  fromTop: boolean;
}

/**
 * Nearest ladder whose climb line is within reach, measuring to the closest
 * point on the segment so the same marker serves both ends. Returns the height
 * to attach at, which is why stepping on from the upper deck works without a
 * second marker.
 */
export function nearestLadderMount(
  ladders: readonly LadderSpec[],
  local: LadderPoint,
): LadderMount | null {
  let best: { mount: LadderMount; distance: number } | null = null;
  for (const ladder of ladders) {
    const along = clampLadderAlong(ladder, local.up - ladder.base.up);
    const point = ladderPointAt(ladder, along);
    const distance = Math.hypot(
      local.right - point.right,
      local.up - point.up,
      local.forward - point.forward,
    );
    if (distance > ladder.radius) continue;
    if (best && distance >= best.distance) continue;
    best = {
      distance,
      mount: { ladder, along, fromTop: along > ladder.height * 0.5 },
    };
  }
  return best?.mount ?? null;
}

/**
 * Advance the climb. `climbInput` is -1..1 (forward stick = up). Exits only
 * fire when the player is actively pushing into the end, so mounting at the
 * top does not immediately release them.
 */
export function advanceLadderClimb(
  ladder: LadderSpec,
  along: number,
  climbInput: number,
  dt: number,
): { along: number; exit: LadderExit } {
  const next = along + climbInput * ladder.climbSpeed * dt;
  if (climbInput > 0 && next >= ladder.height) {
    return { along: ladder.height, exit: 'top' };
  }
  if (climbInput < 0 && next <= 0) {
    return { along: 0, exit: 'bottom' };
  }
  return { along: clampLadderAlong(ladder, next), exit: 'none' };
}

/**
 * Sideways velocity that keeps the climber pinned to the rail, in surface-local
 * right/forward meters per second. Vertical motion is the caller's.
 */
export function ladderSnapVelocity(
  ladder: LadderSpec,
  local: LadderPoint,
  dt: number,
): LadderDir2 {
  if (dt <= 0) return { right: 0, forward: 0 };
  const deltaRight = ladder.base.right - local.right;
  const deltaForward = ladder.base.forward - local.forward;
  const distance = Math.hypot(deltaRight, deltaForward);
  if (distance < 1e-4) return { right: 0, forward: 0 };
  const speed = Math.min(distance / dt, LADDER_SNAP_SPEED_METERS_PER_SECOND);
  return {
    right: (deltaRight / distance) * speed,
    forward: (deltaForward / distance) * speed,
  };
}

export function ladderPrompt(ladder: LadderSpec, interactLabel = 'F'): string {
  const label = ladder.label.trim() || LADDER_DEFAULT_LABEL;
  return `Press ${interactLabel} — climb ${label}`;
}
