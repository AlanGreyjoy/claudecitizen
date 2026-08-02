import { normalize, vec3 } from '../../math/vec3';
import {
  createDeckCharacterState,
  DECK_FLOOR_OFFSET_METERS,
  getDeckSpawnFloorHint,
  getDeckWorldPose,
  getLeavePilotStandPose,
} from '../../player/ship-deck';
import {
  createTransitionPose,
  getBedSpec,
  getShipEntryStandPose,
  worldToShipLocal,
} from '../../player/ship-interaction';
import { getShipLayout } from '../../player/ship-layout';
import { teleportShipPlayerLocal } from '../../physics/ship-physics';
import { doorBlends } from '../../player/ship-rig';
import { clamp } from './camera-math';
import type { ShipSandboxSession } from './types';
import { SANDBOX_GROUND_Y_METERS, WORLD_UP } from './types';

const SIT_SECONDS = 1.3;
const STAND_SECONDS = 1.0;

function smoothstep01(value: number): number {
  const clamped = clamp(value, 0, 1);
  return clamped * clamped * (3 - 2 * clamped);
}

function finishSittingTransition(session: ShipSandboxSession): void {
  session.mode = 'pilot';
  session.transition = null;
}

function finishLyingTransition(session: ShipSandboxSession): void {
  session.mode = 'in-bed';
  session.transition = null;
}

function finishChairSittingTransition(session: ShipSandboxSession): void {
  session.mode = 'in-chair';
  session.transition = null;
  session.character = {
    ...session.character,
    animation: 'Sitting_Idle',
  };
}

/**
 * Exterior entry has no deck: step off onto the pad beside the hull. Y is
 * pinned to the pad plane rather than the seat-relative floor hint the deck
 * path uses, so the walker resumes exactly where ground locomotion expects it.
 */
function finishExteriorStandingTransition(session: ShipSandboxSession): void {
  const leave = getShipEntryStandPose(session.ship, null);
  session.character = {
    animation: 'Idle_Loop',
    forward: normalize({ x: leave.forward.x, y: 0, z: leave.forward.z }),
    grounded: true,
    jumpPhase: 'grounded',
    jumpPhaseTime: 0,
    position: {
      x: leave.position.x,
      y: SANDBOX_GROUND_Y_METERS,
      z: leave.position.z,
    },
    up: { ...WORLD_UP },
    velocity: vec3(0, 0, 0),
  };
  session.activeBedId = null;
  session.activeChairId = null;
  session.mode = 'ground';
  session.transition = null;
}

function finishStandingTransition(session: ShipSandboxSession): void {
  if (session.exteriorEntry && !session.activeBedId && !session.activeChairId) {
    finishExteriorStandingTransition(session);
    return;
  }
  const leave =
    session.mode === 'getting-up' && session.activeBedId
      ? getDeckWorldPose(session.ship, getBedSpec(session.activeBedId)?.stand ?? { right: 0, forward: 0 })
      : session.mode === 'chair-standing' && session.activeChairId
        ? getDeckWorldPose(
            session.ship,
            getShipLayout().chairs.find((c) => c.id === session.activeChairId)?.stand ?? {
              right: 0,
              forward: 0,
            },
          )
        : getLeavePilotStandPose(session.ship);
  const leaveLocal = worldToShipLocal(session.ship, leave.position);
  const resumeLocal = {
    right: leaveLocal.right,
    forward: leaveLocal.forward,
  };
  const floorHint = getDeckSpawnFloorHint(resumeLocal);
  session.character = createDeckCharacterState(
    session.ship,
    resumeLocal,
    undefined,
    {
      gear01: session.rig.gear01,
      ramp01: session.rig.ramp01,
      doors: doorBlends(session.rig),
    },
    floorHint,
  );
  if (session.shipPhysics) {
    teleportShipPlayerLocal(session.shipPhysics, {
      right: resumeLocal.right,
      up: floorHint + DECK_FLOOR_OFFSET_METERS,
      forward: resumeLocal.forward,
    });
  }
  session.activeBedId = null;
  session.activeChairId = null;
  session.mode = 'deck';
  session.transition = null;
}

export function updateShipSandboxTransition(session: ShipSandboxSession, dt: number): void {
  if (!session.transition) return;
  session.transition.elapsed = Math.min(session.transition.duration, session.transition.elapsed + dt);
  const eased = smoothstep01(session.transition.elapsed / session.transition.duration);
  const pose = createTransitionPose(session.transition.start, session.transition.end, eased);
  const entering =
    session.mode === 'sitting' ||
    session.mode === 'lying' ||
    session.mode === 'chair-sitting';
  session.character = {
    animation: entering ? 'Sitting_Enter' : 'Sitting_Exit',
    forward: pose.forward,
    grounded: true,
    jumpPhase: 'grounded',
    jumpPhaseTime: 0,
    position: pose.position,
    up: pose.up,
    velocity: vec3(0, 0, 0),
  };
  if (session.transition.elapsed < session.transition.duration) return;
  if (session.mode === 'sitting') {
    finishSittingTransition(session);
    return;
  }
  if (session.mode === 'lying') {
    finishLyingTransition(session);
    return;
  }
  if (session.mode === 'chair-sitting') {
    finishChairSittingTransition(session);
    return;
  }
  finishStandingTransition(session);
}

export { SIT_SECONDS, STAND_SECONDS };
