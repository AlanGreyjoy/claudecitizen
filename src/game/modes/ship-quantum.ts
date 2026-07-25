import type { getActiveShip } from "../../player/world_state";
import {
  advanceQuantumTravel,
  consumePendingHandoffPlanetId,
} from "../../flight/quantum_travel";
import { updateFlightCameraFeel } from "../../player/flight_camera_feel";
import type { LoopContext } from "../loop_context";

type ShipInstance = ReturnType<typeof getActiveShip>;

function quantumPrompt(phase: string): string {
  if (phase === "spooling") return "Spooling…";
  if (phase === "traveling") return "Quantum travel";
  if (phase === "idle") return "";
  return "Drop out";
}

function applyIdleFlightFeel(
  ctx: LoopContext,
  instance: ShipInstance,
  dt: number,
): void {
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
}

/** Advance quantum travel; returns true when a planet handoff navigates away. */
export function advanceQuantum(
  ctx: LoopContext,
  instance: ShipInstance,
  dt: number,
): boolean {
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
  ctx.world.prompt = quantumPrompt(ctx.world.quantum.phase);
  applyIdleFlightFeel(ctx, instance, dt);
  return false;
}
