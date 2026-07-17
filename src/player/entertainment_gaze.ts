import { dot, length, normalize, scale, sub } from "../math/vec3";
import type { FlightBody, Vec3 } from "../types";
import { localOffsetToWorld } from "./ship_interaction";
import type { EntertainmentSystemSpec } from "./ship_layout";

/**
 * Gaze pick for bunk entertainment-system markers while in bed
 * (always-on head look — no Hold F gate).
 */

export interface EntertainmentGazeHit {
  system: EntertainmentSystemSpec;
  /** World-space marker position. */
  worldPosition: Vec3;
  perpDistance: number;
  along: number;
}

/** Returns the closest ES marker along the camera ray, or null. */
export function resolveEntertainmentGazeTarget(
  systems: readonly EntertainmentSystemSpec[],
  ship: FlightBody,
  cameraPos: Vec3,
  cameraForward: Vec3,
): EntertainmentGazeHit | null {
  if (systems.length === 0) return null;
  const forward = normalize(cameraForward);
  if (length(forward) < 1e-6) return null;

  let best: EntertainmentGazeHit | null = null;
  let bestScore = Infinity;

  for (const system of systems) {
    const worldPosition = localOffsetToWorld(ship, system.position);
    const toPoint = sub(worldPosition, cameraPos);
    const distance = length(toPoint);
    if (distance > system.maxDistance || distance < 1e-4) continue;

    const along = dot(toPoint, forward);
    if (along < 0.05) continue;

    const closestOnRay = scale(forward, along);
    const perp = sub(toPoint, closestOnRay);
    const perpDistance = length(perp);
    if (perpDistance > system.gazeRadius) continue;

    const angular = perpDistance / Math.max(along, 0.05);
    const score = angular * 10 + along * 0.05;
    if (score < bestScore) {
      bestScore = score;
      best = { system, worldPosition, perpDistance, along };
    }
  }

  return best;
}

export function entertainmentSystemLabel(system: EntertainmentSystemSpec): string {
  return system.label.trim() || "Turn on ES";
}
