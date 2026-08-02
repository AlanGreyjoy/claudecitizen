import type { FrameActions } from "../types";
import type { LoopContext } from "../loop-context";
import type { Prompts } from "../station/prompts";
import { beginChairStandTransition } from "../../player/chair-sit";

export interface InChairMode {
  updateInChairMode: (actions: FrameActions) => void;
}

/** Furniture chair: mouse look + Hold Y to stand. No entertainment, no flight. */
export function createInChairMode(
  ctx: LoopContext,
  deps: { prompts: Prompts },
): InChairMode {
  function updateInChairMode(actions: FrameActions): void {
    ctx.flightCameraFeelFrame = null;
    ctx.boostSfx.stop();
    ctx.thrustSfx.stop();

    if (actions.exitSeatPressed) {
      beginChairStandTransition(ctx.world, ctx.stationFrame);
      return;
    }
    ctx.world.prompt = `Look around · ${deps.prompts.holdPrompt("exitSeat", "stand up")}`;
  }

  return { updateInChairMode };
}
