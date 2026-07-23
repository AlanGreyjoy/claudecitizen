import type { FrameActions } from "../types";
import type { LoopContext } from "../loop_context";
import type { Prompts } from "../station/prompts";
import { updateBedEntertainment } from "./bed_entertainment";

export interface InBedMode {
  updateInBedMode: (actions: FrameActions) => void;
}

/** In-bed entertainment-system gaze/open and get-up handling. */
export function createInBedMode(
  ctx: LoopContext,
  deps: { prompts: Prompts },
): InBedMode {
  function updateInBedMode(actions: FrameActions): void {
    ctx.flightCameraFeelFrame = null;
    ctx.boostSfx.stop();
    ctx.thrustSfx.stop();
    updateBedEntertainment(ctx, actions, deps.prompts);
  }

  return { updateInBedMode };
}
