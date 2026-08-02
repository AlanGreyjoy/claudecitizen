import { add, normalize, scale, tangentize, vec3 } from '../math/vec3';
import { flightOptionsFromSpec, integrateHoveringShip } from '../flight/flight-body';
import {
  CHAIR_SIT_TRANSITION_SECONDS,
  CHAIR_STAND_TRANSITION_SECONDS,
  MODE_ENTERING_CHAIR,
  MODE_IN_CHAIR,
  MODE_IN_STATION,
  MODE_ON_SHIP_DECK,
  MODE_LEAVING_CHAIR,
} from './modes';
import {
  createDeckCharacterState,
  getDeckSpawnFloorHint,
  getDeckWorldPose,
} from './ship-deck';
import {
  createTransitionPose,
  getShipRight,
  localOffsetToWorld,
  worldToShipLocal,
} from './ship-interaction';
import { getShipLayout } from './ship-layout';
import type { FlightBody, GameMode, Planet, Pose, Vec3 } from '../types';
import type { WorldState } from './world-state';
import { getActiveShip, getActiveShipBody } from './world-state';
import {
  findChairById,
  type ChairDir2,
  type ChairOccupancyState,
  type ChairSeatSpec,
} from '../world/chair-seats';
import {
  getStationLayoutOverride,
  stationDirToWorld,
  stationLocalToWorld,
  type StationFrame,
} from '../world/station';
import { createStationCharacterAt } from './station-walk';

function clamp01(value: number): number {
  return Math.max(0, Math.min(1, value));
}

function smoothstep01(value: number): number {
  const clamped = clamp01(value);
  return clamped * clamped * (3 - 2 * clamped);
}

function zeroVelocity() {
  return vec3(0, 0, 0);
}

function transitionCharacterFromPose(pose: Pose, animation: string) {
  return {
    animation,
    forward: pose.forward,
    grounded: true as const,
    jumpPhase: 'grounded' as const,
    jumpPhaseTime: 0,
    position: pose.position,
    up: pose.up,
    velocity: zeroVelocity(),
  };
}

function faceToWorld(
  right: Vec3,
  forward: Vec3,
  face: ChairDir2,
): Vec3 {
  return normalize(add(scale(right, face.right), scale(forward, face.forward)));
}

function shipBasis(ship: FlightBody): { right: Vec3; up: Vec3; forward: Vec3 } {
  const forward = normalize(tangentize(ship.forward, ship.up));
  return { right: getShipRight(ship), up: ship.up, forward };
}

function resolveChairSpec(occupancy: ChairOccupancyState): ChairSeatSpec | null {
  if (occupancy.surface === 'ship') {
    return findChairById(getShipLayout().chairs, occupancy.chairId);
  }
  return findChairById(
    getStationLayoutOverride()?.chairs ?? [],
    occupancy.chairId,
  );
}

function getShipChairAnchor(ship: FlightBody, chair: ChairSeatSpec): Pose {
  const basis = shipBasis(ship);
  return {
    position: localOffsetToWorld(ship, chair.seat),
    forward: faceToWorld(basis.right, basis.forward, chair.face),
    up: ship.up,
  };
}

function getShipChairStandPose(ship: FlightBody, chair: ChairSeatSpec): Pose {
  const basis = shipBasis(ship);
  const pose = getDeckWorldPose(ship, chair.stand);
  return {
    ...pose,
    forward: faceToWorld(basis.right, basis.forward, chair.face),
  };
}

function getStationChairAnchor(
  frame: StationFrame,
  chair: ChairSeatSpec,
): Pose {
  return {
    position: stationLocalToWorld(frame, chair.seat),
    forward: stationDirToWorld(frame, chair.face),
    up: frame.up,
  };
}

function getStationChairStandCharacter(
  frame: StationFrame,
  chair: ChairSeatSpec,
  roomId: string,
) {
  return createStationCharacterAt(
    frame,
    roomId,
    { right: chair.stand.right, forward: chair.stand.forward },
    chair.face,
    chair.seat.up,
  );
}

export function getChairEyeLocal(
  occupancy: ChairOccupancyState | null,
): { right: number; up: number; forward: number } | null {
  if (!occupancy) return null;
  return resolveChairSpec(occupancy)?.eye ?? null;
}

export function getActiveChairSpec(world: WorldState): ChairSeatSpec | null {
  if (!world.chairOccupancy) return null;
  return resolveChairSpec(world.chairOccupancy);
}

export interface ChairTransitionContext {
  planet: Planet;
  seed: number;
  stationFrame: StationFrame;
  setControlsMode: (mode: GameMode | 'on-foot' | 'in-ship') => void;
  onDeckEntered?: (
    local: { right: number; forward: number },
    floorUp: number,
  ) => void;
  onStationEntered?: (position: Vec3) => void;
}

/** Sit down on a furniture chair (station or ship deck). */
export function beginChairSitTransition(
  world: WorldState,
  surface: 'station' | 'ship',
  chairId: string,
  stationFrame?: StationFrame,
): void {
  const occupancy: ChairOccupancyState = { surface, chairId };
  const chair = resolveChairSpec(occupancy);
  if (!chair) return;

  let endPose: Pose;
  if (surface === 'ship') {
    endPose = getShipChairAnchor(getActiveShipBody(world), chair);
  } else {
    const frame = stationFrame;
    if (!frame) return;
    endPose = getStationChairAnchor(frame, chair);
  }

  world.mode = MODE_ENTERING_CHAIR;
  world.prompt = '';
  world.activeBedId = null;
  world.chairOccupancy = occupancy;
  world.ladderClimb = null;
  world.transition = {
    duration: CHAIR_SIT_TRANSITION_SECONDS,
    elapsed: 0,
    endPose,
    startPose: {
      forward: world.character.forward,
      position: world.character.position,
      up: world.character.up,
    },
    type: 'chair-sit',
  };
}

