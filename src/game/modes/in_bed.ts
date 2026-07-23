import { getActiveShip } from "../../player/world_state";
import { getShipLayout } from "../../player/ship_layout";
import {
  getBedEyeLocal,
  localOffsetToWorld,
} from "../../player/ship_interaction";
import { resolveSeatLookForward } from "../../flight/flight_aim";
import {
  entertainmentSystemLabel,
  resolveEntertainmentGazeTarget,
} from "../../player/entertainment_gaze";
import { beginGetUpFromBedTransition } from "../../player/transitions";
import type { FrameActions } from "../types";
import type { LoopContext } from "../loop_context";
import type { Prompts } from "../station/prompts";

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
    const bedShip = getActiveShip(ctx.world);

    const layout = getShipLayout();
    const eyeLocal = getBedEyeLocal(ctx.world.activeBedId) ?? layout.pilotEye;
    const eye = localOffsetToWorld(bedShip.body, eyeLocal);
    const seat = ctx.controls.getSeatLook();
    const view = resolveSeatLookForward(
      bedShip.body.forward,
      bedShip.body.up,
      seat.yawRadians,
      seat.pitchRadians,
    );
    const esHit = resolveEntertainmentGazeTarget(
      layout.entertainmentSystems,
      bedShip.body,
      eye,
      view.forward,
    );

    if (ctx.esScreen && ctx.renderer && layout.entertainmentSystems.length > 0) {
      ctx.esScreen.attachTo(ctx.renderer.getActiveShipGroup());
      // Keep the physical panel anchored while in bed (nearest gaze or first).
      ctx.esScreen.setSpec(esHit?.system ?? layout.entertainmentSystems[0]!);
    }

    if (esHit && actions.interactPressed && ctx.entertainmentSystem && !ctx.entertainmentSystem.isOpen()) {
      ctx.esScreen?.setPowered(true);
      ctx.esScreen?.setInteractive(true);
      ctx.entertainmentSystem.open({
        onExitBed: () => {
          ctx.esScreen?.setInteractive(false);
          ctx.esScreen?.setPowered(false);
          beginGetUpFromBedTransition(ctx.world);
        },
        onClose: () => {
          ctx.esScreen?.setInteractive(false);
          ctx.esScreen?.setPowered(false);
        },
      });
      ctx.world.prompt = "";
    }

    if (actions.exitSeatPressed) {
      ctx.entertainmentSystem?.close();
      ctx.esScreen?.setInteractive(false);
      ctx.esScreen?.setPowered(false);
      ctx.esScreen?.setSpec(null);
      beginGetUpFromBedTransition(ctx.world);
    } else if (!ctx.entertainmentSystem?.isOpen()) {
      ctx.esScreen?.setInteractive(false);
      ctx.esScreen?.setPowered(false);
      ctx.world.prompt = esHit
        ? `${deps.prompts.pressInteractPrompt(entertainmentSystemLabel(esHit.system))} · ${deps.prompts.holdPrompt("exitSeat", "get up")}`
        : `Look around · ${deps.prompts.holdPrompt("exitSeat", "get up")}`;
    }
  }

  return { updateInBedMode };
}
