import { length, normalize, cross, vec3 } from '../../math/vec3';
import type { Vec3 } from '../../types';
import {
  flightOptionsFromSpec,
  integrateSandboxFlightBody,
} from '../../flight/flight_body';
import {
  recenterAimAsNoseTracks,
  resolveAimForward,
  resolveSeatLookForward,
} from '../../flight/flight_aim';
import { resolveBoostMaxSpeedMps } from '../../flight/flight_config';
import { projectDirectionToReticleOffset } from '../../render/effects/hud/flight_reticle';
import {
  applyCockpitControlAction,
  cockpitControlLabel,
  projectWorldPointToScreenOffset,
  resolveCockpitGazeTarget,
} from '../../player/cockpit_gaze';
import { resolveVisibleCockpitSpeedInstruments } from '../../player/cockpit_stats';
import { updateFlightCameraFeel } from '../../player/flight_camera_feel';
import { getShipLayout, getShipRestHeightMeters } from '../../player/ship_layout';
import { getPilotSeatAnchor, localOffsetToWorld } from '../../player/ship_interaction';
import { getLeavePilotStandPose } from '../../player/ship_deck';
import { playCockpitControlToggleSfx } from '../../player/ship_articulation_sfx';
import { FIRST_PERSON_PITCH_LIMIT } from '../../player/character_controller';
import { MODE_IN_SHIP } from '../../player/modes';
import type { ShipSandboxSession, SandboxPilotActions } from './types';
import { SANDBOX_GRAVITY, SANDBOX_GROUND_Y_METERS, SHIP_FORWARD, WORLD_UP } from './types';

const STAND_SECONDS = 1.0;

function integrateSandboxShip(
  session: ShipSandboxSession,
  dt: number,
  aimForward: ReturnType<typeof resolveAimForward>,
) {
  const previousForward = session.ship.forward;
  const restHeight = getShipRestHeightMeters();
  const next = integrateSandboxFlightBody(
    session.ship,
    session.controls.sampleFlightInput(),
    dt,
    {
      gravityMps2: SANDBOX_GRAVITY,
      groundY: SANDBOX_GROUND_Y_METERS,
      restHeightMeters: restHeight,
      atmosphereHeightMeters: 80,
    },
    flightOptionsFromSpec(getShipLayout().spec, {
      coupled: session.controls.isCoupledMode(),
      aimForward,
    }),
  );
  Object.assign(session.ship, next);
  session.controls.setFlightAim(
    recenterAimAsNoseTracks(session.controls.getFlightAim(), session.ship, previousForward),
  );
}

function updateSandboxFlightAudio(session: ShipSandboxSession, dt: number): void {
  const flightInput = session.controls.sampleFlightInput();
  session.flightCameraFeelFrame = updateFlightCameraFeel(
    session.flightCameraFeelState,
    {
      throttle01: flightInput.throttle01 ?? 0,
      strafe01: flightInput.strafe01 ?? 0,
      lift01: flightInput.lift01 ?? 0,
      boost01: flightInput.boost01 ?? 0,
    },
    getShipLayout().spec,
    dt,
  );
  const layout = getShipLayout();
  session.boostSfx.setLevel(
    layout.spec.boostSoundUrl,
    session.flightCameraFeelFrame!.boost01 * layout.spec.boostSoundVolume,
  );
  session.thrustSfx.setLevel(
    layout.spec.thrustSoundUrl,
    session.flightCameraFeelFrame!.thrust01 * layout.spec.thrustSoundVolume,
  );
}

