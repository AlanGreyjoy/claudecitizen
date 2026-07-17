import {
  add,
  cross,
  dot,
  length,
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
import { getShipRestHeightMeters, type ShipSpec } from '../player/ship_layout';
import type { FlightBody, FlightInput, Planet, Vec3 } from '../types';
import { FLIGHT_CONFIG, resolveSpeedCapMps } from './flight_config';
import { aimTorqueDemand01 } from './flight_aim';

export function flightOptionsFromSpec(
  spec: Pick<
    ShipSpec,
    | 'maxSpeedMps'
    | 'massKg'
    | 'maxAngularRateRadps'
    | 'forwardThrustN'
    | 'backwardThrustN'
    | 'verticalThrustN'
    | 'lateralThrustN'
    | 'pitchTorqueNm'
    | 'yawTorqueNm'
    | 'rollTorqueNm'
    | 'throttleAccelMps2'
  >,
  extras?: { coupled?: boolean; aimForward?: Vec3 },
): FlightStatsOptions {
  return {
    maxSpeedMps: spec.maxSpeedMps,
    massKg: spec.massKg,
    maxAngularRateRadps: spec.maxAngularRateRadps,
    forwardThrustN: spec.forwardThrustN,
    backwardThrustN: spec.backwardThrustN,
    verticalThrustN: spec.verticalThrustN,
    lateralThrustN: spec.lateralThrustN,
    pitchTorqueNm: spec.pitchTorqueNm,
    yawTorqueNm: spec.yawTorqueNm,
    rollTorqueNm: spec.rollTorqueNm,
    throttleAccelMps2: spec.throttleAccelMps2,
    coupled: extras?.coupled,
    aimForward: extras?.aimForward,
  };
}

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
    angularVelocity: vec3(0, 0, 0),
    forward: frame.forward,
    grounded: true,
    position,
    up: frame.up,
    velocity: vec3(0, 0, 0),
  };
}

export interface FlightStatsOptions {
  maxSpeedMps?: number;
  massKg?: number;
  maxAngularRateRadps?: number;
  forwardThrustN?: number;
  backwardThrustN?: number;
  verticalThrustN?: number;
  lateralThrustN?: number;
  pitchTorqueNm?: number;
  yawTorqueNm?: number;
  rollTorqueNm?: number;
  /** Legacy: used only when forwardThrustN is omitted. */
  throttleAccelMps2?: number;
  /** Coupled IFCS bleeds velocity when no thrust. Default true. */
  coupled?: boolean;
  /** World-space aim direction for IFCS turn-to-aim. */
  aimForward?: Vec3;
}

/** @deprecated Use FlightStatsOptions — kept as alias for call sites. */
export type FlightIntegrateOptions = FlightStatsOptions;

export interface FlatFlightEnvironment {
  kind: 'flat';
  gravityMps2: number;
  groundY: number;
  restHeightMeters: number;
  atmosphereHeightMeters: number;
  dragSeaLevel?: number;
}

export interface PlanetFlightEnvironment {
  kind: 'planet';
  planet: Planet;
  seed: number;
}

export type FlightEnvironment = FlatFlightEnvironment | PlanetFlightEnvironment;

function resolveThrustStats(options?: FlightStatsOptions) {
  const massKg = Math.max(1, options?.massKg ?? 12_000);
  const forwardThrustN =
    options?.forwardThrustN ??
    (options?.throttleAccelMps2 ?? FLIGHT_CONFIG.THROTTLE_ACCEL) * massKg;
  return {
    massKg,
    maxSpeedMps:
      options?.maxSpeedMps ?? FLIGHT_CONFIG.MAX_SPEED_METERS_PER_SECOND,
    maxAngularRateRadps: options?.maxAngularRateRadps ?? 0.85,
    forwardThrustN,
    backwardThrustN: options?.backwardThrustN ?? forwardThrustN * 0.6,
    verticalThrustN:
      options?.verticalThrustN ?? FLIGHT_CONFIG.LIFT_ACCEL * massKg,
    lateralThrustN:
      options?.lateralThrustN ?? FLIGHT_CONFIG.STRAFE_ACCEL * massKg,
    pitchTorqueNm:
      options?.pitchTorqueNm ??
      FLIGHT_CONFIG.PITCH_RATE * 2 * massKg * FLIGHT_CONFIG.INERTIA_FACTOR,
    yawTorqueNm:
      options?.yawTorqueNm ??
      FLIGHT_CONFIG.YAW_RATE * 2 * massKg * FLIGHT_CONFIG.INERTIA_FACTOR,
    rollTorqueNm:
      options?.rollTorqueNm ??
      FLIGHT_CONFIG.ROLL_RATE * 2.2 * massKg * FLIGHT_CONFIG.INERTIA_FACTOR,
    coupled: options?.coupled !== false,
    aimForward: options?.aimForward,
  };
}

