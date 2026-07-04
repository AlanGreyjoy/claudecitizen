import {
  add,
  cross,
  dot,
  length,
  lerp,
  normalize,
  rotateAroundAxis,
  scale,
  sub,
  vec3,
} from '../math/vec3';
import {
  altitudeForPosition,
  eastVector,
  radialUp,
  surfacePointFromPosition,
} from '../world/coordinates';
import { sampleRenderablePlanetSurface } from '../world/planet_surface';
import { getStationFrame, sampleHangarRest, worldToStationLocal } from '../world/station';
import { getShipRestHeightMeters } from '../player/ship_layout';
import type { FlightBody, FlightInput, Planet, Vec3 } from '../types';
import { FLIGHT_CONFIG } from './flight_config';

function hasActiveThrust(input: FlightInput): boolean {
  return (
    Math.abs(input.throttle01 ?? 0) > 0.02 ||
    Math.abs(input.lift01 ?? 0) > 0.02 ||
    Math.abs(input.strafe01 ?? 0) > 0.02 ||
    (input.boost01 ?? 0) > 0
  );
}

function orthonormalFrame(forward: Vec3, upHint: Vec3, fallbackUp: Vec3) {
  let normalizedForward = normalize(forward);
  let right = cross(normalizedForward, upHint);
  if (length(right) < 1e-6) right = cross(normalizedForward, fallbackUp);
  if (length(right) < 1e-6) right = cross(normalizedForward, vec3(0, 1, 0));
  right = normalize(right);
  const up = normalize(cross(right, normalizedForward));
  normalizedForward = normalize(sub(normalizedForward, scale(up, dot(normalizedForward, up))));
  return {
    forward: normalizedForward,
    right,
    up,
  };
}

export function createFlightBody(
  position: Vec3,
  forward: Vec3 = vec3(1, 0, 0),
  upHint: Vec3 = radialUp(position),
): FlightBody {
  const gravityUp = radialUp(position);
  const planarForward = sub(forward, scale(gravityUp, dot(forward, gravityUp)));
  const frame = orthonormalFrame(
    length(planarForward) < 1e-6 ? eastVector(position) : planarForward,
    upHint,
    gravityUp,
  );
  return {
    forward: frame.forward,
    grounded: true,
    position,
    up: frame.up,
    velocity: vec3(0, 0, 0),
  };
}

export interface FlightIntegrateOptions {
  /** Per-ship max speed cap; defaults to FLIGHT_CONFIG when omitted. */
  maxSpeedMps?: number;
}

