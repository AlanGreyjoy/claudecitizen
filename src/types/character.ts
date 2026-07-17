import type { Vec3 } from './math';

export interface CharacterInput {
  cameraPitchRadians?: number;
  cameraYawRadians?: number;
  cameraZoomDistance?: number;
  /** First person: keep the body aligned with the camera yaw instead of the move direction. */
  faceCameraYaw?: boolean;
  moveX?: number;
  moveY?: number;
  sprint?: boolean;
  jumpPressed?: boolean;
}

export type JumpPhase = 'grounded' | 'jump-start' | 'jump-loop' | 'jump-land';

export interface CharacterState {
  animation: string;
  forward: Vec3;
  grounded: boolean;
  jumpPhase: JumpPhase;
  jumpPhaseTime: number;
  position: Vec3;
  up: Vec3;
  velocity: Vec3;
}

export interface Pose {
  forward: Vec3;
  position: Vec3;
  up: Vec3;
}

export interface LocalOffset {
  right: number;
  up: number;
  forward: number;
}

export interface CameraOrbit {
  pitchRadians: number;
  yawRadians: number;
  zoomDistance: number;
}

/** Cockpit free-look offset while seated (ship-relative yaw/pitch). */
export interface SeatLook {
  pitchRadians: number;
  yawRadians: number;
}

export type CameraView = 'first-person' | 'third-person';

/** Piloting camera: seated cockpit eye or external chase view. */
export type ShipCameraView = 'cockpit' | 'external';

export type GameMode =
  | 'on-foot'
  | 'entering-ship'
  | 'in-ship'
  | 'on-ship-deck'
  | 'leaving-pilot'
  | 'entering-bed'
  | 'in-bed'
  | 'leaving-bed'
  | 'in-station'
  | 'riding-elevator';

export interface CharacterRenderState {
  animation: string;
  forward: Vec3;
  position: Vec3;
  up: Vec3;
}