function integrateOrientation(
  body: FlightBody,
  input: FlightInput,
  dt: number,
  stats: ReturnType<typeof resolveThrustStats>,
  gravityUp: Vec3,
): { forward: Vec3; right: Vec3; up: Vec3; angularVelocity: Vec3 } {
  let frame = orthonormalFrame(body.forward, body.up ?? gravityUp, gravityUp);
  let { forward, right, up } = frame;
  const inertia = Math.max(1, stats.massKg * FLIGHT_CONFIG.INERTIA_FACTOR);

  let pitchDemand = input.pitch01 ?? 0;
  let yawDemand = input.yaw01 ?? 0;
  const rollDemand = input.roll01 ?? 0;

  if (stats.aimForward) {
    const aim = aimTorqueDemand01({ ...body, forward, up }, stats.aimForward);
    pitchDemand = Math.max(-1, Math.min(1, pitchDemand + aim.pitch01));
    yawDemand = Math.max(-1, Math.min(1, yawDemand + aim.yaw01));
  }

  const torqueX = pitchDemand * stats.pitchTorqueNm;
  const torqueY = yawDemand * stats.yawTorqueNm;
  const torqueZ = rollDemand * stats.rollTorqueNm;

  let wx = (body.angularVelocity?.x ?? 0) + (torqueX / inertia) * dt;
  let wy = (body.angularVelocity?.y ?? 0) + (torqueY / inertia) * dt;
  let wz = (body.angularVelocity?.z ?? 0) + (torqueZ / inertia) * dt;

  // Always damp angular velocity so IFCS can't ring; stronger when demand is idle.
  const demandMag =
    Math.abs(pitchDemand) + Math.abs(yawDemand) + Math.abs(rollDemand);
  const dampRate =
    FLIGHT_CONFIG.ANGULAR_DAMPING * (demandMag < 0.05 ? 1.5 : 0.4);
  const damp = Math.exp(-dampRate * dt);
  wx *= damp;
  wy *= damp;
  wz *= damp;

  const rate = Math.hypot(wx, wy, wz);
  if (rate > stats.maxAngularRateRadps) {
    const scaleRate = stats.maxAngularRateRadps / rate;
    wx *= scaleRate;
    wy *= scaleRate;
    wz *= scaleRate;
  }

  // Rebuild right after yaw so pitch uses a consistent frame for this step.
  if (Math.abs(wy) > 0) {
    forward = normalize(rotateAroundAxis(forward, up, -wy * dt));
    right = normalize(cross(forward, up));
  }
  if (Math.abs(wx) > 0) {
    forward = normalize(rotateAroundAxis(forward, right, wx * dt));
    up = normalize(rotateAroundAxis(up, right, wx * dt));
  }
  if (Math.abs(wz) > 0) {
    up = normalize(rotateAroundAxis(up, forward, wz * dt));
  }

  // No auto-level — roll/pitch attitude sticks until the pilot corrects or parks.
  frame = orthonormalFrame(forward, up, up);
  return {
    forward: frame.forward,
    right: frame.right,
    up: frame.up,
    angularVelocity: vec3(wx, wy, wz),
  };
}

