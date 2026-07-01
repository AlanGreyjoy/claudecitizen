const SPEED_MULTIPLIER = 1.4;

export const FLIGHT_CONFIG = {
  THROTTLE_ACCEL: 220 * SPEED_MULTIPLIER,
  /** VTOL lift/descend while grounded — gentle so a tap of Space clears the pad only. */
  GROUND_LIFT_ACCEL: 42,
  /** Lift/descend while airborne — full VTOL authority for climb and landing. */
  LIFT_ACCEL: 150 * SPEED_MULTIPLIER,
  STRAFE_ACCEL: 120 * SPEED_MULTIPLIER,
  BRAKE_ACCEL: 280 * SPEED_MULTIPLIER,
  BOOST_FACTOR: 1.2,
  YAW_RATE: 1.15,
  PITCH_RATE: 1.0,
  ROLL_RATE: 1.5,
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
  /** Hard cap on ship velocity magnitude (m/s). */
  MAX_SPEED_METERS_PER_SECOND: 100,
} as const;
