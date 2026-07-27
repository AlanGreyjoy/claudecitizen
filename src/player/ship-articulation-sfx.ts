import { playSfx } from "../audio/sfx";
import type { CockpitControlAction, ShipSpec } from "./ship-layout";
import type { ShipRigState } from "./ship-rig";

/**
 * One-shot SFX for ship gear / ramp / canopy toggles. URLs come from
 * ship-controller (baked onto ShipSpec). Auto-close in flight should not call
 * these.
 */

export function playShipGearToggleSfx(spec: ShipSpec, gearDown: boolean): void {
  const url = gearDown ? spec.gearDeploySoundUrl : spec.gearRetractSoundUrl;
  if (url) playSfx(url);
}

export function playShipRampToggleSfx(spec: ShipSpec, rampDown: boolean): void {
  const url = rampDown ? spec.rampOpenSoundUrl : spec.rampCloseSoundUrl;
  if (url) playSfx(url);
}

export function playShipCanopyToggleSfx(spec: ShipSpec, canopyOpen: boolean): void {
  const url = canopyOpen ? spec.canopyOpenSoundUrl : spec.canopyCloseSoundUrl;
  if (url) playSfx(url);
}

export function playCockpitControlToggleSfx(
  action: CockpitControlAction,
  rig: ShipRigState,
  spec: ShipSpec,
): void {
  switch (action) {
    case "landing-gear":
      playShipGearToggleSfx(spec, rig.gearDown);
      return;
    case "cargo-ramp":
      playShipRampToggleSfx(spec, rig.rampDown);
      return;
    case "canopy":
      playShipCanopyToggleSfx(spec, rig.canopyOpen);
      return;
  }
}
