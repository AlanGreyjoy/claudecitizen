import type { getActiveShip } from "../../player/world_state";
import {
  flightOptionsFromSpec,
  integrateFlightBody,
} from "../../flight/flight_body";
import {
  recenterAimAsNoseTracks,
  resolveAimForward,
  resolveSeatLookForward,
} from "../../flight/flight_aim";
import { buildNavPrompt } from "../../flight/quantum_travel";
import { updateFlightCameraFeel } from "../../player/flight_camera_feel";
import {
  applyCockpitControlAction,
  resolveCockpitGazeTarget,
} from "../../player/cockpit_gaze";
import { localOffsetToWorld } from "../../player/ship_interaction";
import { getShipLayout } from "../../player/ship_layout";
import { playCockpitControlToggleSfx } from "../../player/ship_articulation_sfx";
import type { CameraState, FrameActions } from "../types";
import type { LoopContext } from "../loop_context";
import type { Prompts } from "../station/prompts";

type ShipInstance = ReturnType<typeof getActiveShip>;

function applyCockpitLookAt(
  ctx: LoopContext,
  instance: ShipInstance,
  actions: FrameActions,
): void {
  if (!ctx.controls.isSeatLookActive()) return;
  const eye = localOffsetToWorld(instance.body, getShipLayout().pilotEye);
  const seat = ctx.controls.getSeatLook();
  const view = resolveSeatLookForward(
    instance.body.forward,
    instance.body.up,
    seat.yawRadians,
    seat.pitchRadians,
  );
  const hit = resolveCockpitGazeTarget(
    getShipLayout().cockpitControls,
    instance.body,
    eye,
    view.forward,
  );
  if (actions.primaryClickPressed && hit) {
    const applied = applyCockpitControlAction(hit.control.action, instance.rig);
    if (applied) {
      playCockpitControlToggleSfx(
        hit.control.action,
        instance.rig,
        getShipLayout().spec,
      );
    }
  }
}

function applyManualFlightFeel(
  ctx: LoopContext,
  instance: ShipInstance,
  camera: CameraState,
  flightInput: ReturnType<LoopContext["controls"]["sampleFlightInput"]>,
  dt: number,
): void {
  const inCockpit = (camera.shipCameraView ?? "cockpit") === "cockpit";
  ctx.flightCameraFeelFrame = updateFlightCameraFeel(
    ctx.flightCameraFeelState,
    inCockpit
      ? {
          throttle01: flightInput.throttle01 ?? 0,
          strafe01: flightInput.strafe01 ?? 0,
          lift01: flightInput.lift01 ?? 0,
          boost01: flightInput.boost01 ?? 0,
        }
      : { throttle01: 0, strafe01: 0, lift01: 0, boost01: 0 },
    instance.spec,
    dt,
  );
  ctx.boostSfx.setLevel(
    instance.spec.boostSoundUrl,
    (ctx.flightCameraFeelFrame?.boost01 ?? 0) * instance.spec.boostSoundVolume,
  );
  ctx.thrustSfx.setLevel(
    instance.spec.thrustSoundUrl,
    (ctx.flightCameraFeelFrame?.thrust01 ?? 0) * instance.spec.thrustSoundVolume,
  );
}

function resolveManualFlightPrompt(
  ctx: LoopContext,
  instance: ShipInstance,
  actions: FrameActions,
  prompts: Prompts,
): string {
  if (actions.coupledToggled) {
    return ctx.controls.isCoupledMode() ? "Coupled mode" : "Decoupled mode";
  }
  if (ctx.world.flightMode === "nav") {
    return buildNavPrompt({
      body: instance.body,
      flightMode: ctx.world.flightMode,
      quantum: ctx.world.quantum,
      planet: ctx.planet,
      seed: ctx.seed,
    });
  }
  return `${prompts.holdPrompt("seatLook", "look around")} · ${prompts.holdPrompt("exitSeat", "get up")} · Alt+C coupled`;
}

/** IFCS integrate, dual-reticle aim, cockpit look-at, and flight prompt. */
export function advanceManualFlight(
  ctx: LoopContext,
  instance: ShipInstance,
  camera: CameraState,
  actions: FrameActions,
  prompts: Prompts,
  dt: number,
): void {
  const flightInput = ctx.controls.sampleFlightInput();
  if (ctx.world.flightMode === "nav") {
    flightInput.throttle01 = (flightInput.throttle01 ?? 0) * 0.5;
  }
  const previousForward = instance.body.forward;
  const aim = ctx.controls.getFlightAim();
  const aimForward = resolveAimForward(instance.body, aim);
  instance.body = integrateFlightBody(
    instance.body,
    flightInput,
    dt,
    ctx.planet,
    ctx.seed,
    flightOptionsFromSpec(instance.spec, {
      coupled: ctx.controls.isCoupledMode(),
      aimForward,
    }),
  );
  ctx.controls.setFlightAim(
    recenterAimAsNoseTracks(aim, instance.body, previousForward),
  );

  applyManualFlightFeel(ctx, instance, camera, flightInput, dt);
  applyCockpitLookAt(ctx, instance, actions);
  ctx.world.prompt = resolveManualFlightPrompt(ctx, instance, actions, prompts);
}
