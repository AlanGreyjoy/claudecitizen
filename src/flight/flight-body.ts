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

function resolveMassKg(options?: FlightStatsOptions): number {
  return Math.max(1, options?.massKg ?? 12_000);
}

function resolveForwardThrustN(options: FlightStatsOptions | undefined, massKg: number): number {
  return (
    options?.forwardThrustN ??
    (options?.throttleAccelMps2 ?? FLIGHT_CONFIG.THROTTLE_ACCEL) * massKg
  );
}

function resolveTorqueNm(
  _options: FlightStatsOptions | undefined,
  massKg: number,
  rate: number,
  inertiaScale: number,
  override?: number,
): number {
  return (
    override ??
    rate * inertiaScale * massKg * FLIGHT_CONFIG.INERTIA_FACTOR
  );
}

function resolveThrustStats(options?: FlightStatsOptions) {
  const massKg = resolveMassKg(options);
  const forwardThrustN = resolveForwardThrustN(options, massKg);
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
    pitchTorqueNm: resolveTorqueNm(
      options,
      massKg,
      FLIGHT_CONFIG.PITCH_RATE,
      2,
      options?.pitchTorqueNm,
    ),
    yawTorqueNm: resolveTorqueNm(
      options,
      massKg,
      FLIGHT_CONFIG.YAW_RATE,
      2,
      options?.yawTorqueNm,
    ),
    rollTorqueNm: resolveTorqueNm(
      options,
      massKg,
      FLIGHT_CONFIG.ROLL_RATE,
      2.2,
      options?.rollTorqueNm,
    ),
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

function computeThrustAcceleration(
  input: FlightInput,
  frame: { forward: Vec3; right: Vec3; up: Vec3 },
  stats: ReturnType<typeof resolveThrustStats>,
  grounded: boolean,
): { accel: Vec3; nextGrounded: boolean } {
  const { forward, right, up } = frame;
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
  return { accel, nextGrounded };
}

function computeLinearDragAcceleration(
  body: FlightBody,
  input: FlightInput,
  stats: ReturnType<typeof resolveThrustStats>,
  atmosphereFactor: number,
  dragSeaLevel: number,
  inAtmosphere: boolean,
  nextGrounded: boolean,
): Vec3 {
  const speed = length(body.velocity);
  if (speed <= 1e-6) return vec3(0, 0, 0);

  const dragCoefficient = dragSeaLevel * atmosphereFactor;
  let dragAccel = inAtmosphere
    ? scale(
        normalize(body.velocity),
        -dragCoefficient *
          FLIGHT_CONFIG.ATMOSPHERE_DRAG_MULTIPLIER *
          speed *
          speed,
      )
    : scale(body.velocity, -dragCoefficient * FLIGHT_CONFIG.SPACE_DRAG_MULTIPLIER);

  if (!nextGrounded && inAtmosphere && !hasActiveThrust(input)) {
    dragAccel = add(
      dragAccel,
      scale(body.velocity, -FLIGHT_CONFIG.ATMOSPHERE_HOVER_DAMPING * atmosphereFactor),
    );
  }
  if (stats.coupled && !nextGrounded && !hasActiveThrust(input)) {
    dragAccel = add(dragAccel, scale(body.velocity, -FLIGHT_CONFIG.COUPLED_DAMPING));
  }
  return dragAccel;
}

function integrateLinear(
  body: FlightBody,
  input: FlightInput,
  dt: number,
  frame: { forward: Vec3; right: Vec3; up: Vec3 },
  stats: ReturnType<typeof resolveThrustStats>,
  atmosphereFactor: number,
  dragSeaLevel: number,
  grounded: boolean,
): { velocity: Vec3; grounded: boolean } {
  const inAtmosphere = atmosphereFactor > FLIGHT_CONFIG.SPACE_ATMOSPHERE_THRESHOLD;
  const { accel, nextGrounded } = computeThrustAcceleration(input, frame, stats, grounded);
  const dragAccel = computeLinearDragAcceleration(
    body,
    input,
    stats,
    atmosphereFactor,
    dragSeaLevel,
    inAtmosphere,
    nextGrounded,
  );

  const speed = length(body.velocity);
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

interface ResolvedFlightEnvironment {
  atmosphereFactor: number;
  dragSeaLevel: number;
  gravityUp: Vec3;
  grounded: boolean;
}

function resolvePlanetFlightEnvironment(
  body: FlightBody,
  planet: Planet,
  seed: number,
): ResolvedFlightEnvironment {
  const gravityUp = radialUp(body.position);
  const currentSurface = sampleRenderablePlanetSurface(planet, seed, body.position);
  const gearRestAltitude =
    getShipRestHeightMeters() + FLIGHT_CONFIG.GROUNDED_ALTITUDE_METERS;
  const grounded =
    body.grounded ?? currentSurface.altitudeMeters <= gearRestAltitude;
  const altitudeMeters = altitudeForPosition(body.position, planet.radiusMeters);
  const atmosphereFactor = Math.max(
    0,
    1 - Math.max(0, altitudeMeters) / planet.atmosphereHeightMeters,
  );
  return {
    gravityUp,
    grounded,
    atmosphereFactor,
    dragSeaLevel: planet.dragSeaLevel ?? 0.015,
  };
}

function resolveFlatFlightEnvironment(
  body: FlightBody,
  environment: Omit<FlatFlightEnvironment, 'kind'>,
): ResolvedFlightEnvironment {
  const gravityUp = vec3(0, 1, 0);
  const altitude = body.position.y - environment.groundY;
  const grounded =
    body.grounded ??
    altitude <= environment.restHeightMeters + FLIGHT_CONFIG.GROUNDED_ALTITUDE_METERS;
  const atmosphereFactor = Math.max(
    0,
    1 - Math.max(0, altitude) / Math.max(1, environment.atmosphereHeightMeters),
  );
  return {
    gravityUp,
    grounded,
    atmosphereFactor,
    dragSeaLevel: environment.dragSeaLevel ?? 0.015,
  };
}

function resolveFlightEnvironment(
  body: FlightBody,
  environment: FlightEnvironment,
  seed: number,
): ResolvedFlightEnvironment {
  if (environment.kind === 'planet') {
    return resolvePlanetFlightEnvironment(body, environment.planet, seed);
  }
  return resolveFlatFlightEnvironment(body, environment);
}

interface PlanetLandingClampInput {
  forward: Vec3;
  nextGrounded: boolean;
  oriented: ReturnType<typeof integrateOrientation>;
  planet: Planet;
  position: Vec3;
  seed: number;
  up: Vec3;
  velocity: Vec3;
}

function applyPlanetLandingClamp(
  input: PlanetLandingClampInput,
): {
  forward: Vec3;
  grounded: boolean;
  oriented: ReturnType<typeof integrateOrientation>;
  position: Vec3;
  up: Vec3;
  velocity: Vec3;
} {
  const { position, velocity, forward, up, oriented, planet, seed, nextGrounded } = input;
  const nextSurface = sampleRenderablePlanetSurface(planet, seed, position);
  const restHeight = getShipRestHeightMeters();
  const stationFrame = getStationFrame(planet);
  const hangarRest = sampleHangarRest(stationFrame, position, restHeight);
  if (hangarRest) {
    const localUp = worldToStationLocal(stationFrame, position).up;
    if (localUp <= hangarRest.restUp) {
      const clampedPosition = add(position, scale(stationFrame.up, hangarRest.restUp - localUp));
      const inwardSpeed = dot(velocity, stationFrame.up);
      const clampedVelocity =
        inwardSpeed < 0 ? sub(velocity, scale(stationFrame.up, inwardSpeed)) : velocity;
      const frame = orthonormalFrame(forward, stationFrame.up, stationFrame.up);
      return {
        position: clampedPosition,
        velocity: clampedVelocity,
        up: frame.up,
        forward: frame.forward,
        grounded: true,
        oriented,
      };
    }
  }
  if (nextSurface.altitudeMeters >= restHeight) {
    return { position, velocity, up, forward, grounded: nextGrounded, oriented };
  }

  const clampedPosition = surfacePointFromPosition(
    position,
    nextSurface.surfaceRadiusMeters + restHeight,
  );
  const normal = nextSurface.normal ?? radialUp(clampedPosition);
  const inwardSpeed = dot(velocity, normal);
  const clampedVelocity =
    inwardSpeed < 0 ? sub(velocity, scale(normal, inwardSpeed)) : velocity;
  const frame = orthonormalFrame(forward, normal, normal);
  return {
    position: clampedPosition,
    velocity: scale(clampedVelocity, 0.2),
    up: frame.up,
    forward: frame.forward,
    grounded: true,
    oriented: { ...oriented, angularVelocity: vec3(0, 0, 0) },
  };
}

function applyFlatLandingClamp(
  position: Vec3,
  velocity: Vec3,
  forward: Vec3,
  up: Vec3,
  oriented: ReturnType<typeof integrateOrientation>,
  environment: Omit<FlatFlightEnvironment, 'kind'>,
  gravityUp: Vec3,
  nextGrounded: boolean,
): {
  forward: Vec3;
  grounded: boolean;
  oriented: ReturnType<typeof integrateOrientation>;
  position: Vec3;
  up: Vec3;
  velocity: Vec3;
} {
  const restY = environment.groundY + environment.restHeightMeters;
  if (position.y >= restY) {
    return { position, velocity, up, forward, grounded: nextGrounded, oriented };
  }
  const clampedPosition = { ...position, y: restY };
  const clampedVelocity = velocity.y < 0 ? { ...velocity, y: 0 } : velocity;
  const frame = orthonormalFrame(forward, gravityUp, gravityUp);
  return {
    position: clampedPosition,
    velocity: clampedVelocity,
    up: frame.up,
    forward: frame.forward,
    grounded: true,
    oriented: { ...oriented, angularVelocity: vec3(0, 0, 0) },
  };
}

export function integrateFlightInEnvironment(
  body: FlightBody,
  input: FlightInput,
  dt: number,
  environment: FlightEnvironment,
  options?: FlightStatsOptions,
): FlightBody {
  const stats = resolveThrustStats(options);
  const seed = environment.kind === 'planet' ? environment.seed : 0;
  const { gravityUp, atmosphereFactor, dragSeaLevel, grounded } = resolveFlightEnvironment(
    body,
    environment,
    seed,
  );

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
    atmosphereFactor,
    dragSeaLevel,
    grounded,
  );

  let { velocity, grounded: nextGrounded } = linear;
  let { forward, up } = oriented;
  let position = add(body.position, scale(velocity, dt));

  if (environment.kind === 'planet') {
    const landed = applyPlanetLandingClamp({
      position,
      velocity,
      forward,
      up,
      oriented,
      planet: environment.planet,
      seed: environment.seed,
      nextGrounded,
    });
    position = landed.position;
    velocity = landed.velocity;
    up = landed.up;
    forward = landed.forward;
    nextGrounded = landed.grounded;
    oriented.angularVelocity = landed.oriented.angularVelocity;
  } else {
    const landed = applyFlatLandingClamp(
      position,
      velocity,
      forward,
      up,
      oriented,
      environment,
      gravityUp,
      nextGrounded,
    );
    position = landed.position;
    velocity = landed.velocity;
    up = landed.up;
    forward = landed.forward;
    nextGrounded = landed.grounded;
    oriented.angularVelocity = landed.oriented.angularVelocity;
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
