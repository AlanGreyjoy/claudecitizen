export type ShipFlightMode = 'traverse' | 'combat' | 'nav';

const CYCLE: readonly ShipFlightMode[] = ['traverse', 'combat', 'nav'];

export function cycleFlightMode(mode: ShipFlightMode): ShipFlightMode {
  const index = CYCLE.indexOf(mode);
  return CYCLE[(index + 1) % CYCLE.length] ?? 'traverse';
}

export function flightModeLabel(mode: ShipFlightMode): string {
  switch (mode) {
    case 'traverse':
      return 'Traverse';
    case 'combat':
      return 'Combat';
    case 'nav':
      return 'Nav';
  }
}
