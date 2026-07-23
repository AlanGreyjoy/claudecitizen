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
  type EntertainmentGazeHit,
} from "../../player/entertainment_gaze";
import { beginGetUpFromBedTransition } from "../../player/transitions";
import type { FrameActions } from "../types";
import type { LoopContext } from "../loop_context";
import type { Prompts } from "../station/prompts";

function resolveBedEntertainmentHit(
  ctx: LoopContext,
): EntertainmentGazeHit | null {
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
  return resolveEntertainmentGazeTarget(
    layout.entertainmentSystems,
    bedShip.body,
    eye,
    view.forward,
  );
}

export function syncBedEntertainmentScreen(
  ctx: LoopContext,
  esHit: EntertainmentGazeHit | null,
): void {
  const systems = getShipLayout().entertainmentSystems;
  if (!ctx.esScreen || !ctx.renderer || systems.length === 0) return;
  ctx.esScreen.attachTo(ctx.renderer.getActiveShipGroup());
  ctx.esScreen.setSpec(esHit?.system ?? systems[0]!);
}

export function tryOpenBedEntertainment(
  ctx: LoopContext,
  esHit: EntertainmentGazeHit | null,
  actions: FrameActions,
): boolean {
  if (
    !esHit ||
    !actions.interactPressed ||
    !ctx.entertainmentSystem ||
    ctx.entertainmentSystem.isOpen()
  ) {
    return false;
  }
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
  return true;
}

export function updateBedExitAndPrompt(
  ctx: LoopContext,
  esHit: EntertainmentGazeHit | null,
  actions: FrameActions,
  prompts: Prompts,
): void {
  if (actions.exitSeatPressed) {
    ctx.entertainmentSystem?.close();
    ctx.esScreen?.setInteractive(false);
    ctx.esScreen?.setPowered(false);
    ctx.esScreen?.setSpec(null);
    beginGetUpFromBedTransition(ctx.world);
    return;
  }
  if (ctx.entertainmentSystem?.isOpen()) return;
  ctx.esScreen?.setInteractive(false);
  ctx.esScreen?.setPowered(false);
  ctx.world.prompt = esHit
    ? `${prompts.pressInteractPrompt(entertainmentSystemLabel(esHit.system))} · ${prompts.holdPrompt("exitSeat", "get up")}`
    : `Look around · ${prompts.holdPrompt("exitSeat", "get up")}`;
}

/** Resolve bunk entertainment gaze and drive open/close/prompt. */
export function updateBedEntertainment(
  ctx: LoopContext,
  actions: FrameActions,
  prompts: Prompts,
): void {
  const esHit = resolveBedEntertainmentHit(ctx);
  syncBedEntertainmentScreen(ctx, esHit);
  if (tryOpenBedEntertainment(ctx, esHit, actions)) return;
  updateBedExitAndPrompt(ctx, esHit, actions, prompts);
}
