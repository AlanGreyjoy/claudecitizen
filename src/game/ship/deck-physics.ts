import {
  DECK_FLOOR_OFFSET_METERS,
  getDeckSpawnFloorHint,
  getDefaultDeckSpawnLocal,
} from "../../player/ship-deck";
import {
  getShipLayout,
  getShipRestHeightMeters,
  usesColliderDeck,
} from "../../player/ship-layout";
import {
  createShipPhysics,
  SHIP_NEAR_PAD_HALF_EXTENT_METERS,
  type ShipPhysics,
} from "../../physics/ship-physics";
import type { LoopContext } from "../loop-context";

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
      // The pad is the ground under a player walking around a hangar-parked
      // hull. It is built here but left disabled: on a planet, exterior feet
      // snap to terrain instead, and a flat ship-local disc would float over
      // hills. `pad-interest` enables it for hangars only.
      //
      // Without it, `setPadEnabled`/`setPadRestHeight` were silent no-ops in
      // the game (the sandbox passes its own pad, which is why walking around
      // a hull only ever worked in Test), so boarding in a hangar dropped the
      // player into a ship-local world with nothing under their feet.
      ctx.shipPhysics = await createShipPhysics(
        {
          right: spawn.right,
          up: floorHint + DECK_FLOOR_OFFSET_METERS,
          forward: spawn.forward,
        },
        getShipLayout().colliders,
        {
          pad: {
            restHeightMeters: getShipRestHeightMeters(),
            halfExtentMeters: SHIP_NEAR_PAD_HALF_EXTENT_METERS,
          },
        },
      );
      ctx.shipPhysics.setPadEnabled(false);
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
