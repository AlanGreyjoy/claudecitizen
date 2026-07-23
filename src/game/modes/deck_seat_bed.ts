import {
  bedInteractPrompt,
  nearestBed,
  nearestSeat,
  resolveDoorInteractAim,
  seatInteractPrompt,
  type DeckCharacterState,
} from "../../player/ship_deck";
import { beginLieTransition, beginSitTransition } from "../../player/transitions";
import type { getActiveShipBody } from "../../player/world_state";
import type { FrameActions } from "../types";
import type { LoopContext } from "../loop_context";
import type { Prompts } from "../station/prompts";

/** Seat/bed prompts. Returns true when the interaction owns the prompt. */
export function tryDeckSeatOrBed(
  ctx: LoopContext,
  shipBody: ReturnType<typeof getActiveShipBody>,
  prompts: Prompts,
  actions: FrameActions,
  deckLocal: DeckCharacterState["deckLocal"],
  characterPosition: DeckCharacterState["position"],
): boolean {
  const seatNearby = nearestSeat(deckLocal);
  if (seatNearby) {
    ctx.world.prompt = seatInteractPrompt(seatNearby, prompts.keyLabel("interact"));
    if (actions.interactPressed && seatNearby.role === "pilot") {
      beginSitTransition(ctx.world);
    }
    return true;
  }

  const doorAim = resolveDoorInteractAim(
    shipBody,
    characterPosition,
    ctx.world.cameraOrbit.yawRadians,
    ctx.world.cameraOrbit.pitchRadians,
    ctx.world.cameraOrbit.zoomDistance,
  );
  const bedNearby = nearestBed(deckLocal, doorAim);
  if (!bedNearby) return false;
  ctx.world.prompt = bedInteractPrompt(bedNearby, prompts.keyLabel("interact"));
  if (actions.interactPressed) beginLieTransition(ctx.world, bedNearby.id);
  return true;
}