function integrateLinear(
  body: FlightBody,
  input: FlightInput,
  dt: number,
  frame: { forward: Vec3; right: Vec3; up: Vec3 },
  stats: ReturnType<typeof resolveThrustStats>,
  _gravityUp: Vec3,
  _gravityMps2: number,
  atmosphereFactor: number,
  dragSeaLevel: number,
  grounded: boolean,
): { velocity: Vec3; grounded: boolean } {
  const { forward, right, up } = frame;
  const inAtmosphere = atmosphereFactor > FLIGHT_CONFIG.SPACE_ATMOSPHERE_THRESHOLD;
  const boostFactor = 1 + (input.boost01 ?? 0) * FLIGHT_CONFIG.BOOST_FACTOR;
  const throttle = input.throttle01 ?? 0;
  const forwardForce =
    throttle >= 0
      ? throttle * stats.forwardThrustN * boostFactor
      : throttle * stats.backwardThrustN;
  const liftForceMag = grounded
    ? FLIGHT_CONFIG.GROUND_LIFT_ACCEL * stats.massKg
    : stats.verticalThrustN;
  const liftForce = (input.lift01 ?? 0) * liftForceMag;
  const strafeForce = (input.strafe01 ?? 0) * stats.lateralThrustN;

  const invMass = 1 / stats.massKg;
  let accel = vec3(0, 0, 0);
  accel = add(accel, scale(forward, forwardForce * invMass));
  accel = add(accel, scale(up, liftForce * invMass));
  accel = add(accel, scale(right, strafeForce * invMass));

  let nextGrounded = grounded;
  if (grounded && (input.lift01 ?? 0) > FLIGHT_CONFIG.TAKEOFF_LIFT_THRESHOLD) {
    nextGrounded = false;
  }

  // Star Wars–style: no gravity while flying. Altitude is thruster-only (Space / C).
  // Landing still works via ground/hangar clamp when position hits rest height.

  const speed = length(body.velocity);
  const dragCoefficient = dragSeaLevel * atmosphereFactor;
  let dragAccel = vec3(0, 0, 0);
  if (speed > 1e-6) {
    dragAccel = inAtmosphere
      ? scale(
          normalize(body.velocity),
          -dragCoefficient *
            FLIGHT_CONFIG.ATMOSPHERE_DRAG_MULTIPLIER *
            speed *
            speed,
        )
      : scale(body.velocity, -dragCoefficient * FLIGHT_CONFIG.SPACE_DRAG_MULTIPLIER);
  }
  if (!nextGrounded && inAtmosphere && !hasActiveThrust(input) && speed > 1e-6) {
    dragAccel = add(
      dragAccel,
      scale(body.velocity, -FLIGHT_CONFIG.ATMOSPHERE_HOVER_DAMPING * atmosphereFactor),
    );
  }

  // Coupled IFCS: bleed velocity when no thrust (SC coupled).
  if (stats.coupled && !nextGrounded && !hasActiveThrust(input) && speed > 1e-6) {
    dragAccel = add(dragAccel, scale(body.velocity, -FLIGHT_CONFIG.COUPLED_DAMPING));
  }

  const brakeAccel =
    speed > 1e-6
      ? scale(normalize(body.velocity), -(input.brake01 ?? 0) * FLIGHT_CONFIG.BRAKE_ACCEL)
      : vec3(0, 0, 0);

  let velocity = body.velocity;
  velocity = add(velocity, scale(accel, dt));
  velocity = add(velocity, scale(dragAccel, dt));
  velocity = add(velocity, scale(brakeAccel, dt));

  const finalSpeed = length(velocity);
  const speedCap = resolveSpeedCapMps(stats.maxSpeedMps, input.boost01 ?? 0);
  if (finalSpeed > speedCap) {
    velocity = scale(normalize(velocity), speedCap);
  }

  return { velocity, grounded: nextGrounded };
}

export function integrateFlightBody(
  body: FlightBody,
  input: FlightInput,
  dt: number,
  planet: Planet,
  seed: number,
  options?: FlightStatsOptions,
): FlightBody {
  return integrateFlightInEnvironment(
    body,
    input,
    dt,
    { kind: 'planet', planet, seed },
    options,
  );
}

export function integrateSandboxFlightBody(
  body: FlightBody,
  input: FlightInput,
  dt: number,
  env: Omit<FlatFlightEnvironment, 'kind'>,
  options?: FlightStatsOptions,
): FlightBody {
  return integrateFlightInEnvironment(
    body,
    input,
    dt,
    { kind: 'flat', ...env },
    options,
  );
}

