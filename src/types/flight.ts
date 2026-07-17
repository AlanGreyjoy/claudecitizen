import type { Vec3 } from './math';

export interface FlightBody {
  forward: Vec3;
  grounded: boolean;
  position: Vec3;
  up: Vec3;
  velocity: Vec3;
  /**
   * Ship-local angular velocity (rad/s):
   * x = pitch, y = yaw, z = roll. Optional for network snapshots.
   */
  angularVelocity?: Vec3;
}

export interface FlightInput {
  brake01?: number;
  boost01?: number;
  lift01?: number;
  pitch01?: number;
  roll01?: number;
  strafe01?: number;
  throttle01?: number;
  yaw01?: number;
}

/** Persistent mouse aim offset from ship forward (radians). */
export interface FlightAimState {
  pitchRadians: number;
  yawRadians: number;
}
