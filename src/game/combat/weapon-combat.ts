import {
  resolveWeaponSlotPress,
  stanceIdForWeaponSlot,
} from "../../player/inventory/weapon_select";
import {
  resolveWalkAiming,
  resolveWalkInputIntent,
} from "../../player/character_locomotion";
import { itemQuantity } from "../../player/inventory/types";
import { currentWeaponFireMode } from "../../player/weapon_fire";
import type { HudUpdateParams } from "../../render/effects";
import type { CharacterInput } from "../types";
import type { LoopContext } from "../loop_context";
import type { EquippedInventory } from "../inventory/equipped";
import { resolveActiveFirearm } from "./resolve_active_firearm";
import {
  fireStateFor,
  updateWeaponCombat as runWeaponCombatUpdate,
  type WeaponCombatActions,
} from "./update_weapon_combat";

export interface WeaponCombat {
  currentAnimStance: () => ReturnType<typeof stanceIdForWeaponSlot>;
  currentWeaponPoseAiming: (input: CharacterInput) => boolean;
  activeFirearm: () => ReturnType<typeof resolveActiveFirearm>;
  updateWeaponCombat: (actions: WeaponCombatActions, dt: number) => void;
  currentCombatAmmoHud: () => HudUpdateParams["combatAmmo"];
  applyWeaponSlotPress: (press: 1 | 2 | 3 | null) => void;
}

/** On-foot / deck / station firearm selection, aiming, fire, and reload. */
export function createWeaponCombat(
  ctx: LoopContext,
  deps: { inventory: EquippedInventory },
): WeaponCombat {
  function currentAnimStance() {
    if (ctx.activeWeaponSlotId) {
      const loadout = ctx.getInventory()?.loadout ?? ctx.getInventoryLoadout() ?? {};
      if (!loadout[ctx.activeWeaponSlotId]) ctx.activeWeaponSlotId = null;
    }
    return stanceIdForWeaponSlot(ctx.activeWeaponSlotId);
  }

  function currentWeaponAiming() {
    return ctx.activeWeaponSlotId !== null && ctx.controls.isSecondaryClickHeld();
  }

  function currentWeaponPoseAiming(input: CharacterInput) {
    return resolveWalkAiming(
      currentWeaponAiming(),
      resolveWalkInputIntent(input),
    );
  }

  function activeFirearm() {
    return resolveActiveFirearm(ctx);
  }

  function updateWeaponCombat(actions: WeaponCombatActions, dt: number): void {
    const firearm = activeFirearm();
    if (!firearm) return;
    runWeaponCombatUpdate(ctx, firearm, actions, dt);
  }

  function currentCombatAmmoHud(): HudUpdateParams["combatAmmo"] {
    const firearm = activeFirearm();
    const inventory = ctx.getInventory();
    if (!firearm || !inventory) return null;
    const state = fireStateFor(ctx, firearm);
    return {
      fireMode: currentWeaponFireMode(state),
      magazineSize: state.magazineSize,
      reserveRounds: itemQuantity(inventory, firearm.ammoItemDefinitionId),
      roundsInMagazine: state.roundsInMagazine,
    };
  }

  function applyWeaponSlotPress(press: 1 | 2 | 3 | null): void {
    if (!press) return;
    const loadout = ctx.getInventory()?.loadout ?? ctx.getInventoryLoadout() ?? {};
    ctx.activeWeaponSlotId = resolveWeaponSlotPress(
      press,
      ctx.activeWeaponSlotId,
      loadout,
    );
    deps.inventory.syncEquippedInventory();
  }

  return {
    currentAnimStance,
    currentWeaponPoseAiming,
    activeFirearm,
    updateWeaponCombat,
    currentCombatAmmoHud,
    applyWeaponSlotPress,
  };
}
