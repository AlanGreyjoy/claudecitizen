import {
  MODE_IN_BED,
  MODE_IN_CHAIR,
  MODE_IN_SHIP,
  MODE_IN_STATION,
  MODE_ON_FOOT,
  MODE_ON_SHIP_DECK,
} from "../../player/modes";
import type { LoopContext } from "../loop-context";
import type { CameraState, CharacterInput, FrameActions } from "../types";
import type { OnFootMode } from "./on-foot";
import type { InShipMode } from "./in-ship";
import type { InBedMode } from "./in-bed";
import type { InChairMode } from "./in-chair";
import type { OnShipDeckMode } from "./on-ship-deck";
import type { InStationMode } from "./in-station";
import type { Transitions } from "./transitions";

export interface ModeHandlers {
  onFoot: OnFootMode;
  inShip: InShipMode;
  inBed: InBedMode;
  inChair: InChairMode;
  onShipDeck: OnShipDeckMode;
  inStation: InStationMode;
  transitions: Transitions;
}

/** Run the active play mode. Returns true when the frame should abort early (quantum travel). */
export function dispatchMode(
  ctx: LoopContext,
  modes: ModeHandlers,
  characterInput: CharacterInput,
  actions: FrameActions,
  camera: CameraState,
  weaponPoseAiming: boolean,
  dt: number,
): boolean {
  switch (ctx.world.mode) {
    case MODE_ON_FOOT:
      modes.onFoot.updateOnFootMode(
        { characterInput, actions, dt },
        weaponPoseAiming,
      );
      return false;
    case MODE_IN_SHIP:
      return modes.inShip.updateInShipMode({ actions, camera, dt });
    case MODE_IN_BED:
      modes.inBed.updateInBedMode(actions);
      return false;
    case MODE_IN_CHAIR:
      modes.inChair.updateInChairMode(actions);
      return false;
    case MODE_ON_SHIP_DECK:
      modes.onShipDeck.updateOnShipDeckMode({ characterInput, actions, dt });
      return false;
    case MODE_IN_STATION:
      modes.inStation.updateInStationMode({ characterInput, actions, dt });
      return false;
    default:
      modes.transitions.updateTransitionMode(dt);
      return false;
  }
}
