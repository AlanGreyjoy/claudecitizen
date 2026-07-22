import { rotateVec3ByQuat, type Quat } from "../math/quat";
import {
  add,
  cross,
  dot,
  length,
  normalize,
  scale,
  sub,
  tangentize,
} from "../math/vec3";
import type { Vec3 } from "../types";
import type { StationFrame } from "../world/station";
import { CHARACTER_EYE_HEIGHT_METERS } from "./character_controller";

/**
 * Station vendor-screen hotspots: when the player is near a screen (and in
 * front of it), turn the character Head bone toward the panel. Camera orbit
 * stays under player control.
 */

/**
 * Head-look engages only inside this distance (m), even if the shop's
 * interact `maxDistance` is larger (defaults to 3 m).
 */
export const SCREEN_HOTSPOT_MAX_DISTANCE_METERS = 1.35;
/** Neck yaw clamp (radians) relative to character facing. */
export const SCREEN_HOTSPOT_MAX_YAW = (55 * Math.PI) / 180;
/** Neck pitch clamp (radians). */
export const SCREEN_HOTSPOT_MAX_PITCH = (35 * Math.PI) / 180;
/** Must be this far in front of the screen plane (dot normal→eye). */
const FRONT_DOT_MIN = 0.08;

export interface ScreenHotspotAnchor {
  worldPosition: Vec3;
  maxDistance: number;
  /** World-space outward normal of the screen plane (faces local +Z). */
  worldNormal: Vec3;
}

export interface CharacterHeadLook {
  pitchRadians: number;
  yawRadians: number;
}

/** Eye height used for hotspot look (station walk). */
export function stationHotspotEyeWorld(
  characterPosition: Vec3,
  stationUp: Vec3,
): Vec3 {
  return add(characterPosition, scale(normalize(stationUp), CHARACTER_EYE_HEIGHT_METERS));
}

/**
 * Screen plane outward normal in world space.
 * Prefab rotation is in station-group axes (x = -right, y = up, z = forward).
 */
export function screenWorldNormal(
  frame: StationFrame,
  rotation: Quat,
): Vec3 {
  const local = rotateVec3ByQuat({ x: 0, y: 0, z: 1 }, rotation);
  return normalize(
    add(
      add(scale(frame.right, -local.x), scale(frame.up, local.y)),
      scale(frame.forward, local.z),
    ),
  );
}

/** Nearest in-range screen the player is standing in front of. */
export function resolveNearestScreenHotspot(
  anchors: readonly ScreenHotspotAnchor[],
  eye: Vec3,
): ScreenHotspotAnchor | null {
  let best: ScreenHotspotAnchor | null = null;
  let bestDistance = Infinity;

  for (const anchor of anchors) {
    const toEye = sub(eye, anchor.worldPosition);
    const distance = length(toEye);
    if (distance > anchor.maxDistance || distance < 1e-4) continue;
    if (dot(anchor.worldNormal, toEye) < FRONT_DOT_MIN * distance) continue;
    if (distance < bestDistance) {
      bestDistance = distance;
      best = anchor;
    }
  }

  return best;
}

/**
 * Head yaw/pitch relative to character facing so the Head bone can look
 * toward `target` (same sign convention as weapon upper-body aim).
 */
export function characterHeadLookTowardPoint(
  characterForward: Vec3,
  characterUp: Vec3,
  eye: Vec3,
  target: Vec3,
  maxYaw = SCREEN_HOTSPOT_MAX_YAW,
  maxPitch = SCREEN_HOTSPOT_MAX_PITCH,
): CharacterHeadLook | null {
  const up = normalize(characterUp);
  const toward = sub(target, eye);
  const distance = length(toward);
  if (distance < 1e-4) return null;
  const dir = scale(toward, 1 / distance);

  const bodyForward = normalize(tangentize(characterForward, up));
  if (length(bodyForward) < 1e-5) return null;

  const planarView = tangentize(dir, up);
  let yawRadians = 0;
  if (length(planarView) > 1e-5) {
    const planarDir = normalize(planarView);
    const sinYaw = dot(up, cross(bodyForward, planarDir));
    const cosYaw = Math.max(-1, Math.min(1, dot(bodyForward, planarDir)));
    yawRadians = Math.atan2(sinYaw, cosYaw);
  }

  const pitchRadians = Math.asin(Math.max(-1, Math.min(1, dot(dir, up))));

  // Outside the neck cone: leave the head alone (no rubber-necking behind).
  if (Math.abs(yawRadians) > maxYaw) return null;

  return {
    yawRadians,
    pitchRadians: Math.max(-maxPitch, Math.min(maxPitch, pitchRadians)),
  };
}
