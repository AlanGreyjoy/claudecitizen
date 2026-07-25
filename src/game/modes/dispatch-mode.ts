import {
  MODE_IN_BED,
  MODE_IN_SHIP,
  MODE_IN_STATION,
  MODE_ON_FOOT,
  MODE_ON_SHIP_DECK,
  MODE_RIDING_ELEVATOR,
} from "../../player/modes";
import type { LoopContext } from "../loop_context";
import type { CameraState, CharacterInput, FrameActions } from "../types";
import type { OnFootMode } from "./on_foot";
import type { InShipMode } from "./in_ship";
import type { InBedMode } from "./in_bed";
import type { OnShipDeckMode } from "./on_ship_deck";
import type { InStationMode } from "./in_station";
import type { ElevatorMode } from "./elevator";
import type { Transitions } from "./transitions";

export interface ModeHandlers {
  onFoot: OnFootMode;
  inShip: InShipMode;
  inBed: InBedMode;
  onShipDeck: OnShipDeckMode;
  inStation: InStationMode;
  elevator: ElevatorMode;
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
    case MODE_ON_SHIP_DECK:
      modes.onShipDeck.updateOnShipDeckMode({ characterInput, actions, dt });
      return false;
    case MODE_IN_STATION:
      modes.inStation.updateInStationMode({ characterInput, actions, dt });
      return false;
    case MODE_RIDING_ELEVATOR:
      modes.elevator.updateElevatorMode(dt);
      return false;
    default:
      modes.transitions.updateTransitionMode(dt);
      return false;
  }
}
