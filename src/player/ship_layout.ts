import type { LocalOffset, Vec3 } from '../types';

/**
 * Ship gameplay layout: walk zones, doors, seats, and ramp anchors in
 * ship-local right/up/forward meters. The default layout carries the Phobos
 * Starhopper values measured from the model rig; a ship prefab can replace
 * it via setShipLayoutOverride (see world/prefabs/ship_runtime.ts).
 */

export type ShipSeatRole = 'pilot' | 'copilot' | 'turret' | 'passenger';

/** Oriented walk volume baked from a rotated ship-walk-zone entity. */
export interface ShipWalkZoneOriented {
  /** Floor center in ship-local right/up/forward. */
  origin: { right: number; up: number; forward: number };
  /** Unit axes in ship-local 3-space (entity local X/Y/Z after rotation). */
  axisRight: Vec3;
  axisUp: Vec3;
  axisForward: Vec3;
  halfWidth: number;
  halfDepth: number;
  height: number;
}

export interface ShipWalkZone {
  id: string;
  minRight: number;
  maxRight: number;
  minForward: number;
  maxForward: number;
  /** Floor height (at the maxForward edge when sloped). */
  floorUp: number;
  /** Floor height at the minForward edge — slopes for ramps and steps. */
  slopeMinUp?: number;
  /** Discrete steps across the run instead of a smooth slope. */
  stepCount?: number;
  /** Vertical climb — height from climb progress, no horizontal travel. */
  ladder?: boolean;
  /** Interior ceiling for camera containment. */
  ceilingUp: number;
  /** Walkable only while the boarding ramp or the given door is open. */
  gate?: 'ramp' | { doorId: string };
  /** Passage zones connect rooms; real rooms win for camera framing. */
  passage?: boolean;
  /** Present when the prefab entity rotation tilts the walk volume off ship axes. */
  oriented?: ShipWalkZoneOriented;
}

export interface ShipDoorSpec {
  id: string;
  /** Prompt name ("Press F — open {label}"). */
  label: string;
  motion: 'slide' | 'hinge';
  axis: 'x' | 'y' | 'z';
  /** GLB node names + signed open delta (slide: meters, hinge: radians). */
  nodes: { name: string; delta: number }[];
  /** Ship-local interact anchor. */
  interact: LocalOffset;
  radius: number;
  defaultOpen: boolean;
}

export interface ShipRampInteract {
  placement: 'outside' | 'deck';
  right: number;
  forward: number;
  radius: number;
}

export interface ShipRampMount {
  minRight: number;
  maxRight: number;
  minForward: number;
  maxForward: number;
  /** Mount lands at or above this line so it does not immediately dismount. */
  clampForward: number;
}

export interface ShipSeatSpec {
  /** Prefab entity id for this seat marker. */
  id: string;
  role: ShipSeatRole;
  seat: LocalOffset;
  eye: LocalOffset;
  /** Standing spot just behind the chair after getting up (2D deck local). */
  stand: { right: number; forward: number };
  interactRadius: number;
}

export interface ShipLayout {
  /** GLB url for the flyable hull; null = built-in Phobos Starhopper. */
  hullUrl: string | null;
  /**
   * Ship origin height above the ground when parked on gear, in meters.
   * null = unauthored; previews measure the hull and rest it on the pad.
   */
  restHeightMeters: number | null;
  walkZones: ShipWalkZone[];
  doors: ShipDoorSpec[];
  /** All authored seat markers from the prefab (may be empty). */
  seats: ShipSeatSpec[];
  /** Primary flight seat — derived from the first pilot-role seat, if any. */
  pilotSeat: LocalOffset;
  pilotEye: LocalOffset;
  /** Standing spot just behind the primary pilot chair (2D deck local). */
  seatStand: { right: number; forward: number };
  rampInteracts: ShipRampInteract[];
  rampMount: ShipRampMount | null;
  /** Walking past this ship-local forward on a ramp zone steps off. */
  rampDismountForward: number;
  /** Ground spot just past the ramp tip for a character stepping off. */
  rampDismountGround: { right: number; forward: number };
}

/** Phobos Starhopper layout, measured from the model rig. */
export const DEFAULT_SHIP_LAYOUT: ShipLayout = {
  hullUrl: null,
  restHeightMeters: 3.16,
  walkZones: [
    {
      id: 'cabin',
      minRight: -2.35,
      maxRight: 2.35,
      minForward: -6.6,
      maxForward: 2.62,
      floorUp: -1.42,
      ceilingUp: 1.66,
    },
    {
      id: 'cockpit',
      minRight: -1.65,
      maxRight: 1.65,
      minForward: 2.83,
      maxForward: 7.1,
      floorUp: -0.97,
      ceilingUp: 1.66,
    },
    {
      id: 'cockpit-door',
      minRight: -0.85,
      maxRight: 0.85,
      minForward: 2.42,
      maxForward: 3.03,
      floorUp: -0.97,
      slopeMinUp: -1.42,
      ceilingUp: 1.66,
      gate: { doorId: 'cockpit' },
      passage: true,
    },
    {
      id: 'ramp',
      minRight: -1.05,
      maxRight: 1.05,
      minForward: -8.55,
      maxForward: -6.4,
      floorUp: -1.42,
      slopeMinUp: -3.14,
      ceilingUp: 1.66,
      gate: 'ramp',
    },
  ],
  doors: [
    {
      id: 'cockpit',
      label: 'cockpit',
      motion: 'slide',
      axis: 'x',
      nodes: [
        { name: 'CockpitDoor_L', delta: -1 },
        { name: 'CockpitDoor_R', delta: 1 },
      ],
      interact: { right: 0, up: 0, forward: 2.72 },
      radius: 1.55,
      defaultOpen: false,
    },
  ],
  seats: [
    {
      id: 'pilot-seat',
      role: 'pilot',
      seat: { right: 0, up: -0.62, forward: 6.05 },
      eye: { right: 0, up: 0.25, forward: 6.3 },
      stand: { right: 0, forward: 4.5 },
      interactRadius: 1.45,
    },
  ],
  pilotSeat: { right: 0, up: -0.62, forward: 6.05 },
  pilotEye: { right: 0, up: 0.25, forward: 6.3 },
  seatStand: { right: 0, forward: 4.5 },
  rampInteracts: [
    { placement: 'outside', right: 0, forward: -9.7, radius: 3.0 },
    { placement: 'deck', right: 0, forward: -5.7, radius: 1.7 },
  ],
  rampMount: {
    minRight: -1.05,
    maxRight: 1.05,
    minForward: -8.8,
    maxForward: -8.0,
    clampForward: -8.2,
  },
  rampDismountForward: -8.5,
  rampDismountGround: { right: 0, forward: -9.6 },
};

let override: ShipLayout | null = null;

export function setShipLayoutOverride(layout: ShipLayout | null): void {
  override = layout;
}

export function getShipLayoutOverride(): ShipLayout | null {
  return override;
}

export function getShipLayout(): ShipLayout {
  return override ?? DEFAULT_SHIP_LAYOUT;
}

/**
 * Gear-rest height of the active ship for parking (spawn, hangar pads,
 * landing). Unauthored prefabs fall back to the Starhopper's measured value.
 */
export function getShipRestHeightMeters(): number {
  return getShipLayout().restHeightMeters ?? DEFAULT_SHIP_LAYOUT.restHeightMeters ?? 3.16;
}
