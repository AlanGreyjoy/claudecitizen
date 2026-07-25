import { length, sub } from "../math/vec3";
import type { FlightBody, Vec3 } from "../types";
import { localOffsetToWorld } from "./ship_interaction";
import type { CockpitStatSpec } from "./ship_layout";
import { projectWorldPointToScreenOffset } from "./cockpit_gaze";

/**
 * Resolve world-projected cockpit-stat instruments for the pilot HUD.
 * Domain-only — no DOM.
 */

export interface CockpitSpeedInstrumentView {
  id: string;
  offsetPx: { x: number; y: number };
  label?: string;
}

/**
 * Speed instruments that are on-screen and within maxDistance of the eye.
 */
export function resolveVisibleCockpitSpeedInstruments(
  stats: readonly CockpitStatSpec[],
  ship: FlightBody,
  eye: Vec3,
  viewForward: Vec3,
  viewRight: Vec3,
  viewUp: Vec3,
  fovYRadians: number,
  viewportHeightPx: number,
): CockpitSpeedInstrumentView[] {
  const out: CockpitSpeedInstrumentView[] = [];
  for (const stat of stats) {
    if (stat.kind !== "speed") continue;
    const worldPosition = localOffsetToWorld(ship, stat.position);
    const distance = length(sub(worldPosition, eye));
    if (distance > stat.maxDistance || distance < 1e-4) continue;
    const offset = projectWorldPointToScreenOffset(
      worldPosition,
      eye,
      viewForward,
      viewRight,
      viewUp,
      fovYRadians,
      viewportHeightPx,
    );
    if (offset.behind) continue;
    out.push({
      id: stat.id,
      offsetPx: { x: offset.x, y: offset.y },
      ...(stat.label ? { label: stat.label } : {}),
    });
  }
  return out;
}
