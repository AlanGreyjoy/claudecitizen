import { add, cross, dot, length, normalize, rotateAroundAxis, scale, sub } from "../math/vec3";
import type { Vec3 } from "../types";
import {
  stationLocalToWorld,
  type StationFrame,
  type StationOutfittersMarker,
} from "../world/station";
import {
  FIRST_PERSON_EYE_HEIGHT_METERS,
  FIRST_PERSON_PITCH_LIMIT,
} from "./character_controller";

/**
 * Gaze pick for station outfitters markers while on foot
 * (same ray-vs-marker math as weapon-shop / bunk entertainment-system).
 */

/** Matches character_controller first-person forward nudge. */
const FIRST_PERSON_FORWARD_OFFSET_METERS = 0.22;

export interface OutfittersGazeHit {
  shop: StationOutfittersMarker;
  /** World-space marker position. */
  worldPosition: Vec3;
  perpDistance: number;
  along: number;
}

/** Station walk look basis from camera orbit (matches camera_rig deck orbit). */
export function resolveStationWalkView(
  stationForward: Vec3,
  stationUp: Vec3,
  yawRadians: number,
  pitchRadians: number,
): { forward: Vec3; right: Vec3; up: Vec3 } {
  const up = normalize(stationUp);
  const deckForward = normalize(stationForward);
  const deckRight = normalize(cross(deckForward, up));
  const deckYawRadians = -yawRadians;
  const planarForward = normalize(
    add(
      scale(deckForward, Math.cos(deckYawRadians)),
      scale(deckRight, Math.sin(deckYawRadians)),
    ),
  );
  const right = normalize(cross(planarForward, up));
  const clampedPitch = Math.max(
    -FIRST_PERSON_PITCH_LIMIT,
    Math.min(FIRST_PERSON_PITCH_LIMIT, pitchRadians),
  );
  return {
    forward: normalize(rotateAroundAxis(planarForward, right, clampedPitch)),
    right,
    up,
  };
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

/**
 * Approximate first-person eye for station walk (matches camera_rig /
 * resolveFirstPersonCameraRig with station-frame orbit).
 */
export function stationWalkEyeWorld(
  characterPosition: Vec3,
  stationUp: Vec3,
  viewForward: Vec3,
): Vec3 {
  const up = normalize(stationUp);
  const forward = normalize(viewForward);
  const right = normalize(cross(forward, up));
  const planarForward = normalize(cross(up, right));
  return add(
    characterPosition,
    add(
      scale(up, FIRST_PERSON_EYE_HEIGHT_METERS),
      scale(planarForward, FIRST_PERSON_FORWARD_OFFSET_METERS),
    ),
  );
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
