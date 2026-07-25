import type { LocalOffset } from "../types";
import type { ShipSpec } from "./ship_layout";

/**
 * Cockpit flight camera feel: thrust FOV kick + smoothed boost shake.
 * Also exposes smoothed thrust/boost levels for looping SFX volume.
 */

export interface FlightCameraFeelState {
  /** Smoothed FOV delta in degrees (positive = wider). */
  fovDeltaDeg: number;
  /** Running phase for boost shake (radians). */
  shakePhase: number;
  /** Smoothed translational thrust 0..1 (throttle / strafe / lift). */
  thrust01: number;
  /** Smoothed boost amount 0..1 (drives shake, SFX volume, HUD accent). */
  boost01: number;
}

export interface FlightCameraFeelInput {
  /** Throttle axis: +1 forward, -1 reverse. */
  throttle01: number;
  /** Strafe axis: +1 right, -1 left. */
  strafe01?: number;
  /** Lift axis: +1 up, -1 down. */
  lift01?: number;
  /** Raw boost held 0..1. */
  boost01: number;
}

export interface FlightCameraFeelResult {
  fovDeltaDeg: number;
  /** Smoothed translational thrust 0..1 after fade blend. */
  thrust01: number;
  /** Smoothed boost 0..1 after fade blend. */
  boost01: number;
  /** Ship-local eye offset from boost shake. */
  eyeShake: LocalOffset;
}

export type FlightCameraFeelSpec = Pick<
  ShipSpec,
  | "thrustFovForwardDeg"
  | "thrustFovBackwardDeg"
  | "thrustFovBlendPerSec"
  | "boostShakeAmplitudeM"
  | "boostShakeHz"
  | "boostBlendPerSec"
>;

export function createFlightCameraFeelState(): FlightCameraFeelState {
  return { fovDeltaDeg: 0, shakePhase: 0, thrust01: 0, boost01: 0 };
}

function clamp(value: number, min: number, max: number): number {
  return Math.max(min, Math.min(max, value));
}

function expBlend(current: number, target: number, ratePerSec: number, dt: number): number {
  const alpha = 1 - Math.exp(-Math.max(0.5, ratePerSec) * Math.max(0, dt));
  return current + (target - current) * alpha;
}

/** Advance FOV blend + thrust/boost fade/shake; returns presentation deltas. */
export function updateFlightCameraFeel(
  state: FlightCameraFeelState,
  input: FlightCameraFeelInput,
  spec: FlightCameraFeelSpec,
  dt: number,
): FlightCameraFeelResult {
  const throttle = clamp(input.throttle01, -1, 1);
  const strafe = clamp(input.strafe01 ?? 0, -1, 1);
  const lift = clamp(input.lift01 ?? 0, -1, 1);
  // Any translational thruster input drives thrust SFX (W/S, A/D, Space/C).
  const thrustTarget = Math.min(
    1,
    Math.hypot(throttle, strafe, lift),
  );
  const boostTarget = clamp(input.boost01, 0, 1);
  const targetFov =
    throttle >= 0
      ? throttle * Math.max(0, spec.thrustFovForwardDeg)
      : throttle * Math.max(0, spec.thrustFovBackwardDeg);

  state.fovDeltaDeg = expBlend(
    state.fovDeltaDeg,
    targetFov,
    spec.thrustFovBlendPerSec,
    dt,
  );
  state.thrust01 = expBlend(
    state.thrust01,
    thrustTarget,
    spec.thrustFovBlendPerSec,
    dt,
  );
  if (state.thrust01 < 1e-4 && thrustTarget <= 0) state.thrust01 = 0;

  state.boost01 = expBlend(
    state.boost01,
    boostTarget,
    spec.boostBlendPerSec,
    dt,
  );
  if (state.boost01 < 1e-4 && boostTarget <= 0) state.boost01 = 0;

  const amp = Math.max(0, spec.boostShakeAmplitudeM) * state.boost01;
  const hz = Math.max(1, spec.boostShakeHz);
  if (state.boost01 > 1e-4) {
    state.shakePhase += Math.max(0, dt) * hz * Math.PI * 2;
  }

  let eyeShake: LocalOffset = { right: 0, up: 0, forward: 0 };
  if (amp > 1e-6) {
    const phase = state.shakePhase;
    eyeShake = {
      right: Math.sin(phase) * amp,
      up: Math.cos(phase * 1.37) * amp * 0.75,
      forward: Math.sin(phase * 0.71) * amp * 0.35,
    };
  }

  return {
    fovDeltaDeg: state.fovDeltaDeg,
    thrust01: state.thrust01,
    boost01: state.boost01,
    eyeShake,
  };
}
