import type { Vec3 } from './math';

export interface FlightBody {
  forward: Vec3;
  grounded: boolean;
  position: Vec3;
  up: Vec3;
  velocity: Vec3;
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
