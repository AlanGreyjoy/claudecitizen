import {
  flightOptionsFromSpec,
  integrateHoveringShip,
} from "../../flight/flight_body";
import { regenerateShipShields } from "../../flight/ship_instance";
import { listShipInstances } from "../../flight/ship_world";
import {
  getActiveShip,
  getActiveShipBody,
  getActiveShipRig,
} from "../../player/world_state";
import { updateShipRig } from "../../player/ship_rig";
import { getShipLayout } from "../../player/ship_layout";
import { nearShipRampOutside } from "../../player/ship_interaction";
import { playShipRampToggleSfx } from "../../player/ship_articulation_sfx";
import { MODE_IN_SHIP } from "../../player/modes";
import type { LoopContext } from "../loop_context";
import type { Prompts } from "../station/prompts";

export interface ShipSystems {
  updateShipSystems: (dt: number) => void;
  /** Ramp toggle prompt/action near the outside ramp control. */
  handleRampOutside: (interactPressed: boolean) => string | null;
}

/** Per-frame ship integration (unpiloted settle, rig, shields) + ramp control. */
export function createShipSystems(
  ctx: LoopContext,
  deps: { prompts: Prompts },
): ShipSystems {
  function updateShipSystems(dt: number): void {
    const pilotedId =
      ctx.world.mode === MODE_IN_SHIP ? getActiveShip(ctx.world).id : null;
    for (const instance of listShipInstances()) {
      // Unpiloted hulls still need gear-rest / hangar settle so outdoor
      // parking matches sandbox (ramp outside F + atShipGroundLevel).
      if (instance.id !== pilotedId) {
        instance.body = integrateHoveringShip(
          instance.body,
          dt,
          ctx.planet,
          ctx.seed,
          flightOptionsFromSpec(instance.spec),
        );
      }
      const rig = instance.rig;
      updateShipRig(rig, dt);
      regenerateShipShields(instance, dt);
    }
  }

  function handleRampOutside(interactPressed: boolean): string | null {
    const ship = getActiveShipBody(ctx.world);
    const rig = getActiveShipRig(ctx.world);
    if (!nearShipRampOutside(ctx.world.character, ship)) return null;
    if (interactPressed) {
      rig.rampDown = !rig.rampDown;
      playShipRampToggleSfx(getShipLayout().spec, rig.rampDown);
    }
    return rig.rampDown
      ? deps.prompts.pressInteractPrompt("raise ramp")
      : deps.prompts.pressInteractPrompt("lower ramp");
  }

  return { updateShipSystems, handleRampOutside };
}
