import { getActiveShip } from "../../player/world_state";
import { cycleFlightMode } from "../../flight/flight_modes";
import {
  evaluateQuantumEligibility,
  tryBeginQuantumTravel,
} from "../../flight/quantum_travel";
import { beginStandTransition } from "../../player/transitions";
import type { CameraState, FrameActions } from "../types";
import type { LoopContext } from "../loop_context";
import type { Prompts } from "../station/prompts";
import { advanceQuantum } from "./ship_quantum";
import { advanceManualFlight } from "./ship_manual_flight";

interface InShipInput {
  actions: FrameActions;
  camera: CameraState;
  dt: number;
}

export interface InShipMode {
  /** Returns true when a quantum handoff navigated the page away (stop the frame). */
  updateInShipMode: (input: InShipInput) => boolean;
}

function tryEngageQuantum(ctx: LoopContext): void {
  const instance = getActiveShip(ctx.world);
  const eligibility = evaluateQuantumEligibility({
    body: instance.body,
    flightMode: ctx.world.flightMode,
    quantum: ctx.world.quantum,
    planet: ctx.planet,
    seed: ctx.seed,
  });
  if (!eligibility.ok) return;
  ctx.world.quantum = tryBeginQuantumTravel(
    ctx.world.quantum,
    instance.body,
    ctx.planet,
    ctx.seed,
    eligibility.destinationId,
  );
}

/** Cockpit flight: IFCS integrate, dual-reticle aim, quantum travel, look-at. */
export function createInShipMode(
  ctx: LoopContext,
  deps: { prompts: Prompts },
): InShipMode {
  function updateInShipMode(input: InShipInput): boolean {
    const { actions, camera, dt } = input;
    const instance = getActiveShip(ctx.world);

    if (actions.cycleFlightModePressed && ctx.world.quantum.phase === "idle") {
      ctx.world.flightMode = cycleFlightMode(ctx.world.flightMode);
    }

    if (actions.quantumEngagePressed && ctx.world.quantum.phase === "idle") {
      tryEngageQuantum(ctx);
    }

    if (ctx.world.quantum.phase !== "idle") {
      if (advanceQuantum(ctx, instance, dt)) return true;
    } else {
      advanceManualFlight(ctx, instance, camera, actions, deps.prompts, dt);
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
