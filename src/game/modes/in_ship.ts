import { getActiveShip } from "../../player/world_state";
import {
  flightOptionsFromSpec,
  integrateFlightBody,
} from "../../flight/flight_body";
import {
  recenterAimAsNoseTracks,
  resolveAimForward,
  resolveSeatLookForward,
} from "../../flight/flight_aim";
import { cycleFlightMode } from "../../flight/flight_modes";
import {
  advanceQuantumTravel,
  buildNavPrompt,
  consumePendingHandoffPlanetId,
  evaluateQuantumEligibility,
  tryBeginQuantumTravel,
} from "../../flight/quantum_travel";
import { updateFlightCameraFeel } from "../../player/flight_camera_feel";
import {
  applyCockpitControlAction,
  resolveCockpitGazeTarget,
} from "../../player/cockpit_gaze";
import { localOffsetToWorld } from "../../player/ship_interaction";
import { getShipLayout } from "../../player/ship_layout";
import { playCockpitControlToggleSfx } from "../../player/ship_articulation_sfx";
import { beginStandTransition } from "../../player/transitions";
import type { CameraState, FrameActions } from "../types";
import type { LoopContext } from "../loop_context";
import type { Prompts } from "../station/prompts";

type ShipInstance = ReturnType<typeof getActiveShip>;

interface InShipInput {
  actions: FrameActions;
  camera: CameraState;
  dt: number;
}

export interface InShipMode {
  /** Returns true when a quantum handoff navigated the page away (stop the frame). */
  updateInShipMode: (input: InShipInput) => boolean;
}

/** Cockpit flight: IFCS integrate, dual-reticle aim, quantum travel, look-at. */
export function createInShipMode(
  ctx: LoopContext,
  deps: { prompts: Prompts },
): InShipMode {
  function advanceQuantum(instance: ShipInstance, dt: number): boolean {
    const quantumResult = advanceQuantumTravel(
      instance.body,
      ctx.world.quantum,
      dt,
      ctx.planet,
      ctx.seed,
    );
    instance.body = quantumResult.body;
    ctx.world.quantum = quantumResult.quantum;
    ctx.world.screenFade = quantumResult.screenFade;
    if (ctx.world.quantum.phase === "idle" && ctx.world.quantum.pendingHandoffPlanetId) {
      const handoff = consumePendingHandoffPlanetId(ctx.world.quantum);
      ctx.world.quantum = handoff.quantum;
      if (handoff.planetId) {
        const params = new URLSearchParams(window.location.search);
        params.set("boot", "play");
        params.set("planetId", handoff.planetId);
        if (!params.get("systemId")) params.set("systemId", ctx.world.systemId);
        params.delete("spawn");
        window.location.href = `/?${params.toString()}`;
        return true;
      }
    }
    ctx.world.prompt =
      ctx.world.quantum.phase === "spooling"
        ? "Spooling…"
        : ctx.world.quantum.phase === "traveling"
          ? "Quantum travel"
          : ctx.world.quantum.phase === "idle"
            ? ""
            : "Drop out";
    const feel = updateFlightCameraFeel(
      ctx.flightCameraFeelState,
      { throttle01: 0, strafe01: 0, lift01: 0, boost01: 0 },
      instance.spec,
      dt,
    );
    ctx.flightCameraFeelFrame = feel;
    ctx.boostSfx.setLevel(
      instance.spec.boostSoundUrl,
      feel.boost01 * instance.spec.boostSoundVolume,
    );
    ctx.thrustSfx.setLevel(
      instance.spec.thrustSoundUrl,
      feel.thrust01 * instance.spec.thrustSoundVolume,
    );
    return false;
  }

  function applyCockpitLookAt(instance: ShipInstance, actions: FrameActions): void {
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

  function advanceManualFlight(
    instance: ShipInstance,
    camera: CameraState,
    actions: FrameActions,
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

    if ((camera.shipCameraView ?? "cockpit") === "cockpit") {
      ctx.flightCameraFeelFrame = updateFlightCameraFeel(
        ctx.flightCameraFeelState,
        {
          throttle01: flightInput.throttle01 ?? 0,
          strafe01: flightInput.strafe01 ?? 0,
          lift01: flightInput.lift01 ?? 0,
          boost01: flightInput.boost01 ?? 0,
        },
        instance.spec,
        dt,
      );
    } else {
      ctx.flightCameraFeelFrame = updateFlightCameraFeel(
        ctx.flightCameraFeelState,
        { throttle01: 0, strafe01: 0, lift01: 0, boost01: 0 },
        instance.spec,
        dt,
      );
    }
    ctx.boostSfx.setLevel(
      instance.spec.boostSoundUrl,
      (ctx.flightCameraFeelFrame?.boost01 ?? 0) * instance.spec.boostSoundVolume,
    );
    ctx.thrustSfx.setLevel(
      instance.spec.thrustSoundUrl,
      (ctx.flightCameraFeelFrame?.thrust01 ?? 0) * instance.spec.thrustSoundVolume,
    );

    // Cockpit look-at controls: Hold F + gaze + left-click.
    applyCockpitLookAt(instance, actions);

    if (actions.coupledToggled) {
      ctx.world.prompt = ctx.controls.isCoupledMode()
        ? "Coupled mode"
        : "Decoupled mode";
    } else if (ctx.world.flightMode === "nav") {
      ctx.world.prompt = buildNavPrompt({
        body: instance.body,
        flightMode: ctx.world.flightMode,
        quantum: ctx.world.quantum,
        planet: ctx.planet,
        seed: ctx.seed,
      });
    } else {
      ctx.world.prompt = `${deps.prompts.holdPrompt("seatLook", "look around")} · ${deps.prompts.holdPrompt("exitSeat", "get up")} · Alt+C coupled`;
    }
  }

  function updateInShipMode(input: InShipInput): boolean {
    const { actions, camera, dt } = input;
    const instance = getActiveShip(ctx.world);

    if (actions.cycleFlightModePressed && ctx.world.quantum.phase === "idle") {
      ctx.world.flightMode = cycleFlightMode(ctx.world.flightMode);
    }

    if (actions.quantumEngagePressed && ctx.world.quantum.phase === "idle") {
      const eligibility = evaluateQuantumEligibility({
        body: instance.body,
        flightMode: ctx.world.flightMode,
        quantum: ctx.world.quantum,
        planet: ctx.planet,
        seed: ctx.seed,
      });
      if (eligibility.ok) {
        ctx.world.quantum = tryBeginQuantumTravel(
          ctx.world.quantum,
          instance.body,
          ctx.planet,
          ctx.seed,
          eligibility.destinationId,
        );
      }
    }

    if (ctx.world.quantum.phase !== "idle") {
      if (advanceQuantum(instance, dt)) return true;
    } else {
      advanceManualFlight(instance, camera, actions, dt);
    }

    if (actions.exitSeatPressed && ctx.world.quantum.phase === "idle") {
      beginStandTransition(ctx.world);
    }
    if (ctx.world.quantum.phase === "idle" && ctx.world.screenFade > 0) {
      ctx.world.screenFade = Math.max(0, ctx.world.screenFade - dt * 4);
    }
    return false;
  }

  return { updateInShipMode };
}
