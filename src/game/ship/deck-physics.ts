import {
  DECK_FLOOR_OFFSET_METERS,
  getDeckSpawnFloorHint,
  getDefaultDeckSpawnLocal,
} from "../../player/ship_deck";
import { getShipLayout, usesColliderDeck } from "../../player/ship_layout";
import { createShipPhysics, type ShipPhysics } from "../../physics/ship_physics";
import type { LoopContext } from "../loop_context";

export interface DeckPhysics {
  warmShipDeckPhysics: () => Promise<ShipPhysics | null>;
  disposeShipDeckPhysics: () => void;
}

/** Lazy ship-local Rapier deck world lifecycle (warm/dispose). */
export function createDeckPhysics(ctx: LoopContext): DeckPhysics {
  function disposeShipDeckPhysics(): void {
    ctx.shipPhysics?.dispose();
    ctx.shipPhysics = null;
  }

  async function warmShipDeckPhysics(): Promise<ShipPhysics | null> {
    if (!usesColliderDeck()) return null;
    if (ctx.shipPhysics) return ctx.shipPhysics;
    if (ctx.shipPhysicsWarming) return null;
    ctx.shipPhysicsWarming = true;
    try {
      const spawn = getDefaultDeckSpawnLocal();
      const floorHint = getDeckSpawnFloorHint(spawn);
      // No pad plane on planet — exterior feet snap to terrain so the character
      // does not float on a flat ship-local ground disc over hills.
      ctx.shipPhysics = await createShipPhysics(
        {
          right: spawn.right,
          up: floorHint + DECK_FLOOR_OFFSET_METERS,
          forward: spawn.forward,
        },
        getShipLayout().colliders,
      );
      return ctx.shipPhysics;
    } catch (error) {
      console.warn("Failed to create ship Rapier deck physics.", error);
      ctx.shipPhysics = null;
      return null;
    } finally {
      ctx.shipPhysicsWarming = false;
    }
  }

  return { warmShipDeckPhysics, disposeShipDeckPhysics };
}
