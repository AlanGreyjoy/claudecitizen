import type { GameMode } from '../types';

export const MODE_ON_FOOT: GameMode = 'on-foot';
export const MODE_ENTERING_SHIP: GameMode = 'entering-ship';
export const MODE_IN_SHIP: GameMode = 'in-ship';
export const MODE_ON_SHIP_DECK: GameMode = 'on-ship-deck';
export const MODE_LEAVING_PILOT: GameMode = 'leaving-pilot';
export const MODE_IN_STATION: GameMode = 'in-station';
export const MODE_RIDING_ELEVATOR: GameMode = 'riding-elevator';

export const SIT_TRANSITION_SECONDS = 1.3;
export const STAND_TRANSITION_SECONDS = 1.0;

export function modeLabel(mode: GameMode): string {
  switch (mode) {
    case MODE_IN_SHIP:
      return 'Ship';
    case MODE_ON_SHIP_DECK:
      return 'On Board';
    case MODE_ENTERING_SHIP:
      return 'Taking Seat';
    case MODE_LEAVING_PILOT:
      return 'Standing Up';
    case MODE_IN_STATION:
      return 'On Station';
    case MODE_RIDING_ELEVATOR:
      return 'Elevator';
    default:
      return 'On Foot';
  }
}
