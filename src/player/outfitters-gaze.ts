import { dot, length, normalize, scale, sub } from "../math/vec3";
import type { Vec3 } from "../types";
import {
  stationLocalToWorld,
  type StationFrame,
  type StationOutfittersMarker,
} from "../world/station";

/**
 * Gaze pick for station outfitters markers while on foot
 * (same ray-vs-marker math as weapon-shop / bunk entertainment-system).
 */

export interface OutfittersGazeHit {
  shop: StationOutfittersMarker;
  /** World-space marker position. */
  worldPosition: Vec3;
  perpDistance: number;
  along: number;
}

/** World position of an outfitters screen anchor. */
export function outfittersWorldPosition(
  frame: StationFrame,
  shop: StationOutfittersMarker,
): Vec3 {
  return stationLocalToWorld(frame, {
    right: shop.right,
    up: shop.up,
    forward: shop.forward,
  });
}

/** Returns the closest outfitters marker along the camera ray, or null. */
export function resolveOutfittersGazeTarget(
  shops: readonly StationOutfittersMarker[],
  frame: StationFrame,
  cameraPos: Vec3,
  cameraForward: Vec3,
): OutfittersGazeHit | null {
  if (shops.length === 0) return null;
  const forward = normalize(cameraForward);
  if (length(forward) < 1e-6) return null;

  let best: OutfittersGazeHit | null = null;
  let bestScore = Infinity;

  for (const shop of shops) {
    const worldPosition = outfittersWorldPosition(frame, shop);
    const toPoint = sub(worldPosition, cameraPos);
    const distance = length(toPoint);
    if (distance > shop.maxDistance || distance < 1e-4) continue;

    const along = dot(toPoint, forward);
    if (along < 0.05) continue;

    const closestOnRay = scale(forward, along);
    const perp = sub(toPoint, closestOnRay);
    const perpDistance = length(perp);
    if (perpDistance > shop.gazeRadius) continue;

    const angular = perpDistance / Math.max(along, 0.05);
    const score = angular * 10 + along * 0.05;
    if (score < bestScore) {
      bestScore = score;
      best = { shop, worldPosition, perpDistance, along };
    }
  }

  return best;
}

export function outfittersLabel(shop: StationOutfittersMarker): string {
  return shop.label.trim() || "Browse outfitters";
}
