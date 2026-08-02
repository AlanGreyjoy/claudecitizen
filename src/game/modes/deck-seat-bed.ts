import {
  bedInteractPrompt,
  nearestBed,
  nearestChair,
  nearestSeat,
  resolveDoorInteractAim,
  seatInteractPrompt,
  chairInteractPromptFromDeck,
  type DeckCharacterState,
} from "../../player/ship-deck";
import { beginLieTransition, beginSitTransition } from "../../player/transitions";
import { beginChairSitTransition } from "../../player/chair-sit";
import type { getActiveShipBody } from "../../player/world-state";
import type { FrameActions } from "../types";
import type { LoopContext } from "../loop-context";
import type { Prompts } from "../station/prompts";

/** Seat/bed/chair prompts. Returns true when the interaction owns the prompt. */
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
  const chairNearby = nearestChair(deckLocal, doorAim);
  if (chairNearby) {
    ctx.world.prompt = chairInteractPromptFromDeck(
      chairNearby,
      prompts.keyLabel("interact"),
    );
    if (actions.interactPressed) {
      beginChairSitTransition(ctx.world, "ship", chairNearby.id);
    }
    return true;
  }

  const bedNearby = nearestBed(deckLocal, doorAim);
  if (!bedNearby) return false;
  ctx.world.prompt = bedInteractPrompt(bedNearby, prompts.keyLabel("interact"));
  if (actions.interactPressed) beginLieTransition(ctx.world, bedNearby.id);
  return true;
}
