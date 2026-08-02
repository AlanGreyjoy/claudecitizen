import { usesColliderDeck } from "../../player/ship-layout";
import { DECK_FLOOR_OFFSET_METERS } from "../../player/ship-deck";
import { teleportShipPlayerLocal } from "../../physics/ship-physics";
import { teleportStationPlayer } from "../../physics/station-physics";
import { updateTransition } from "../../player/transitions";
import {
  isChairOccupancyMode,
  MODE_ENTERING_CHAIR,
  MODE_LEAVING_CHAIR,
} from "../../player/modes";
import { updateChairTransition } from "../../player/chair-sit";
import type { LoopContext } from "../loop-context";
import type { DeckPhysics } from "../ship/deck-physics";
import type { PadInterest } from "../station/pad-interest";

export interface Transitions {
  updateTransitionMode: (dt: number) => void;
}

/** Sit/stand/lie/get-up/chair transitions and their deck/station teleport landing. */
export function createTransitions(
  ctx: LoopContext,
  deps: { deckPhysics: DeckPhysics; padInterest: PadInterest },
): Transitions {
  const onDeckEntered = (
    local: { right: number; forward: number },
    floorUp: number,
  ) => {
    if (!usesColliderDeck()) return;
    if (!ctx.shipPhysics) {
      void deps.deckPhysics.warmShipDeckPhysics().then((physics) => {
        if (!physics) return;
        teleportShipPlayerLocal(physics, {
          right: local.right,
          up: floorUp + DECK_FLOOR_OFFSET_METERS,
          forward: local.forward,
        });
      });
      return;
    }
    teleportShipPlayerLocal(ctx.shipPhysics, {
      right: local.right,
      up: floorUp + DECK_FLOOR_OFFSET_METERS,
      forward: local.forward,
    });
  };

  const transitionContext = {
    planet: ctx.planet,
    seed: ctx.seed,
    setControlsMode: ctx.controls.setMode.bind(ctx.controls),
    // Exterior-entry pilots step onto the ground, not a deck. The character
    // already holds the ground pose, so this reuses the same planet-vs-hangar
    // resolution that walking off a deck goes through.
    onDisembarked: () => deps.padInterest.leaveShipDeck(),
    onDeckEntered,
  };

  const chairContext = {
    planet: ctx.planet,
    seed: ctx.seed,
    stationFrame: ctx.stationFrame,
    setControlsMode: ctx.controls.setMode.bind(ctx.controls),
    onDeckEntered,
    onStationEntered: (position: { x: number; y: number; z: number }) => {
      if (!ctx.physics) return;
      teleportStationPlayer(ctx.physics, ctx.stationFrame, position);
    },
  };

  function updateTransitionMode(dt: number): void {
    ctx.flightCameraFeelFrame = null;
    ctx.boostSfx.stop();
    ctx.thrustSfx.stop();
    const mode = ctx.world.mode;
    const transitionType = ctx.world.transition?.type;
    if (
      isChairOccupancyMode(mode) ||
      mode === MODE_ENTERING_CHAIR ||
      mode === MODE_LEAVING_CHAIR ||
      transitionType === "chair-sit" ||
      transitionType === "chair-stand"
    ) {
      chairContext.stationFrame = ctx.stationFrame;
      updateChairTransition(ctx.world, dt, chairContext);
      return;
    }
    updateTransition(ctx.world, dt, transitionContext);
  }

  return { updateTransitionMode };
}
