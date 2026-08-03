import {
  add,
  cross,
  length,
  normalize,
  scale,
  tangentize,
  vec3,
} from "../math/vec3";
import {
  eastVector,
  forwardFromYaw,
  radialUp,
  surfacePointFromPosition,
} from "../world/coordinates";
import { sampleFootPlanetSurface } from "../world/planet-surface";
import type { CharacterInput, CharacterState, Planet, Vec3 } from "../types";
import {
  animationLayersFromState,
  resolveWalkAiming,
  resolveWalkFacing,
  resolveWalkInputIntent,
} from "./character-locomotion";
import {
  integrateCharacterLocomotion,
  type GroundContact,
  type LocomotionCallbacks,
} from "./locomotion-integrator";
import type { WeaponAnimStanceId } from "./inventory/weapon-select";

/**
 * The planet-surface walker: camera-relative move input against band-limited
 * terrain heights, with prop tops as an extra standing surface. Gravity, air
 * control, and jump phases live in `locomotion-integrator.ts`; facing and clip
 * selection live in `character-locomotion.ts`.
 */

/** Foot clearance above the sampled terrain skin. */
export const CHARACTER_GROUND_OFFSET_METERS = 0.05;
export const CHARACTER_EYE_HEIGHT_METERS = 1.62;

/** Tallest prop top the walker steps up onto instead of walking into. */
const PROP_STEP_UP_MAX_METERS = 1.25;
/** Props probing slightly above the feet still count — probe noise, not a wall. */
const PROP_STEP_DOWN_LIMIT_METERS = -0.05;
/** A prop only wins over the terrain when it is clearly above it. */
const PROP_ABOVE_TERRAIN_EPSILON_METERS = 0.02;
/** Longest drop onto a prop top accepted as a landing. */
const PROP_LANDING_REACH_METERS = 0.85;
/** Props this far below the terrain skin are stale probes, not landings. */
const PROP_LANDING_TERRAIN_TOLERANCE_METERS = 0.05;

function movementDirection(
  position: Vec3,
  moveX: number,
  moveY: number,
  cameraYawRadians: number,
): Vec3 {
  const up = radialUp(position);
  const cameraForward = forwardFromYaw(position, cameraYawRadians);
  const cameraRight = normalize(cross(cameraForward, up));
  const desired = add(scale(cameraRight, moveX), scale(cameraForward, moveY));
  const tangentDesired = tangentize(desired, up);
  if (length(tangentDesired) < 1e-6) return vec3(0, 0, 0);
  return normalize(tangentDesired);
}

function clampToGround(position: Vec3, surfaceRadiusMeters: number): Vec3 {
  return surfacePointFromPosition(
    position,
    surfaceRadiusMeters + CHARACTER_GROUND_OFFSET_METERS,
  );
}

export interface PlanetPropCollision {
  filterMovement: (from: Vec3, desiredDelta: Vec3, up: Vec3) => Vec3;
  /** Distance along -up from feet to a prop top, or null. */
  probeSupport: (from: Vec3, up: Vec3) => number | null;
}

interface PlanetGround {
  planet: Planet;
  seed: number;
  propCollision: PlanetPropCollision | null;
}

/** Terrain foot pose at a position, ignoring props. */
function terrainContact(ground: PlanetGround, position: Vec3): GroundContact {
  const surface = sampleFootPlanetSurface(ground.planet, ground.seed, position);
  const snapped = clampToGround(position, surface.surfaceRadiusMeters);
  return { position: snapped, up: radialUp(snapped) };
}

/** Slide along props, then stand on the terrain or on a prop top above it. */
function stepPlanetGround(
  ground: PlanetGround,
  from: Vec3,
  step: Vec3,
): GroundContact {
  const props = ground.propCollision;
  const moved = props
    ? props.filterMovement(from, step, radialUp(from))
    : add(from, step);
  const terrain = terrainContact(ground, moved);

  const support = props?.probeSupport(terrain.position, terrain.up) ?? null;
  if (
    support === null
    || support <= PROP_STEP_DOWN_LIMIT_METERS
    || support >= PROP_STEP_UP_MAX_METERS
  ) {
    return terrain;
  }
  const propPosition = add(terrain.position, scale(terrain.up, -support));
  if (
    length(propPosition)
    <= length(terrain.position) + PROP_ABOVE_TERRAIN_EPSILON_METERS
  ) {
    return terrain;
  }
  return { position: propPosition, up: radialUp(propPosition) };
}