export function integrateFlightInEnvironment(
  body: FlightBody,
  input: FlightInput,
  dt: number,
  environment: FlightEnvironment,
  options?: FlightStatsOptions,
): FlightBody {
  const stats = resolveThrustStats(options);

  let gravityUp: Vec3;
  let gravityMps2: number;
  let atmosphereFactor: number;
  let dragSeaLevel: number;
  let grounded: boolean;

  if (environment.kind === 'planet') {
    const { planet, seed } = environment;
    gravityUp = radialUp(body.position);
    gravityMps2 = planet.gravityMetersPerSecond2 ?? 9.8;
    const currentSurface = sampleRenderablePlanetSurface(planet, seed, body.position);
    grounded =
      body.grounded ?? currentSurface.altitudeMeters <= FLIGHT_CONFIG.GROUNDED_ALTITUDE_METERS;
    const altitudeMeters = altitudeForPosition(body.position, planet.radiusMeters);
    atmosphereFactor = Math.max(
      0,
      1 - Math.max(0, altitudeMeters) / planet.atmosphereHeightMeters,
    );
    dragSeaLevel = planet.dragSeaLevel ?? 0.015;
  } else {
    gravityUp = vec3(0, 1, 0);
    gravityMps2 = environment.gravityMps2;
    const altitude = body.position.y - environment.groundY;
    grounded =
      body.grounded ??
      altitude <= environment.restHeightMeters + FLIGHT_CONFIG.GROUNDED_ALTITUDE_METERS;
    atmosphereFactor = Math.max(
      0,
      1 - Math.max(0, altitude) / Math.max(1, environment.atmosphereHeightMeters),
    );
    dragSeaLevel = environment.dragSeaLevel ?? 0.015;
  }

  const oriented = integrateOrientation(
    body,
    input,
    dt,
    stats,
    gravityUp,
  );
  const linear = integrateLinear(
    body,
    input,
    dt,
    oriented,
    stats,
    gravityUp,
    gravityMps2,
    atmosphereFactor,
    dragSeaLevel,
    grounded,
  );

  let { velocity, grounded: nextGrounded } = linear;
  let { forward, up } = oriented;
  let position = add(body.position, scale(velocity, dt));

  if (environment.kind === 'planet') {
    const { planet, seed } = environment;
    const nextSurface = sampleRenderablePlanetSurface(planet, seed, position);
    if (nextSurface.altitudeMeters < 0) {
      position = surfacePointFromPosition(position, nextSurface.surfaceRadiusMeters);
      const normal = nextSurface.normal ?? radialUp(position);
      const inwardSpeed = dot(velocity, normal);
      if (inwardSpeed < 0) velocity = sub(velocity, scale(normal, inwardSpeed));
      up = normal;
      const frame = orthonormalFrame(forward, up, normal);
      forward = frame.forward;
      up = frame.up;
      nextGrounded = true;
      velocity = scale(velocity, 0.2);
      oriented.angularVelocity = vec3(0, 0, 0);
    }

    const stationFrame = getStationFrame(planet);
    const hangarRest = sampleHangarRest(stationFrame, position, getShipRestHeightMeters());
    if (hangarRest) {
      const localUp = worldToStationLocal(stationFrame, position).up;
      if (localUp <= hangarRest.restUp) {
        position = add(position, scale(stationFrame.up, hangarRest.restUp - localUp));
        const inwardSpeed = dot(velocity, stationFrame.up);
        if (inwardSpeed < 0) velocity = sub(velocity, scale(stationFrame.up, inwardSpeed));
        up = stationFrame.up;
        const frame = orthonormalFrame(forward, up, stationFrame.up);
        forward = frame.forward;
        up = frame.up;
        nextGrounded = true;
      }
    }
  } else {
    const restY = environment.groundY + environment.restHeightMeters;
    if (position.y < restY) {
      position = { ...position, y: restY };
      if (velocity.y < 0) velocity = { ...velocity, y: 0 };
      up = gravityUp;
      const frame = orthonormalFrame(forward, up, gravityUp);
      forward = frame.forward;
      up = frame.up;
      nextGrounded = true;
      oriented.angularVelocity = vec3(0, 0, 0);
    }
  }

  return {
    angularVelocity: oriented.angularVelocity,
    forward,
    grounded: nextGrounded,
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
  options?: FlightStatsOptions,
): FlightBody {
  return integrateFlightBody(body, {}, dt, planet, seed, options);
}
