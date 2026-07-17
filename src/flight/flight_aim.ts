import { add, cross, normalize, rotateAroundAxis, scale } from '../math/vec3';
import { FLIGHT_CONFIG } from './flight_config';
import type { FlightAimState, FlightBody, Vec3 } from '../types';

const AIM_HALF = FLIGHT_CONFIG.AIM_CONE_HALF_ANGLE_RAD;

function clamp(value: number, min: number, max: number): number {
  return Math.max(min, Math.min(max, value));
}

function clampUnit(value: number): number {
  return clamp(value, -1, 1);
}

function dot3(a: Vec3, b: Vec3): number {
  return a.x * b.x + a.y * b.y + a.z * b.z;
}

export function createFlightAimState(): FlightAimState {
  return { pitchRadians: 0, yawRadians: 0 };
}

export function clampAimState(aim: FlightAimState): FlightAimState {
  return {
    pitchRadians: clamp(aim.pitchRadians, -AIM_HALF, AIM_HALF),
    yawRadians: clamp(aim.yawRadians, -AIM_HALF, AIM_HALF),
  };
}

/**
 * Cockpit free-look direction: yaw/pitch offsets from ship forward/up
 * (same basis as main-play seat look / dual-reticle projection).
 */
export function resolveSeatLookForward(
  shipForward: Vec3,
  shipUp: Vec3,
  yawRadians: number,
  pitchRadians: number,
  pitchLimit = 1.2,
): { forward: Vec3; right: Vec3; up: Vec3 } {
  const orbit = resolveDeckCameraOrbit(
    shipForward,
    shipUp,
    yawRadians,
    pitchRadians,
    pitchLimit,
  );
  // Free-look camera.up follows the view; deck walk keeps ship.up instead.
  const lookUp = normalize(cross(orbit.right, orbit.forward));
  return { forward: orbit.forward, right: orbit.right, up: lookUp };
}

/**
 * On-deck / chase orbit relative to the ship frame. `up` stays the deck normal
 * (ship.up) so a pitched hull leans the camera with the floor.
 */
export function resolveDeckCameraOrbit(
  shipForward: Vec3,
  shipUp: Vec3,
  yawRadians: number,
  pitchRadians: number,
  pitchLimit = 1.2,
): { forward: Vec3; pitchRadians: number; right: Vec3; up: Vec3 } {
  const up = normalize(shipUp);
  const deckForward = normalize(shipForward);
  const deckRight = normalize(cross(deckForward, up));
  const deckYaw = -yawRadians;
  const planarForward = normalize(
    add(
      scale(deckForward, Math.cos(deckYaw)),
      scale(deckRight, Math.sin(deckYaw)),
    ),
  );
  const right = normalize(cross(planarForward, up));
  const clampedPitch = clamp(pitchRadians, -pitchLimit, pitchLimit);
  const forward = normalize(rotateAroundAxis(planarForward, right, clampedPitch));
  return { forward, pitchRadians: clampedPitch, right, up };
}

/** World-space aim direction from ship frame + aim offsets. */
export function resolveAimForward(body: FlightBody, aim: FlightAimState): Vec3 {
  const right = normalize(cross(body.forward, body.up));
  let forward = body.forward;
  // Positive yaw = aim to ship-right; positive pitch = aim up about ship-right.
  if (Math.abs(aim.yawRadians) > 1e-6) {
    forward = normalize(rotateAroundAxis(forward, body.up, -aim.yawRadians));
  }
  if (Math.abs(aim.pitchRadians) > 1e-6) {
    forward = normalize(rotateAroundAxis(forward, right, aim.pitchRadians));
  }
  return forward;
}

/**
 * IFCS pitch/yaw demand (−1…1) to turn the nose toward a world aim direction.
 * PD: proportional on aim error, derivative on current angular rate (kills bounce).
 */
export function aimTorqueDemand01(
  body: FlightBody,
  aimForward: Vec3,
  gain = FLIGHT_CONFIG.AIM_IFCS_GAIN,
  damping = FLIGHT_CONFIG.AIM_IFCS_DAMPING,
): { pitch01: number; yaw01: number } {
  const right = normalize(cross(body.forward, body.up));
  const aim = normalize(aimForward);
  const errorAxis = cross(body.forward, aim);
  const pitchErr = dot3(errorAxis, right);
  const yawErr = -dot3(errorAxis, body.up);
  const dead = FLIGHT_CONFIG.AIM_ERROR_DEADZONE;

  const wx = body.angularVelocity?.x ?? 0;
  const wy = body.angularVelocity?.y ?? 0;

  let pitch01 = 0;
  let yaw01 = 0;
  if (Math.abs(pitchErr) > dead) {
    pitch01 = pitchErr * gain - wx * damping;
  } else {
    // Near aligned: only brake residual pitch rate.
    pitch01 = -wx * damping * 1.4;
  }
  if (Math.abs(yawErr) > dead) {
    yaw01 = yawErr * gain - wy * damping;
  } else {
    yaw01 = -wy * damping * 1.4;
  }

  return {
    pitch01: clampUnit(pitch01),
    yaw01: clampUnit(yaw01),
  };
}

export function applyMouseDeltaToAim(
  aim: FlightAimState,
  movementX: number,
  movementY: number,
  sensitivity: number,
  invertY: boolean,
): FlightAimState {
  const pitchSign = invertY ? 1 : -1;
  const radPerPx = FLIGHT_CONFIG.AIM_MOUSE_RAD_PER_PX * sensitivity;
  // Mouse right → aim yaw right (ship-right); mouse up → pitch (invertY respected).
  return clampAimState({
    yawRadians: aim.yawRadians + movementX * radPerPx,
    pitchRadians: aim.pitchRadians + movementY * pitchSign * radPerPx,
  });
}

/**
 * As the nose catches the aim point, bleed aim offsets so the cone recenters
 * on the new forward (SC-style sticky aim without unbounded drift).
 */
export function recenterAimAsNoseTracks(
  aim: FlightAimState,
  body: FlightBody,
  previousForward: Vec3,
): FlightAimState {
  const right = normalize(cross(previousForward, body.up));
  const delta = cross(previousForward, body.forward);
  const dPitch = dot3(delta, right);
  const dYaw = -dot3(delta, body.up);
  return clampAimState({
    pitchRadians: aim.pitchRadians - dPitch,
    yawRadians: aim.yawRadians - dYaw,
  });
}
