import {
  resolveWeaponSlotPress,
  stanceIdForWeaponSlot,
} from "../../player/inventory/weapon-select";
import {
  resolveWalkAiming,
  resolveWalkInputIntent,
} from "../../player/character-locomotion";
import { itemQuantity } from "../../player/inventory/types";
import { currentWeaponFireMode } from "../../player/weapon-fire";
import {
  createRecoilPatternState,
  crosshairSpreadPx,
} from "../../player/weapon-recoil";
import type { HudUpdateParams } from "../../render/effects";
import type { CharacterInput } from "../types";
import type { LoopContext } from "../loop-context";
import type { EquippedInventory } from "../inventory/equipped";
import { resolveActiveFirearm } from "./resolve-active-firearm";
import {
  fireStateFor,
  updateWeaponCombat as runWeaponCombatUpdate,
  type WeaponCombatActions,
  type WeaponFeelState,
} from "./update-weapon-combat";

export interface WeaponCrosshairState {
  /** Bloom radius, in CSS pixels, from the recoil still on the camera. */
  spreadPx: number;
  /** Monotonic shot count; a change drives the crosshair fire pulse. */
  shotCount: number;
}

export interface WeaponCombat {
  currentAnimStance: () => ReturnType<typeof stanceIdForWeaponSlot>;
  currentWeaponPoseAiming: (input: CharacterInput) => boolean;
  activeFirearm: () => ReturnType<typeof resolveActiveFirearm>;
  updateWeaponCombat: (actions: WeaponCombatActions, dt: number) => void;
  currentCombatAmmoHud: () => HudUpdateParams["combatAmmo"];
  currentCrosshairState: () => WeaponCrosshairState;
  applyWeaponSlotPress: (press: 1 | 2 | 3 | null) => void;
}

/** On-foot / deck / station firearm selection, aiming, fire, and reload. */
export function createWeaponCombat(
  ctx: LoopContext,
  deps: { inventory: EquippedInventory },
): WeaponCombat {
  const feel: WeaponFeelState = {
    recoil: createRecoilPatternState(),
    shotCount: 0,
  };

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
    runWeaponCombatUpdate(ctx, firearm, actions, feel, dt);
  }

  function currentCrosshairState(): WeaponCrosshairState {
    return {
      shotCount: feel.shotCount,
      spreadPx: crosshairSpreadPx(ctx.controls.getLookRecoil()),
    };
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
    currentCrosshairState,
    applyWeaponSlotPress,
  };
}
