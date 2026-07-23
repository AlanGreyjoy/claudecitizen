import type { WalkModeInput } from "../types";
import type { LoopContext } from "../loop_context";
import type { WeaponCombat } from "../combat/weapon_combat";
import type { PadInterest } from "../station/pad_interest";
import type { ShipSystems } from "../ship/systems";
import type { Prompts } from "../station/prompts";
import { updateDeckMode } from "./deck_locomotion";

export interface OnShipDeckMode {
  updateOnShipDeckMode: (input: WalkModeInput) => void;
}

/** Ship-deck walking (interior + exterior hull/pad) with seat/bed/door/ramp. */
export function createOnShipDeckMode(
  ctx: LoopContext,
  deps: {
    combat: WeaponCombat;
    padInterest: PadInterest;
    shipSystems: ShipSystems;
    prompts: Prompts;
  },
): OnShipDeckMode {
  function updateOnShipDeckMode(input: WalkModeInput): void {
    ctx.flightCameraFeelFrame = null;
    ctx.boostSfx.stop();
    ctx.thrustSfx.stop();
    updateDeckMode(ctx, deps, input);
  }

  return { updateOnShipDeckMode };
}
