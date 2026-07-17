const SPEED_MULTIPLIER = 1.4;

export const FLIGHT_CONFIG = {
  THROTTLE_ACCEL: 220 * SPEED_MULTIPLIER,
  /** VTOL lift/descend while grounded — gentle so a tap of Space clears the pad only. */
  GROUND_LIFT_ACCEL: 42,
  /** Lift/descend while airborne — full VTOL authority for climb and landing. */
  LIFT_ACCEL: 150 * SPEED_MULTIPLIER,
  STRAFE_ACCEL: 120 * SPEED_MULTIPLIER,
  BRAKE_ACCEL: 280 * SPEED_MULTIPLIER,
  /**
   * Boost multiplies forward thrust by `(1 + BOOST_FACTOR)` and raises the
   * speed cap the same way while Shift is held.
   */
  BOOST_FACTOR: 1.2,
  /** Legacy rate defaults (rad/s) used to seed torque defaults. */
  YAW_RATE: 1.15,
  PITCH_RATE: 1.0,
  ROLL_RATE: 1.5,
  /** Scalar inertia ≈ massKg * INERTIA_FACTOR (kg·m²). */
  INERTIA_FACTOR: 40,
  TAKEOFF_LIFT_THRESHOLD: 0.05,
  GROUNDED_ALTITUDE_METERS: 1.5,
  /** Below this atmosphere factor the ship is treated as in vacuum (hover, low drag). */
  SPACE_ATMOSPHERE_THRESHOLD: 0.02,
  /** Quadratic drag scale in atmosphere — bleeds speed quickly when throttle is released. */
  ATMOSPHERE_DRAG_MULTIPLIER: 0.05,
  /** Residual linear drag multiplier outside the atmosphere. */
  SPACE_DRAG_MULTIPLIER: 0.05,
  /** Linear damping when airborne in atmosphere with no thrust — settles hover in place. */
  ATMOSPHERE_HOVER_DAMPING: 4.5,
  /** Coupled-mode velocity bleed (1/s) when no thrust is applied. */
  COUPLED_DAMPING: 2.8,
  /** Hard cap on ship velocity magnitude (m/s). */
  MAX_SPEED_METERS_PER_SECOND: 100,
  /** Mouse aim cone half-angle from ship forward (radians). */
  AIM_CONE_HALF_ANGLE_RAD: 0.55,
  /** IFCS proportional gain: aim angular error → torque demand. */
  AIM_IFCS_GAIN: 2.15,
  /** IFCS derivative gain: bleed angular rate while tracking aim (stops bounce). */
  AIM_IFCS_DAMPING: 1.0,
  /** Aim error deadzone (radians-ish via cross magnitude) — no torque when aligned. */
  AIM_ERROR_DEADZONE: 0.01,
  /** Mouse radians per pixel at sensitivity 1.0. */
  AIM_MOUSE_RAD_PER_PX: 0.0009,
  /** Angular velocity damping toward zero (1/s) — always on, stronger settles. */
  ANGULAR_DAMPING: 3.6,
} as const;

/** Absolute top speed when boosting (bar scale / instrument ceiling). */
export function resolveBoostMaxSpeedMps(maxSpeedMps: number): number {
  return maxSpeedMps * (1 + FLIGHT_CONFIG.BOOST_FACTOR);
}

/** Hard speed cap for the current boost input (0 = SCM, 1 = full boost). */
export function resolveSpeedCapMps(
  maxSpeedMps: number,
  boost01 = 0,
): number {
  const boost = Math.max(0, Math.min(1, boost01));
  return maxSpeedMps * (1 + boost * FLIGHT_CONFIG.BOOST_FACTOR);
}
