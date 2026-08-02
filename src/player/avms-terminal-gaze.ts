import { dot, length, normalize, scale, sub } from "../math/vec3";
import type { Vec3 } from "../types";
import {
  stationLocalToWorld,
  type StationAvmsMarker,
  type StationFrame,
} from "../world/station";

/**
 * Gaze pick for station AVMS markers while on foot
 * (same ray-vs-marker math as weapon-shop / bunk entertainment-system).
 */

export interface AvmsTerminalGazeHit {
  terminal: StationAvmsMarker;
  /** World-space marker position. */
  worldPosition: Vec3;
  perpDistance: number;
  along: number;
}

/** World position of an AVMS screen anchor. */
export function avmsTerminalWorldPosition(
  frame: StationFrame,
  terminal: StationAvmsMarker,
): Vec3 {
  return stationLocalToWorld(frame, {
    right: terminal.right,
    up: terminal.up,
    forward: terminal.forward,
  });
}

/** Returns the closest AVMS marker along the camera ray, or null. */
export function resolveAvmsTerminalGazeTarget(
  terminals: readonly StationAvmsMarker[],
  frame: StationFrame,
  cameraPos: Vec3,
  cameraForward: Vec3,
): AvmsTerminalGazeHit | null {
  if (terminals.length === 0) return null;
  const forward = normalize(cameraForward);
  if (length(forward) < 1e-6) return null;

  let best: AvmsTerminalGazeHit | null = null;
  let bestScore = Infinity;

  for (const terminal of terminals) {
    const worldPosition = avmsTerminalWorldPosition(frame, terminal);
    const toPoint = sub(worldPosition, cameraPos);
    const distance = length(toPoint);
    if (distance > terminal.maxDistance || distance < 1e-4) continue;

    const along = dot(toPoint, forward);
    if (along < 0.05) continue;

    const closestOnRay = scale(forward, along);
    const perp = sub(toPoint, closestOnRay);
    const perpDistance = length(perp);
    if (perpDistance > terminal.gazeRadius) continue;

    const angular = perpDistance / Math.max(along, 0.05);
    const score = angular * 10 + along * 0.05;
    if (score < bestScore) {
      bestScore = score;
      best = { terminal, worldPosition, perpDistance, along };
    }
  }

  return best;
}

export function avmsTerminalLabel(terminal: StationAvmsMarker): string {
  return terminal.label.trim() || "AVMS terminal";
}
