import { getBedAnchor, getBedEyeLocal, getBedSpec, localOffsetToWorld } from '../../player/ship_interaction';
import { getDeckWorldPose } from '../../player/ship_deck';
import {
  entertainmentSystemLabel,
  resolveEntertainmentGazeTarget,
} from '../../player/entertainment_gaze';
import { resolveSeatLookForward } from '../../flight/flight_aim';
import { projectWorldPointToScreenOffset } from '../../player/cockpit_gaze';
import { getShipLayout } from '../../player/ship_layout';
import { GET_UP_FROM_BED_SECONDS } from '../../player/modes';
import type { ShipSandboxSession, SandboxBedActions } from './types';

export function beginGetUpFromBed(session: ShipSandboxSession): void {
  if (!session.activeBedId) return;
  session.entertainmentSystem.close();
  session.esScreen.setInteractive(false);
  session.esScreen.setPowered(false);
  session.esScreen.setSpec(null);
  const bed = getBedAnchor(session.ship, session.activeBedId);
  const stand = getDeckWorldPose(
    session.ship,
    getBedSpec(session.activeBedId)?.stand ?? { right: 0, forward: 0 },
  );
  session.transition = {
    start: bed,
    end: stand,
    elapsed: 0,
    duration: GET_UP_FROM_BED_SECONDS,
  };
  session.mode = 'getting-up';
  session.character = {
    animation: 'Sitting_Exit',
    forward: bed.forward,
    grounded: true,
    jumpPhase: 'grounded',
    jumpPhaseTime: 0,
    position: bed.position,
    up: bed.up,
    velocity: { x: 0, y: 0, z: 0 },
  };
}
export function updateShipSandboxInBed(
  session: ShipSandboxSession,
  actions: SandboxBedActions,
): void {
  const layout = getShipLayout();
  const eyeLocal = getBedEyeLocal(session.activeBedId) ?? layout.pilotEye;
  const eye = localOffsetToWorld(session.ship, eyeLocal);
  const seat = session.controls.getSeatLook();
  const view = resolveSeatLookForward(
    session.ship.forward,
    session.ship.up,
    seat.yawRadians,
    seat.pitchRadians,
  );
  const esHit = resolveEntertainmentGazeTarget(
    layout.entertainmentSystems,
    session.ship,
    eye,
    view.forward,
  );

  if (layout.entertainmentSystems.length > 0) {
    session.esScreen.setSpec(esHit?.system ?? layout.entertainmentSystems[0]!);
  }

  if (esHit && actions.interactPressed && !session.entertainmentSystem.isOpen()) {
    session.esScreen.setPowered(true);
    session.esScreen.setInteractive(true);
    session.cockpitGazeHud.update({ visible: false });
    session.entertainmentSystem.open({
      onExitBed: () => beginGetUpFromBed(session),
      onClose: () => {
        session.esScreen.setInteractive(false);
        session.esScreen.setPowered(false);
      },
    });
    session.prompt = '';
    return;
  }

  if (actions.exitSeatPressed) {
    beginGetUpFromBed(session);
    return;
  }

  session.esScreen.setInteractive(false);
  session.esScreen.setPowered(false);
  session.prompt = esHit
    ? `Press F — ${entertainmentSystemLabel(esHit.system)} · Hold Y — get up`
    : 'Look around · Hold Y — get up';

  if (!esHit) {
    session.cockpitGazeHud.update({ visible: false });
    return;
  }
  const fovY = (session.camera.fov * Math.PI) / 180;
  const offset = projectWorldPointToScreenOffset(
    esHit.worldPosition,
    eye,
    view.forward,
    view.right,
    view.up,
    fovY,
    window.innerHeight,
  );
  if (offset.behind) {
    session.cockpitGazeHud.update({ visible: false });
    return;
  }
  session.cockpitGazeHud.update({
    visible: true,
    label: entertainmentSystemLabel(esHit.system),
    offsetPx: { x: offset.x, y: offset.y },
  });
}
