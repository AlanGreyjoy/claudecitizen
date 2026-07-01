import type { GameMode } from '../types';

export const MODE_ON_FOOT: GameMode = 'on-foot';
export const MODE_ENTERING_SHIP: GameMode = 'entering-ship';
export const MODE_IN_SHIP: GameMode = 'in-ship';
export const MODE_ON_SHIP_DECK: GameMode = 'on-ship-deck';
export const MODE_LEAVING_PILOT: GameMode = 'leaving-pilot';
export const MODE_RETURNING_PILOT: GameMode = 'returning-pilot';
export const MODE_EXITING_SHIP: GameMode = 'exiting-ship';

export const ENTER_TRANSITION_SECONDS = 1.3;
export const EXIT_TRANSITION_SECONDS = 1.05;
export const LEAVE_PILOT_TRANSITION_SECONDS = 1.0;
export const RETURN_PILOT_TRANSITION_SECONDS = 1.3;

export function modeLabel(mode: GameMode): string {
  switch (mode) {
    case MODE_IN_SHIP:
      return 'Ship';
    case MODE_ON_SHIP_DECK:
      return 'On Deck';
    case MODE_ENTERING_SHIP:
      return 'Boarding';
    case MODE_LEAVING_PILOT:
      return 'Leaving Pilot';
    case MODE_RETURNING_PILOT:
      return 'Returning Pilot';
    case MODE_EXITING_SHIP:
      return 'Disembarking';
    default:
      return 'On Foot';
  }
}
