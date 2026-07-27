import { getActiveShip } from "../../player/world-state";
import { cycleFlightMode } from "../../flight/flight-modes";
import {
  evaluateQuantumEligibility,
  tryBeginQuantumTravel,
} from "../../flight/quantum-travel";
import { beginStandTransition } from "../../player/transitions";
import { canLeavePilotSeat } from "../../player/ship-interaction";
import { toggleShipCanopy } from "../../player/cockpit-gaze";
import { getShipLayout } from "../../player/ship-layout";
import { playShipCanopyToggleSfx } from "../../player/ship-articulation-sfx";
import { getStationLayoutOverride, worldToStationLocal } from "../../world/station";
import { sceneExitTarget, shipCrossedExit } from "../station/scene-exit";
import type { Vec3 } from "../../types";
import type { CameraState, FrameActions } from "../types";
import type { LoopContext } from "../loop-context";
import type { Prompts } from "../station/prompts";
import { advanceQuantum } from "./ship-quantum";
import { advanceManualFlight } from "./ship-manual-flight";

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

/**
 * Fly-through `scene-exit` markers: leaving a hangar for open space is a
 * continuous act, so it fires on crossing rather than on a key press. Returns
 * true when the scene swap was requested, which stops the rest of the frame —
 * the world is about to be torn down underneath it.
 */
function tryFlyThroughExit(ctx: LoopContext, position: Vec3): boolean {
  if (!ctx.onRequestScene) return false;
  const override = getStationLayoutOverride();
  if (!override) return false;
  const local = worldToStationLocal(ctx.stationFrame, position);
  for (const marker of override.sceneExitMarkers) {
    if (marker.trigger !== "fly-through" || !marker.sceneId) continue;
    if (!shipCrossedExit(marker, local)) continue;
    ctx.onRequestScene(sceneExitTarget(marker, ctx.bootstrap, ctx.systemId));
    return true;
  }
  return false;
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

    if (actions.toggleCanopyPressed) {
      const spec = getShipLayout().spec;
      if (toggleShipCanopy(instance.rig, spec)) {
        playShipCanopyToggleSfx(spec, instance.rig.canopyOpen);
      }
    }

    if (ctx.world.quantum.phase !== "idle") {
      if (advanceQuantum(ctx, instance, dt)) return true;
    } else {
      advanceManualFlight(ctx, instance, camera, actions, deps.prompts, dt);
    }

    if (actions.exitSeatPressed && ctx.world.quantum.phase === "idle") {
      // Exterior entry steps onto the ground — refuse mid-flight rather than
      // dropping the pilot into empty air.
      if (canLeavePilotSeat(instance.body)) beginStandTransition(ctx.world);
      else ctx.world.prompt = "Land before leaving the seat";
    }
    if (ctx.world.quantum.phase === "idle" && ctx.world.screenFade > 0) {
      ctx.world.screenFade = Math.max(0, ctx.world.screenFade - dt * 4);
    }
    if (ctx.world.quantum.phase === "idle" && tryFlyThroughExit(ctx, instance.body.position)) {
      return true;
    }
    return false;
  }

  return { updateInShipMode };
}
