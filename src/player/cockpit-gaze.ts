import { dot, length, normalize, scale, sub } from "../math/vec3";
import type { FlightBody, Vec3 } from "../types";
import { localOffsetToWorld } from "./ship_interaction";
import type {
  CockpitControlAction,
  CockpitControlSpec,
} from "./ship_layout";
import type { ShipRigState } from "./ship_rig";

/**
 * Gaze pick for cockpit look-at controls: while Hold F free-looking, score
 * markers by camera-ray proximity and activate on left-click.
 */

export interface CockpitGazeHit {
  control: CockpitControlSpec;
  /** World-space marker position. */
  worldPosition: Vec3;
  /** Perpendicular distance from the camera ray to the marker (m). */
  perpDistance: number;
  /** Distance along the camera forward to the closest point on the ray (m). */
  along: number;
}

export interface CockpitGazeLabelState {
  gearDown: boolean;
  rampDown: boolean;
}

/** Dynamic prompt when no authored label override is set. */
export function cockpitControlLabel(
  action: CockpitControlAction,
  state: CockpitGazeLabelState,
  override?: string,
): string {
  if (override?.trim()) return override.trim();
  switch (action) {
    case "landing-gear":
      return state.gearDown ? "Raise Landing Gear" : "Lower Landing Gear";
    case "cargo-ramp":
      return state.rampDown ? "Raise Cargo Ramp" : "Lower Cargo Ramp";
  }
}

/**
 * Returns the closest cockpit control along the camera forward ray within
 * each marker's gazeRadius / maxDistance, or null if none qualify.
 */
export function resolveCockpitGazeTarget(
  controls: readonly CockpitControlSpec[],
  ship: FlightBody,
  cameraPos: Vec3,
  cameraForward: Vec3,
): CockpitGazeHit | null {
  if (controls.length === 0) return null;
  const forward = normalize(cameraForward);
  if (length(forward) < 1e-6) return null;

  let best: CockpitGazeHit | null = null;
  let bestScore = Infinity;

  for (const control of controls) {
    const worldPosition = localOffsetToWorld(ship, control.position);
    const toPoint = sub(worldPosition, cameraPos);
    const distance = length(toPoint);
    if (distance > control.maxDistance || distance < 1e-4) continue;

    const along = dot(toPoint, forward);
    if (along < 0.05) continue;

    const closestOnRay = scale(forward, along);
    const perp = sub(toPoint, closestOnRay);
    const perpDistance = length(perp);
    if (perpDistance > control.gazeRadius) continue;

    // Prefer tighter angular hits, then nearer along the ray.
    const angular = perpDistance / Math.max(along, 0.05);
    const score = angular * 10 + along * 0.05;
    if (score < bestScore) {
      bestScore = score;
      best = { control, worldPosition, perpDistance, along };
    }
  }

  return best;
}

/** Toggle gear/ramp from a cockpit control action. */
export function applyCockpitControlAction(
  action: CockpitControlAction,
  rig: ShipRigState,
  options?: { allowRamp?: boolean },
): boolean {
  switch (action) {
    case "landing-gear":
      rig.gearDown = !rig.gearDown;
      return true;
    case "cargo-ramp":
      if (options?.allowRamp === false) return false;
      rig.rampDown = !rig.rampDown;
      return true;
  }
}

/** Project a world point to screen-pixel offset from viewport center. */
export function projectWorldPointToScreenOffset(
  worldPoint: Vec3,
  cameraPos: Vec3,
  cameraForward: Vec3,
  cameraRight: Vec3,
  cameraUp: Vec3,
  fovYRadians: number,
  viewportHeightPx: number,
): { x: number; y: number; behind: boolean } {
  const toPoint = sub(worldPoint, cameraPos);
  const depth = dot(toPoint, cameraForward);
  const behind = depth <= 0.05;
  const right = dot(toPoint, cameraRight);
  const up = dot(toPoint, cameraUp);
  const halfFov = Math.max(0.1, fovYRadians * 0.5);
  const scalePx = (viewportHeightPx * 0.5) / Math.tan(halfFov);
  const safeDepth = Math.max(0.05, Math.abs(depth));
  return {
    x: (right / safeDepth) * scalePx,
    y: (-up / safeDepth) * scalePx,
    behind,
  };
}
