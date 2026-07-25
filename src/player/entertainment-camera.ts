import { add, length, normalize, scale, sub } from "../math/vec3";
import type { Vec3 } from "../types";

/**
 * Star Citizen–style bunk-screen focus: narrow FOV + dolly toward the
 * entertainment panel while it is open or under gaze.
 */

/** How far FOV closes at full focus (degrees). */
export const ES_FOCUS_FOV_IN_DEG = 16;
/** Fraction of the eye→screen distance to dolly in at full focus. */
export const ES_FOCUS_DOLLY_FRACTION = 0.38;
/** Focus blend rate (1/s). */
export const ES_FOCUS_BLEND_PER_SEC = 5.5;
/**
 * Gaze must be this aligned with the screen direction (dot) to count as
 * looking at the panel while it is off / closing.
 */
export const ES_FOCUS_GAZE_DOT = 0.72;

export interface EntertainmentCameraState {
  focus01: number;
}

export interface EntertainmentCameraFeel {
  /** Delta from base FOV (degrees; negative = zoom in). */
  fovDeltaDeg: number;
  /** World-space eye after dolly. */
  eye: Vec3;
  /** World-space look target (toward / through the screen). */
  lookTarget: Vec3;
}

export function createEntertainmentCameraState(): EntertainmentCameraState {
  return { focus01: 0 };
}

function expBlend(current: number, target: number, rate: number, dt: number): number {
  if (dt <= 0 || rate <= 0) return current;
  const t = 1 - Math.exp(-rate * dt);
  return current + (target - current) * t;
}

/**
 * Updates focus and returns the camera feel for this frame when focus is
 * active. Returns null at focus 0 so callers can keep their normal cameras
 * (critical on station — a zero-focus feel would pin the eye at character
 * height and kill over-the-shoulder scroll zoom).
 * Pass `dt` even while the sim is paused so open/close can ease.
 */
export function updateEntertainmentCameraFeel(
  state: EntertainmentCameraState,
  options: {
    dt: number;
    /** ES UI currently open. */
    open: boolean;
    /** Gaze currently hits this entertainment marker. */
    gazing: boolean;
    eye: Vec3;
    screen: Vec3;
    viewForward: Vec3;
  },
): EntertainmentCameraFeel | null {
  const toScreen = sub(options.screen, options.eye);
  const distance = length(toScreen);
  const toward = distance > 1e-4 ? scale(toScreen, 1 / distance) : options.viewForward;
  const view = normalize(options.viewForward);
  const aligned = Math.max(0, toward.x * view.x + toward.y * view.y + toward.z * view.z);

  let target = 0;
  if (options.open) {
    target = 1;
  } else if (options.gazing && aligned >= ES_FOCUS_GAZE_DOT) {
    // Soft ramp from gaze threshold → 1 as alignment improves.
    target = Math.min(
      1,
      (aligned - ES_FOCUS_GAZE_DOT) / (1 - ES_FOCUS_GAZE_DOT) + 0.35,
    );
  }

  state.focus01 = expBlend(
    state.focus01,
    target,
    ES_FOCUS_BLEND_PER_SEC,
    options.dt,
  );
  if (state.focus01 < 0.001) state.focus01 = 0;
  if (state.focus01 > 0.999 && target >= 1) state.focus01 = 1;

  const focus = state.focus01;
  if (focus <= 0) return null;

  const dolly = Math.min(distance * ES_FOCUS_DOLLY_FRACTION, Math.max(0, distance - 0.25));
  const eye = add(options.eye, scale(toward, dolly * focus));
  const freeLookTarget = add(options.eye, scale(view, 60));
  const screenLookTarget = add(options.screen, scale(toward, 0.35));
  const lookTarget = add(
    scale(freeLookTarget, 1 - focus),
    scale(screenLookTarget, focus),
  );

  return {
    fovDeltaDeg: -ES_FOCUS_FOV_IN_DEG * focus,
    eye,
    lookTarget,
  };
}
