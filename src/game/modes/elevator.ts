import { updateElevatorRide } from "../../player/station_interaction";
import { stationYawForDir } from "../../player/station_walk";
import type { LoopContext } from "../loop_context";

export interface ElevatorMode {
  updateElevatorMode: (dt: number) => void;
}

/** Station elevator ride: advance the cab and reface on arrival. */
export function createElevatorMode(ctx: LoopContext): ElevatorMode {
  function updateElevatorMode(dt: number): void {
    ctx.flightCameraFeelFrame = null;
    ctx.boostSfx.stop();
    ctx.thrustSfx.stop();
    const ride = updateElevatorRide(ctx.world, ctx.stationFrame, dt, ctx.physics);
    ctx.world.prompt = ride.destination ? `${ride.destination.label}…` : "";
    if (ride.teleportedNow && ride.destination) {
      ctx.controls.setOrbitFacing(stationYawForDir(ride.destination.face));
    }
  }

  return { updateElevatorMode };
}
