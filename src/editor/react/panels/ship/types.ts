import type { ShipLayoutIssue } from '../../../../player/ship-layout-issues';

/** Where a ship playtest runs. */
export type ShipTestEnv = 'pad' | 'planet';

export const SHIP_TEST_ENVS: ReadonlyArray<{
  id: ShipTestEnv;
  label: string;
  hint: string;
}> = [
  {
    id: 'pad',
    label: 'Pad',
    hint: 'Flat pad, no terrain — fastest loop for deck, doors, ramp, and flight feel.',
  },
  {
    id: 'planet',
    label: 'Planet',
    hint: 'Full world — terrain, landing clamp, and the walk-off handoff to the surface.',
  },
];

/** Imperative surface the editor session needs from the Ship tab. */
export interface ShipEditor {
  getTestEnv: () => ShipTestEnv;
  refreshIssues: () => Promise<void>;
}

export interface ShipIssueList {
  issues: ShipLayoutIssue[];
  /** Null until the first build finishes. */
  checkedPrefabId: string | null;
  building: boolean;
  error: string | null;
}
