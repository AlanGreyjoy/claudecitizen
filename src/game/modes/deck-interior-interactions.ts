import { getActiveShip } from "../../player/world-state";
import { getShipLayout } from "../../player/ship-layout";
import {
  isOnShipRampDeck,
  nearestDeckLadder,
  nearestDoor,
  nearRampPanel,
  resolveDoorInteractAim,
  type DeckCharacterState,
} from "../../player/ship-deck";
import { getShipPlayerLocal } from "../../physics/ship-physics";
import { playShipRampToggleSfx } from "../../player/ship-articulation-sfx";
import { playSfx } from "../../audio/sfx";
import type { FrameActions } from "../types";
import type { LoopContext } from "../loop-context";
import type { Prompts } from "../station/prompts";
import { tryDeckSeatOrBed } from "./deck-seat-bed";

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

function tryDeckLadder(
  ctx: LoopContext,
  prompts: Prompts,
  actions: FrameActions,
): boolean {
  if (!ctx.shipPhysics) return false;
  const mount = nearestDeckLadder(getShipPlayerLocal(ctx.shipPhysics));
  if (!mount) return false;
  ctx.world.prompt = prompts.pressInteractPrompt(mount.ladder.label || "ladder");
  if (actions.interactPressed) {
    ctx.world.ladderClimb = {
      surface: "ship",
      ladderId: mount.ladder.id,
      along: mount.along,
    };
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
  if (tryDeckLadder(ctx, prompts, actions)) return;
  ctx.world.prompt = "";
}