/** Stand up from the active furniture chair. */
export function beginChairStandTransition(
  world: WorldState,
  stationFrame?: StationFrame,
): void {
  const occupancy = world.chairOccupancy;
  if (!occupancy) return;
  const chair = resolveChairSpec(occupancy);
  if (!chair) return;

  let startPose: Pose;
  let endPose: Pose;
  if (occupancy.surface === 'ship') {
    const ship = getActiveShipBody(world);
    startPose = getShipChairAnchor(ship, chair);
    endPose = getShipChairStandPose(ship, chair);
  } else {
    const frame = stationFrame;
    if (!frame) return;
    startPose = getStationChairAnchor(frame, chair);
    const roomId = world.character.stationRoomId ?? 'none';
    const stand = getStationChairStandCharacter(frame, chair, roomId);
    endPose = {
      position: stand.position,
      forward: stand.forward,
      up: stand.up,
    };
  }

  world.mode = MODE_LEAVING_CHAIR;
  world.prompt = '';
  world.transition = {
    duration: CHAIR_STAND_TRANSITION_SECONDS,
    elapsed: 0,
    endPose,
    startPose,
    type: 'chair-stand',
  };
  world.character = transitionCharacterFromPose(startPose, 'Sitting_Exit');
}

function finishChairSit(
  world: WorldState,
  endPose: Pose,
  ctx: ChairTransitionContext,
): void {
  world.mode = MODE_IN_CHAIR;
  world.transition = null;
  world.character = transitionCharacterFromPose(endPose, 'Sitting_Idle');
  ctx.setControlsMode(MODE_IN_CHAIR);
}

function finishChairStandOnShip(
  world: WorldState,
  endPose: Pose,
  ctx: ChairTransitionContext,
): void {
  const instance = getActiveShip(world);
  const leaveLocal = worldToShipLocal(instance.body, endPose.position);
  const resumeLocal = {
    right: leaveLocal.right,
    forward: leaveLocal.forward,
  };
  const floorHint = getDeckSpawnFloorHint(resumeLocal);
  world.character = createDeckCharacterState(
    instance.body,
    resumeLocal,
    undefined,
    undefined,
    floorHint,
  );
  world.mode = MODE_ON_SHIP_DECK;
  world.chairOccupancy = null;
  world.transition = null;
  ctx.setControlsMode('on-foot');
  ctx.onDeckEntered?.(resumeLocal, floorHint);
}

function finishChairStandOnStation(
  world: WorldState,
  endPose: Pose,
  ctx: ChairTransitionContext,
): void {
  const occupancy = world.chairOccupancy;
  const roomId = world.character.stationRoomId ?? 'none';
  const chair = occupancy ? resolveChairSpec(occupancy) : null;
  if (chair) {
    world.character = getStationChairStandCharacter(
      ctx.stationFrame,
      chair,
      roomId,
    );
  } else {
    world.character = transitionCharacterFromPose(endPose, 'Idle_Loop');
  }
  world.mode = MODE_IN_STATION;
  world.chairOccupancy = null;
  world.transition = null;
  ctx.setControlsMode('on-foot');
  ctx.onStationEntered?.(world.character.position);
}

function syncShipChairTransitionPoses(
  world: WorldState,
  transition: NonNullable<WorldState['transition']>,
  occupancy: ChairOccupancyState,
  dt: number,
  ctx: ChairTransitionContext,
): void {
  const instance = getActiveShip(world);
  instance.body = integrateHoveringShip(
    instance.body,
    dt,
    ctx.planet,
    ctx.seed,
    flightOptionsFromSpec(instance.spec),
  );
  const chair = resolveChairSpec(occupancy);
  if (!chair) return;
  if (transition.type === 'chair-sit') {
    transition.endPose = getShipChairAnchor(instance.body, chair);
  } else if (transition.type === 'chair-stand') {
    transition.startPose = getShipChairAnchor(instance.body, chair);
    transition.endPose = getShipChairStandPose(instance.body, chair);
  }
}

export function updateChairTransition(
  world: WorldState,
  dt: number,
  ctx: ChairTransitionContext,
): void {
  const transition = world.transition;
  if (!transition) return;
  if (transition.type !== 'chair-sit' && transition.type !== 'chair-stand') return;

  const occupancy = world.chairOccupancy;
  if (occupancy?.surface === 'ship') {
    syncShipChairTransitionPoses(world, transition, occupancy, dt, ctx);
  }

  transition.elapsed = Math.min(transition.duration, transition.elapsed + dt);
  const eased = smoothstep01(transition.elapsed / transition.duration);
  const pose = createTransitionPose(transition.startPose, transition.endPose, eased);
  const animation =
    transition.type === 'chair-sit' ? 'Sitting_Enter' : 'Sitting_Exit';
  world.character = transitionCharacterFromPose(pose, animation);

  if (transition.elapsed < transition.duration) return;

  if (transition.type === 'chair-sit') {
    finishChairSit(world, transition.endPose, ctx);
    return;
  }
  if (occupancy?.surface === 'ship') {
    finishChairStandOnShip(world, transition.endPose, ctx);
    return;
  }
  finishChairStandOnStation(world, transition.endPose, ctx);
}
