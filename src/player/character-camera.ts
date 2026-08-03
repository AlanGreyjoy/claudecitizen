import { add, cross, normalize, rotateAroundAxis, scale } from "../math/vec3";
import { forwardFromYaw, radialUp } from "../world/coordinates";
import type { Vec3 } from "../types";

/**
 * Third-person orbit rig shared by every on-foot camera (planet surface,
 * station interior, ship deck, sandbox). Pure math over a yaw/pitch/zoom
 * triple — the walkers own where the character is, this owns where the camera
 * sits relative to it.
 */

/** Pitch clamp for the over-the-shoulder camera (radians from the horizon). */
export const ORBIT_PITCH_LIMIT = 1.15;
/** First-person looks further up/down than the orbit rig allows. */
export const FIRST_PERSON_PITCH_LIMIT = 1.5;

/** Zoom distance the shoulder offsets below were authored against. */
const CAMERA_REF_ZOOM = 7.4;
/** Shoulder offsets at the reference zoom; both scale with the zoom ratio. */
const SHOULDER_UP_METERS = 3.2;
const SHOULDER_RIGHT_METERS = 0.75;
/** Pushes the character further off-center as the camera zooms in past ref. */
const CLOSE_ZOOM_SHOULDER_BONUS_METERS = 0.18;
/** Look-at height on the character, roughly upper chest. */
const TARGET_UP_METERS = 1.75;

export interface OrbitCamera {
  forward: Vec3;
  pitchRadians: number;
  right: Vec3;
  up: Vec3;
}

export interface CharacterCameraRig {
  positionOffset: Vec3;
  targetOffset: Vec3;
}

function clamp(value: number, min: number, max: number): number {
  return Math.max(min, Math.min(max, value));
}

/** Orbit frame for a planet-surface position; pitch is clamped, not wrapped. */
export function resolveOrbitCamera(
  position: Vec3,
  yawRadians: number,
  pitchRadians: number,
  pitchLimit: number = ORBIT_PITCH_LIMIT,
): OrbitCamera {
  const up = radialUp(position);
  const planarForward = forwardFromYaw(position, yawRadians);
  const right = normalize(cross(planarForward, up));
  const clampedPitch = clamp(pitchRadians, -pitchLimit, pitchLimit);
  return {
    forward: normalize(rotateAroundAxis(planarForward, right, clampedPitch)),
    pitchRadians: clampedPitch,
    right,
    up,
  };
}

/** Camera position/target offsets from the character's feet, in world space. */
export function resolveCharacterCameraRig(
  orbit: OrbitCamera,
  zoomDistance: number,
): CharacterCameraRig {
  const zoomRatio = clamp(zoomDistance / CAMERA_REF_ZOOM, 0.22, 1.35);
  const closeZoom01 = 1 - clamp(zoomDistance / CAMERA_REF_ZOOM, 0, 1);
  const shoulderUp = SHOULDER_UP_METERS * zoomRatio;
  const shoulderRight =
    SHOULDER_RIGHT_METERS * Math.sqrt(zoomRatio)
    + CLOSE_ZOOM_SHOULDER_BONUS_METERS * closeZoom01;

  return {
    positionOffset: add(
      add(
        scale(orbit.forward, -zoomDistance),
        scale(orbit.right, shoulderRight),
      ),
      scale(orbit.up, shoulderUp),
    ),
    targetOffset: add(
      scale(orbit.right, shoulderRight),
      scale(orbit.up, TARGET_UP_METERS),
    ),
  };
}
