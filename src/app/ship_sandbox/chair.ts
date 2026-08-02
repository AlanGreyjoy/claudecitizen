import { add, normalize, scale, tangentize } from '../../math/vec3';
import { getDeckWorldPose } from '../../player/ship-deck';
import { getShipRight, localOffsetToWorld } from '../../player/ship-interaction';
import { findChairById } from '../../world/chair-seats';
import { getShipLayout } from '../../player/ship-layout';
import { CHAIR_STAND_TRANSITION_SECONDS } from '../../player/modes';
import type { FlightBody, Pose } from '../../types';
import type { ShipSandboxSession, SandboxBedActions } from './types';

function shipChairAnchor(ship: FlightBody, chairId: string): Pose | null {
  const chair = findChairById(getShipLayout().chairs, chairId);
  if (!chair) return null;
  const forward = normalize(tangentize(ship.forward, ship.up));
  const right = getShipRight(ship);
  return {
    position: localOffsetToWorld(ship, chair.seat),
    forward: normalize(
      add(scale(right, chair.face.right), scale(forward, chair.face.forward)),
    ),
    up: ship.up,
  };
}

function shipChairStandPose(ship: FlightBody, chairId: string): Pose | null {
  const chair = findChairById(getShipLayout().chairs, chairId);
  if (!chair) return null;
  const anchor = shipChairAnchor(ship, chairId);
  if (!anchor) return null;
  const stand = getDeckWorldPose(ship, chair.stand);
  return { ...stand, forward: anchor.forward };
}

export function beginGetUpFromChair(session: ShipSandboxSession): void {
  if (!session.activeChairId) return;
  const start = shipChairAnchor(session.ship, session.activeChairId);
  const end = shipChairStandPose(session.ship, session.activeChairId);
  if (!start || !end) return;
  session.transition = {
    start,
    end,
    elapsed: 0,
    duration: CHAIR_STAND_TRANSITION_SECONDS,
  };
  session.mode = 'chair-standing';
  session.character = {
    animation: 'Sitting_Exit',
    forward: start.forward,
    grounded: true,
    jumpPhase: 'grounded',
    jumpPhaseTime: 0,
    position: start.position,
    up: start.up,
    velocity: { x: 0, y: 0, z: 0 },
  };
}

export function updateShipSandboxInChair(
  session: ShipSandboxSession,
  actions: SandboxBedActions,
): void {
  if (actions.exitSeatPressed) {
    beginGetUpFromChair(session);
    return;
  }
  session.prompt = 'Look around · Hold Y — stand up';
  session.cockpitGazeHud.update({ visible: false });
}

export function getSandboxChairAnchor(
  ship: FlightBody,
  chairId: string,
): Pose | null {
  return shipChairAnchor(ship, chairId);
}

export function getSandboxChairEyeWorld(
  ship: FlightBody,
  chairId: string | null,
) {
  if (!chairId) return null;
  const chair = findChairById(getShipLayout().chairs, chairId);
  if (!chair) return null;
  return localOffsetToWorld(ship, chair.eye);
}

export function getSandboxChairFaceForward(ship: FlightBody, chairId: string | null) {
  if (!chairId) return ship.forward;
  const chair = findChairById(getShipLayout().chairs, chairId);
  if (!chair) return ship.forward;
  const forward = normalize(tangentize(ship.forward, ship.up));
  const right = getShipRight(ship);
  return normalize(
    add(scale(right, chair.face.right), scale(forward, chair.face.forward)),
  );
}