function handleCockpitGazeClick(session: ShipSandboxSession, actions: SandboxPilotActions): void {
  if (!session.controls.isSeatLookActive() || !actions.primaryClickPressed) return;
  const layout = getShipLayout();
  const eye = localOffsetToWorld(session.ship, layout.pilotEye);
  const seat = session.controls.getSeatLook();
  const view = resolveSeatLookForward(
    session.ship.forward,
    session.ship.up,
    seat.yawRadians,
    seat.pitchRadians,
    FIRST_PERSON_PITCH_LIMIT,
  );
  const hit = resolveCockpitGazeTarget(layout.cockpitControls, session.ship, eye, view.forward);
  if (!hit) return;
  const applied = applyCockpitControlAction(hit.control.action, session.rig);
  if (applied) {
    playCockpitControlToggleSfx(hit.control.action, session.rig, getShipLayout().spec);
  }
}

function settleShipOnPad(session: ShipSandboxSession): void {
  const restHeight = getShipRestHeightMeters();
  session.ship.position = {
    ...session.ship.position,
    y: Math.max(session.ship.position.y, restHeight),
  };
  session.ship.velocity = vec3(0, 0, 0);
  session.ship.angularVelocity = vec3(0, 0, 0);
  const flatForward = normalize({
    x: session.ship.forward.x,
    y: 0,
    z: session.ship.forward.z,
  });
  session.ship.forward =
    length(flatForward) > 1e-4 ? flatForward : { ...SHIP_FORWARD };
  session.ship.up = { ...WORLD_UP };
  session.ship.grounded = true;
}

function beginLeavePilotSeat(session: ShipSandboxSession): void {
  session.transition = {
    start: getPilotSeatAnchor(session.ship),
    end: getLeavePilotStandPose(session.ship),
    elapsed: 0,
    duration: STAND_SECONDS,
  };
  session.mode = 'standing';
  session.prompt = '';
}

function updatePilotPrompt(
  session: ShipSandboxSession,
  actions: SandboxPilotActions,
  parkedEnough: boolean,
  nearPad: boolean,
): void {
  if (actions.coupledToggled) {
    session.prompt = session.controls.isCoupledMode() ? 'Coupled mode' : 'Decoupled mode';
    return;
  }
  if (actions.exitSeatPressed) {
    if (nearPad) settleShipOnPad(session);
    beginLeavePilotSeat(session);
    return;
  }
  session.prompt = parkedEnough
    ? 'Hold F — look around · V camera · Hold Y — get up · Alt+C coupled'
    : 'WASD thrust · mouse aim · Hold F look · V camera · Hold Y — get up · Alt+C';
}

function updateFlightReticleHud(session: ShipSandboxSession, view: {
  forward: { x: number; y: number; z: number };
  up: { x: number; y: number; z: number };
  right: { x: number; y: number; z: number };
}): void {
  const aimDir = resolveAimForward(session.ship, session.controls.getFlightAim());
  const fovY = (session.camera.fov * Math.PI) / 180;
  const viewportH = window.innerHeight;
  const aimOff = projectDirectionToReticleOffset(
    aimDir,
    view.forward,
    view.right,
    view.up,
    fovY,
    viewportH,
  );
  const noseOff = projectDirectionToReticleOffset(
    session.ship.forward,
    view.forward,
    view.right,
    view.up,
    fovY,
    viewportH,
  );
  session.flightReticle.update({
    mode: MODE_IN_SHIP,
    flightMode: 'combat',
    quantum: session.idleQuantum,
    dual: {
      aimOffsetPx: { x: aimOff.x, y: aimOff.y },
      noseOffsetPx: { x: noseOff.x, y: noseOff.y },
      coupled: session.controls.isCoupledMode(),
    },
  });
}