/** Foot pose if a falling character has reached a prop top or the terrain. */
function tryLandOnPlanet(
  ground: PlanetGround,
  candidate: Vec3,
): GroundContact | null {
  const surface = sampleFootPlanetSurface(ground.planet, ground.seed, candidate);
  const terrainRadius =
    surface.surfaceRadiusMeters + CHARACTER_GROUND_OFFSET_METERS;
  const up = radialUp(candidate);

  const support = ground.propCollision?.probeSupport(candidate, up) ?? null;
  if (support !== null && support < PROP_LANDING_REACH_METERS) {
    const propPosition = add(candidate, scale(up, -support));
    if (
      length(propPosition)
      >= terrainRadius - PROP_LANDING_TERRAIN_TOLERANCE_METERS
    ) {
      return { position: propPosition, up: radialUp(propPosition) };
    }
  }

  if (length(candidate) > terrainRadius) return null;
  return terrainContact(ground, candidate);
}

function planetLocomotionCallbacks(
  ground: PlanetGround,
  from: Vec3,
  step: Vec3,
): LocomotionCallbacks {
  return {
    onGroundedStep: () => stepPlanetGround(ground, from, step),
    tryLand: (candidate) => tryLandOnPlanet(ground, candidate),
    sampleAirborneUp: radialUp,
  };
}

export function createCharacterState(
  position: Vec3,
  forward: Vec3 = eastVector(position),
): CharacterState {
  const up = radialUp(position);
  return {
    animation: "Idle_Loop",
    forward: normalize(tangentize(forward, up)),
    grounded: true,
    jumpPhase: "grounded",
    jumpPhaseTime: 0,
    position,
    up,
    velocity: vec3(0, 0, 0),
  };
}

export interface PlanetWalkContext {
  planet: Planet;
  seed: number;
  propCollision?: PlanetPropCollision | null;
  stanceId?: WeaponAnimStanceId;
  aiming?: boolean;
}

export function updateCharacterState(
  state: CharacterState,
  input: CharacterInput,
  dt: number,
  context: PlanetWalkContext,
): CharacterState {
  const intent = resolveWalkInputIntent(input);
  const poseAiming = resolveWalkAiming(context.aiming ?? false, intent);
  const cameraYawRadians = input.cameraYawRadians ?? 0;
  const desiredDirection = movementDirection(
    state.position,
    intent.moveX,
    intent.moveY,
    cameraYawRadians,
  );
  const ground: PlanetGround = {
    planet: context.planet,
    seed: context.seed,
    propCollision: context.propCollision ?? null,
  };

  const motion = integrateCharacterLocomotion(
    state,
    {
      wantsJump: intent.wantsJump,
      desiredDirection,
      moveSpeed: intent.moveSpeedMetersPerSecond,
      jumpSpeed: intent.jumpSpeedMetersPerSecond,
    },
    dt,
    radialUp(state.position),
    context.planet.gravityMetersPerSecond2 ?? 9.8,
    planetLocomotionCallbacks(
      ground,
      state.position,
      scale(desiredDirection, intent.moveSpeedMetersPerSecond * dt),
    ),
  );

  const forward = resolveWalkFacing(
    {
      currentForward: state.forward,
      moveDirection: desiredDirection,
      cameraForward: forwardFromYaw(state.position, cameraYawRadians),
      up: motion.up,
      aiming: poseAiming,
    },
    dt,
  );

  const layers = animationLayersFromState({
    stanceId: context.stanceId ?? "unarmed",
    aiming: poseAiming,
    isMoving: intent.isMoving,
    isCrouching: intent.isCrouching,
    gait: intent.gait,
    jumpPhase: motion.jumpPhase,
  });
  return {
    animation: layers.baseClip,
    upperBodyAnimation: layers.upperClip,
    forward,
    grounded: motion.grounded,
    jumpPhase: motion.jumpPhase,
    jumpPhaseTime: motion.jumpPhaseTime,
    position: motion.position,
    up: motion.up,
    velocity: motion.velocity,
  };
}
