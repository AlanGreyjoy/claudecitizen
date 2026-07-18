import { add, cross, dot, length, normalize, rotateAroundAxis, scale, sub } from "../math/vec3";
import type { Vec3 } from "../types";
import {
  stationLocalToWorld,
  type StationFrame,
  type StationWeaponShopMarker,
} from "../world/station";
import {
  CHARACTER_EYE_HEIGHT_METERS,
  ORBIT_PITCH_LIMIT,
} from "./character_controller";

/**
 * Gaze pick for station weapon-shop markers while on foot
 * (same ray-vs-marker math as bunk entertainment-system).
 */

/** Keeps the interaction ray just ahead of the animated character capsule. */
const CHARACTER_AIM_FORWARD_OFFSET_METERS = 0.22;

export interface WeaponShopGazeHit {
  shop: StationWeaponShopMarker;
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
    -ORBIT_PITCH_LIMIT,
    Math.min(ORBIT_PITCH_LIMIT, pitchRadians),
  );
  return {
    forward: normalize(rotateAroundAxis(planarForward, right, clampedPitch)),
    right,
    up,
  };
}

/** World position of a weapon-shop screen anchor. */
export function weaponShopWorldPosition(
  frame: StationFrame,
  shop: StationWeaponShopMarker,
): Vec3 {
  return stationLocalToWorld(frame, {
    right: shop.right,
    up: shop.up,
    forward: shop.forward,
  });
}

/**
 * Character-relative aim origin for over-the-shoulder station interactions.
 * The ray follows the camera view while its origin stays close to the body.
 */
export function stationWalkAimOriginWorld(
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
      scale(up, CHARACTER_EYE_HEIGHT_METERS),
      scale(planarForward, CHARACTER_AIM_FORWARD_OFFSET_METERS),
    ),
  );
}

/** Returns the closest weapon-shop marker along the camera ray, or null. */
export function resolveWeaponShopGazeTarget(
  shops: readonly StationWeaponShopMarker[],
  frame: StationFrame,
  cameraPos: Vec3,
  cameraForward: Vec3,
): WeaponShopGazeHit | null {
  if (shops.length === 0) return null;
  const forward = normalize(cameraForward);
  if (length(forward) < 1e-6) return null;

  let best: WeaponShopGazeHit | null = null;
  let bestScore = Infinity;

  for (const shop of shops) {
    const worldPosition = weaponShopWorldPosition(frame, shop);
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

export function weaponShopLabel(shop: StationWeaponShopMarker): string {
  return shop.label.trim() || "Browse weapons";
}