function updateCockpitSpeedHud(
  session: ShipSandboxSession,
  layout: ReturnType<typeof getShipLayout>,
  eye: ReturnType<typeof localOffsetToWorld>,
  view: { forward: Vec3; right: Vec3; up: Vec3 },
  fovY: number,
  viewportH: number,
): void {
  const boost01 = session.flightCameraFeelFrame?.boost01 ?? 0;
  const scmMax = layout.spec.maxSpeedMps;
  const boostMax = resolveBoostMaxSpeedMps(scmMax);
  const speedViews = resolveVisibleCockpitSpeedInstruments(
    layout.cockpitStats,
    session.ship,
    eye,
    view.forward,
    view.right,
    view.up,
    fovY,
    viewportH,
  );
  if (speedViews.length === 0) {
    session.cockpitSpeedHud.update({ visible: false });
    return;
  }
  const speedMps = length(session.ship.velocity);
  session.cockpitSpeedHud.update({
    visible: true,
    instruments: speedViews.map((viewStat) => ({
      id: viewStat.id,
      offsetPx: viewStat.offsetPx,
      speedMps,
      scmMaxMps: scmMax,
      boostMaxMps: boostMax,
      boosting: boost01 > 0.05,
      boost01,
      ...(viewStat.label ? { label: viewStat.label } : {}),
    })),
  });
}

function updateSeatLookGazeHud(
  session: ShipSandboxSession,
  layout: ReturnType<typeof getShipLayout>,
  eye: ReturnType<typeof localOffsetToWorld>,
  view: { forward: Vec3; right: Vec3; up: Vec3 },
  fovY: number,
  viewportH: number,
): void {
  if (!session.controls.isSeatLookActive()) {
    session.cockpitGazeHud.update({ visible: false });
    return;
  }
  const hit = resolveCockpitGazeTarget(layout.cockpitControls, session.ship, eye, view.forward);
  if (!hit) {
    session.cockpitGazeHud.update({ visible: false });
    return;
  }
  const offset = projectWorldPointToScreenOffset(
    hit.worldPosition,
    eye,
    view.forward,
    view.right,
    view.up,
    fovY,
    viewportH,
  );
  if (offset.behind) {
    session.cockpitGazeHud.update({ visible: false });
    return;
  }
  session.cockpitGazeHud.update({
    visible: true,
    label: cockpitControlLabel(
      hit.control.action,
      { gearDown: session.rig.gearDown, rampDown: session.rig.rampDown },
      hit.control.label,
    ),
    offsetPx: { x: offset.x, y: offset.y },
  });
}

function resolvePilotView(session: ShipSandboxSession) {
  const seat = session.controls.getSeatLook();
  const seatLooking = session.controls.isSeatLookActive();
  const freeLooking =
    seatLooking ||
    Math.abs(seat.yawRadians) > 1e-6 ||
    Math.abs(seat.pitchRadians) > 1e-6;
  return freeLooking
    ? resolveSeatLookForward(
        session.ship.forward,
        session.ship.up,
        seat.yawRadians,
        seat.pitchRadians,
        FIRST_PERSON_PITCH_LIMIT,
      )
    : {
        forward: session.ship.forward,
        up: session.ship.up,
        right: normalize(cross(session.ship.forward, session.ship.up)),
      };
}

export function updateShipSandboxPilot(
  session: ShipSandboxSession,
  dt: number,
  actions: SandboxPilotActions,
): void {
  const aimForward = resolveAimForward(session.ship, session.controls.getFlightAim());
  integrateSandboxShip(session, dt, aimForward);
  updateSandboxFlightAudio(session, dt);
  handleCockpitGazeClick(session, actions);

  const speed = length(session.ship.velocity);
  const restHeight = getShipRestHeightMeters();
  const nearPad = Boolean(session.ship.grounded) || session.ship.position.y <= restHeight + 6;
  const parkedEnough = speed < 4;
  updatePilotPrompt(session, actions, parkedEnough, nearPad);

  const view = resolvePilotView(session);
  updateFlightReticleHud(session, view);

  const layout = getShipLayout();
  const eye = localOffsetToWorld(session.ship, layout.pilotEye);
  const fovY = (session.camera.fov * Math.PI) / 180;
  const viewportH = window.innerHeight;
  updateCockpitSpeedHud(session, layout, eye, view, fovY, viewportH);
  updateSeatLookGazeHud(session, layout, eye, view, fovY, viewportH);
}
