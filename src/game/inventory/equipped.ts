import {
  normalizeInventoryState,
  type InventoryState,
  type LoadoutState,
} from "../../player/inventory/types";
import type { LoopContext } from "../loop_context";

export interface EquippedInventory {
  syncEquippedInventory: (inventory?: InventoryState | null) => void;
  setEquippedLoadout: (loadout: LoadoutState) => void;
}

/** Pushes the normalized inventory + active weapon slot into the renderer. */
export function createEquippedInventory(ctx: LoopContext): EquippedInventory {
  function syncEquippedInventory(inventory?: InventoryState | null): void {
    const next = inventory
      ? normalizeInventoryState(inventory)
      : normalizeInventoryState(
          ctx.getInventory() ?? {
            catalog: [],
            items: [],
            loadout: ctx.getInventoryLoadout(),
          },
        );
    if (ctx.activeWeaponSlotId && !next.loadout[ctx.activeWeaponSlotId]) {
      ctx.activeWeaponSlotId = null;
    }
    ctx.renderer?.setEquippedInventory(next, ctx.activeWeaponSlotId);
  }

  function setEquippedLoadout(loadout: LoadoutState): void {
    const current = ctx.getInventory();
    if (current) {
      syncEquippedInventory({ ...current, loadout });
      return;
    }
    syncEquippedInventory({ catalog: [], items: [], loadout });
  }

  return { syncEquippedInventory, setEquippedLoadout };
}
