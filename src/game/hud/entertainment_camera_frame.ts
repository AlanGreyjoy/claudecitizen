import { MODE_IN_BED, MODE_IN_SHIP } from "../../player/modes";
import type { getActiveShipBody } from "../../player/world_state";
import { getShipLayout } from "../../player/ship_layout";
import { getBedEyeLocal, localOffsetToWorld } from "../../player/ship_interaction";
import { resolveSeatLookForward } from "../../flight/flight_aim";
import { resolveEntertainmentGazeTarget } from "../../player/entertainment_gaze";
import {
  updateEntertainmentCameraFeel,
  type EntertainmentCameraFeel,
} from "../../player/entertainment_camera";
import type { LoopContext } from "../loop_context";

/** SC-style bunk screen zoom — ease even while ES UI pauses the sim. */
export function renderEntertainmentCameraFeel(
  ctx: LoopContext,
  frameDt: number,
  activeShip: ReturnType<typeof getActiveShipBody>,
): EntertainmentCameraFeel | null {
  if (ctx.world.mode === MODE_IN_BED || ctx.entertainmentSystem?.isOpen()) {
    const layout = getShipLayout();
    const systems = layout.entertainmentSystems;
    if (systems.length === 0) return null;
    const eyeLocal = getBedEyeLocal(ctx.world.activeBedId) ?? layout.pilotEye;
    const eye = localOffsetToWorld(activeShip, eyeLocal);
    const seat = ctx.controls.getSeatLook();
    const view = resolveSeatLookForward(
      activeShip.forward,
      activeShip.up,
      seat.yawRadians,
      seat.pitchRadians,
    );
    const esHit = resolveEntertainmentGazeTarget(
      systems,
      activeShip,
      eye,
      view.forward,
    );
    const screenSpec = esHit?.system ?? systems[0]!;
    const screen = localOffsetToWorld(activeShip, screenSpec.position);
    return updateEntertainmentCameraFeel(ctx.esCameraState, {
      dt: frameDt,
      open: ctx.entertainmentSystem?.isOpen() ?? false,
      gazing: Boolean(esHit),
      eye,
      screen,
      viewForward: view.forward,
    });
  }
  if (ctx.esCameraState.focus01 > 0) {
    ctx.esCameraState.focus01 = 0;
  }
  return null;
}

export function characterVisibleInMode(mode: string): boolean {
  return mode !== MODE_IN_SHIP && mode !== MODE_IN_BED;
}
