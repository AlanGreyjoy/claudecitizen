import { usesColliderDeck } from "../../player/ship-layout";
import { DECK_FLOOR_OFFSET_METERS } from "../../player/ship-deck";
import { teleportShipPlayerLocal } from "../../physics/ship-physics";
import { updateTransition } from "../../player/transitions";
import type { LoopContext } from "../loop-context";
import type { DeckPhysics } from "../ship/deck-physics";
import type { PadInterest } from "../station/pad-interest";

export interface Transitions {
  updateTransitionMode: (dt: number) => void;
}

/** Sit/stand/lie/get-up transitions and their deck teleport landing. */
export function createTransitions(
  ctx: LoopContext,
  deps: { deckPhysics: DeckPhysics; padInterest: PadInterest },
): Transitions {
  const transitionContext = {
    planet: ctx.planet,
    seed: ctx.seed,
    setControlsMode: ctx.controls.setMode.bind(ctx.controls),
    // Exterior-entry pilots step onto the ground, not a deck. The character
    // already holds the ground pose, so this reuses the same planet-vs-hangar
    // resolution that walking off a deck goes through.
    onDisembarked: () => deps.padInterest.leaveShipDeck(),
    onDeckEntered: (
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
    },
  };

  function updateTransitionMode(dt: number): void {
    ctx.flightCameraFeelFrame = null;
    ctx.boostSfx.stop();
    ctx.thrustSfx.stop();
    updateTransition(ctx.world, dt, transitionContext);
  }

  return { updateTransitionMode };
}
