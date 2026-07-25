import { getActiveShip } from "../../player/world_state";
import { getShipLayout } from "../../player/ship_layout";
import {
  isOnShipRampDeck,
  nearestDoor,
  nearRampPanel,
  resolveDoorInteractAim,
  type DeckCharacterState,
} from "../../player/ship_deck";
import { playShipRampToggleSfx } from "../../player/ship_articulation_sfx";
import { playSfx } from "../../audio/sfx";
import type { FrameActions } from "../types";
import type { LoopContext } from "../loop_context";
import type { Prompts } from "../station/prompts";
import { tryDeckSeatOrBed } from "./deck_seat_bed";

function tryDeckDoor(
  ctx: LoopContext,
  prompts: Prompts,
  actions: FrameActions,
  deckLocal: DeckCharacterState["deckLocal"],
  characterPosition: DeckCharacterState["position"],
): boolean {
  const instance = getActiveShip(ctx.world);
  const doorAim = resolveDoorInteractAim(
    instance.body,
    characterPosition,
    ctx.world.cameraOrbit.yawRadians,
    ctx.world.cameraOrbit.pitchRadians,
    ctx.world.cameraOrbit.zoomDistance,
  );
  const doorNearby = nearestDoor(deckLocal, doorAim);
  if (!doorNearby) return false;
  const door = getShipLayout().doors.find(
    (entry) => entry.id === doorNearby.doorId,
  );
  const doorRig = instance.rig.doors[doorNearby.doorId];
  if (!door || !doorRig) return false;
  ctx.world.prompt = doorRig.isOpen
    ? prompts.pressInteractPrompt(`close ${door.label}`)
    : prompts.pressInteractPrompt(`open ${door.label}`);
  if (actions.interactPressed) {
    doorRig.isOpen = !doorRig.isOpen;
    const sfx = doorRig.isOpen ? door.openSoundUrl : door.closeSoundUrl;
    if (sfx) playSfx(sfx);
  }
  return true;
}

function tryDeckRampPanel(
  ctx: LoopContext,
  prompts: Prompts,
  actions: FrameActions,
  deckLocal: DeckCharacterState["deckLocal"],
): boolean {
  const standingOnRamp = isOnShipRampDeck(deckLocal);
  if (!nearRampPanel(deckLocal) || standingOnRamp) return false;
  const rig = getActiveShip(ctx.world).rig;
  ctx.world.prompt = rig.rampDown
    ? prompts.pressInteractPrompt("raise ramp")
    : prompts.pressInteractPrompt("lower ramp");
  if (actions.interactPressed) {
    rig.rampDown = !rig.rampDown;
    playShipRampToggleSfx(getShipLayout().spec, rig.rampDown);
  }
  return true;
}

/** Seat / bed / door / ramp prompts and F-key handlers while inside the hull. */
export function handleDeckInteriorInteractions(
  ctx: LoopContext,
  prompts: Prompts,
  actions: FrameActions,
  deckLocal: DeckCharacterState["deckLocal"],
  characterPosition: DeckCharacterState["position"],
): void {
  const instance = getActiveShip(ctx.world);
  if (
    tryDeckSeatOrBed(
      ctx,
      instance.body,
      prompts,
      actions,
      deckLocal,
      characterPosition,
    )
  ) {
    return;
  }
  if (tryDeckDoor(ctx, prompts, actions, deckLocal, characterPosition)) return;
  if (tryDeckRampPanel(ctx, prompts, actions, deckLocal)) return;
  ctx.world.prompt = "";
}
