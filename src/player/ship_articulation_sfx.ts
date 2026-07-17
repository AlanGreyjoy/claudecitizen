import { playSfx } from "../audio/sfx";
import type { CockpitControlAction, ShipSpec } from "./ship_layout";
import type { ShipRigState } from "./ship_rig";

/**
 * One-shot SFX for ship gear / ramp toggles. URLs come from ship-controller
 * (baked onto ShipSpec). Auto-close in flight should not call these.
 */

export function playShipGearToggleSfx(spec: ShipSpec, gearDown: boolean): void {
  const url = gearDown ? spec.gearDeploySoundUrl : spec.gearRetractSoundUrl;
  if (url) playSfx(url);
}

export function playShipRampToggleSfx(spec: ShipSpec, rampDown: boolean): void {
  const url = rampDown ? spec.rampOpenSoundUrl : spec.rampCloseSoundUrl;
  if (url) playSfx(url);
}

export function playCockpitControlToggleSfx(
  action: CockpitControlAction,
  rig: ShipRigState,
  spec: ShipSpec,
): void {
  if (action === "landing-gear") playShipGearToggleSfx(spec, rig.gearDown);
  else playShipRampToggleSfx(spec, rig.rampDown);
}
