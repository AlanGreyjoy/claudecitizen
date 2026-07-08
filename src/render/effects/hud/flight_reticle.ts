import type { QuantumTravelState } from '../../../flight/quantum_travel';
import { MODE_IN_SHIP } from '../../../player/modes';
import type { ShipFlightMode } from '../../../flight/flight_modes';
import type { GameMode } from '../../../types';

export interface FlightReticleElements {
  rootEl: HTMLElement;
}

export interface FlightReticleUpdateParams {
  mode: GameMode;
  flightMode: ShipFlightMode;
  quantum: QuantumTravelState;
}

export function createFlightReticle(elements: FlightReticleElements) {
  function update({ mode, flightMode, quantum }: FlightReticleUpdateParams): void {
    const visible = mode === MODE_IN_SHIP;
    elements.rootEl.classList.toggle('is-visible', visible);
    if (!visible) return;

    elements.rootEl.dataset.flightMode = flightMode;
    elements.rootEl.dataset.quantumPhase = quantum.phase;
  }

  return { update };
}