export function integrateFlightBody(
  body: FlightBody,
  input: FlightInput,
  dt: number,
  planet: Planet,
  seed: number,
  options?: FlightIntegrateOptions,
): FlightBody {
  const gravityUp = radialUp(body.position);
  let frame = orthonormalFrame(body.forward, body.up ?? gravityUp, gravityUp);
  let { forward, right, up } = frame;

  const yawRate = (input.yaw01 ?? 0) * FLIGHT_CONFIG.YAW_RATE * dt;
  const pitchRate = (input.pitch01 ?? 0) * FLIGHT_CONFIG.PITCH_RATE * dt;
  const rollRate = (input.roll01 ?? 0) * FLIGHT_CONFIG.ROLL_RATE * dt;
  if (Math.abs(yawRate) > 0) {
    forward = normalize(rotateAroundAxis(forward, up, -yawRate));
  }
  if (Math.abs(pitchRate) > 0) {
    forward = normalize(rotateAroundAxis(forward, right, pitchRate));
    up = normalize(rotateAroundAxis(up, right, pitchRate));
  }
  if (Math.abs(rollRate) > 0) {
    up = normalize(rotateAroundAxis(up, forward, rollRate));
  }
  frame = orthonormalFrame(forward, up, gravityUp);
  forward = frame.forward;
  right = frame.right;
  up = frame.up;

  const currentSurface = sampleRenderablePlanetSurface(planet, seed, body.position);
  let grounded =
    body.grounded ?? currentSurface.altitudeMeters <= FLIGHT_CONFIG.GROUNDED_ALTITUDE_METERS;
  if (grounded && (input.lift01 ?? 0) > FLIGHT_CONFIG.TAKEOFF_LIFT_THRESHOLD) {
    grounded = false;
  }

  const altitudeMeters = altitudeForPosition(body.position, planet.radiusMeters);
  const atmosphereFactor = Math.max(
    0,
    1 - Math.max(0, altitudeMeters) / planet.atmosphereHeightMeters,
  );
  const inAtmosphere = atmosphereFactor > FLIGHT_CONFIG.SPACE_ATMOSPHERE_THRESHOLD;
  const speed = length(body.velocity);
  const autoLevelFactor =
    atmosphereFactor *
    Math.max(0, 1 - Math.abs(input.roll01 ?? 0)) *
    Math.max(0, 1 - Math.abs(input.yaw01 ?? 0) * 0.4);
  if (autoLevelFactor > 0) {
    up = normalize(lerp(up, gravityUp, Math.min(0.9, autoLevelFactor * dt * 0.8)));
    frame = orthonormalFrame(forward, up, gravityUp);
    forward = frame.forward;
    right = frame.right;
    up = frame.up;
  }

  const boostFactor = 1 + (input.boost01 ?? 0) * FLIGHT_CONFIG.BOOST_FACTOR;
  const forwardAccel = scale(
    forward,
    (input.throttle01 ?? 0) * FLIGHT_CONFIG.THROTTLE_ACCEL * boostFactor * dt,
  );
  const liftAccelMag = grounded ? FLIGHT_CONFIG.GROUND_LIFT_ACCEL : FLIGHT_CONFIG.LIFT_ACCEL;
  const liftDirection = grounded ? up : gravityUp;
  const liftAccel = scale(liftDirection, (input.lift01 ?? 0) * liftAccelMag * dt);
  const strafeAccel = scale(right, (input.strafe01 ?? 0) * FLIGHT_CONFIG.STRAFE_ACCEL * dt);
  const applyGravity = grounded;
  const gravityAccel = applyGravity
    ? scale(gravityUp, -(planet.gravityMetersPerSecond2 ?? 9.8) * dt)
    : vec3(0, 0, 0);
  const dragCoefficient = (planet.dragSeaLevel ?? 0.015) * atmosphereFactor;
  let dragAccel =
    speed > 1e-6
      ? inAtmosphere
        ? scale(
            normalize(body.velocity),
            -dragCoefficient *
              FLIGHT_CONFIG.ATMOSPHERE_DRAG_MULTIPLIER *
              speed *
              speed *
              dt,
          )
        : scale(body.velocity, -dragCoefficient * FLIGHT_CONFIG.SPACE_DRAG_MULTIPLIER * dt)
      : vec3(0, 0, 0);
  if (!grounded && inAtmosphere && !hasActiveThrust(input) && speed > 1e-6) {
    dragAccel = add(
      dragAccel,
      scale(body.velocity, -FLIGHT_CONFIG.ATMOSPHERE_HOVER_DAMPING * atmosphereFactor * dt),
    );
  }
  const brakeAccel =
    speed > 1e-6
      ? scale(normalize(body.velocity), -(input.brake01 ?? 0) * FLIGHT_CONFIG.BRAKE_ACCEL * dt)
      : vec3(0, 0, 0);

  let velocity = body.velocity;
  velocity = add(velocity, gravityAccel);
  velocity = add(velocity, forwardAccel);
  velocity = add(velocity, liftAccel);
  velocity = add(velocity, strafeAccel);
  velocity = add(velocity, dragAccel);
  velocity = add(velocity, brakeAccel);

  const maxSpeed =
    options?.maxSpeedMps ?? FLIGHT_CONFIG.MAX_SPEED_METERS_PER_SECOND;
  const finalSpeed = length(velocity);
  if (finalSpeed > maxSpeed) {
    velocity = scale(normalize(velocity), maxSpeed);
  }

  let position = add(body.position, scale(velocity, dt));

  const nextSurface = sampleRenderablePlanetSurface(planet, seed, position);
  if (nextSurface.altitudeMeters < 0) {
    position = surfacePointFromPosition(position, nextSurface.surfaceRadiusMeters);
    const normal = nextSurface.normal ?? radialUp(position);
    const inwardSpeed = dot(velocity, normal);
    if (inwardSpeed < 0) velocity = sub(velocity, scale(normal, inwardSpeed));
    up = normal;
    frame = orthonormalFrame(forward, up, normal);
    forward = frame.forward;
    up = frame.up;
    grounded = true;
  }

  // Station hangar decks act as landing surfaces: settle onto the pad at
  // gear-rest height instead of falling through toward the planet.
  const stationFrame = getStationFrame(planet);
  const hangarRest = sampleHangarRest(stationFrame, position, getShipRestHeightMeters());
  if (hangarRest) {
    const localUp = worldToStationLocal(stationFrame, position).up;
    if (localUp <= hangarRest.restUp) {
      position = add(position, scale(stationFrame.up, hangarRest.restUp - localUp));
      const inwardSpeed = dot(velocity, stationFrame.up);
      if (inwardSpeed < 0) velocity = sub(velocity, scale(stationFrame.up, inwardSpeed));
      up = stationFrame.up;
      frame = orthonormalFrame(forward, up, stationFrame.up);
      forward = frame.forward;
      up = frame.up;
      grounded = true;
    }
  }

  return {
    forward,
    grounded,
    position,
    up,
    velocity,
  };
}

/** Hold ship position with no pilot input (deck walk / transition). */
export function integrateHoveringShip(
  body: FlightBody,
  dt: number,
  planet: Planet,
  seed: number,
  options?: FlightIntegrateOptions,
): FlightBody {
  return integrateFlightBody(body, {}, dt, planet, seed, options);
}
