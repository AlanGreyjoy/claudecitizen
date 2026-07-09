import { FLIGHT_CONFIG } from "../flight/flight_config";
import type { LocalOffset, Vec3 } from "../types";
import type { GameplayCollider } from "../physics/colliders";

/**
 * Ship gameplay layout: walk zones, doors, seats, and ramp anchors in
 * ship-local right/up/forward meters. Prefab authoring via ship-controller
 * and GLB node colliders replaces the empty default stub.
 */

/** Hinge binding for landing gear articulation (GLB node + deploy angle). */
export interface ShipGearHingeSpec {
  name: string;
  deployRadians: number;
  axis?: "x" | "y" | "z";
}

/** Hinge binding for the boarding ramp (GLB node + lowered angle). */
export interface ShipRampHingeSpec {
  name: string;
  lowerRadians: number;
  axis?: "x" | "y" | "z";
}

/** Static per-ship-type stats and articulation authored on the prefab. */
export interface ShipSpec {
  maxSpeedMps: number;
  throttleAccelMps2: number;
  maxHp: number;
  maxShields: number;
  shieldRegenPerSec: number;
  gearHinges: ShipGearHingeSpec[];
  rampHinge: ShipRampHingeSpec | null;
}

/** Starhopper gear/ramp hinges — shared by layout defaults and render fallback. */
export const DEFAULT_STARHOPPER_GEAR_HINGES: ShipGearHingeSpec[] = [
  { name: "LandingGear_BackLeft", deployRadians: -0.55 },
  { name: "LandingGear_BackRight", deployRadians: -0.55 },
  { name: "LandingLeg_Front", deployRadians: 1.4 },
];

export const DEFAULT_STARHOPPER_RAMP_HINGE: ShipRampHingeSpec = {
  name: "RampParent",
  lowerRadians: -0.62,
};

export const DEFAULT_SHIP_SPEC: ShipSpec = {
  maxSpeedMps: FLIGHT_CONFIG.MAX_SPEED_METERS_PER_SECOND,
  throttleAccelMps2: FLIGHT_CONFIG.THROTTLE_ACCEL,
  maxHp: 1000,
  maxShields: 500,
  shieldRegenPerSec: 25,
  gearHinges: DEFAULT_STARHOPPER_GEAR_HINGES,
  rampHinge: DEFAULT_STARHOPPER_RAMP_HINGE,
};

export type ShipSeatRole = "pilot" | "copilot" | "turret" | "passenger";

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
  gate?: "ramp" | { doorId: string };
  /** Passage zones connect rooms; real rooms win for camera framing. */
  passage?: boolean;
  /** Present when the prefab entity rotation tilts the walk volume off ship axes. */
  oriented?: ShipWalkZoneOriented;
}

export interface ShipDoorSpec {
  id: string;
  /** Prompt name ("Press F — open {label}"). */
  label: string;
  motion: "slide" | "hinge";
  axis: "x" | "y" | "z";
  /** GLB node names + signed open delta (slide: meters, hinge: radians). */
  nodes: { name: string; delta: number }[];
  /** Ship-local interact anchor. */
  interact: LocalOffset;
  radius: number;
  defaultOpen: boolean;
}

export interface ShipRampInteract {
  placement: "outside" | "deck";
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

export interface ShipCameraBounds {
  id: string;
  minRight: number;
  maxRight: number;
  minForward: number;
  maxForward: number;
  /** Floor at maxForward (ship/deck end of the volume). */
  floorUp: number;
  /** Floor at minForward when the volume slopes (e.g. ramp to the pad). */
  slopeMinUp?: number;
  ceilingUp: number;
  /** Ramp volumes open to the outside skip interior camera clamping. */
  openToOutside?: boolean;
}

export interface ShipLayout {
  /** Combat, speed, and articulation tuning baked from ship-stats / gear / ramp. */
  spec: ShipSpec;
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
  colliders: GameplayCollider[];
  /** Walking past this ship-local forward on a ramp zone steps off. */
  rampDismountForward: number;
  /** Ground spot just past the ramp tip for a character stepping off. */
  rampDismountGround: { right: number; forward: number };
  /** Interior camera clamp volumes (collider-deck ships). */
  cameraBounds: ShipCameraBounds[];
  /** Optional authored deck spawn from ship-controller.deckSpawnEntityId. */
  deckSpawn?: { right: number; forward: number };
}

/** Minimal fallback when a ship prefab is missing or not yet loaded. */
export const DEFAULT_SHIP_LAYOUT: ShipLayout = {
  spec: DEFAULT_SHIP_SPEC,
  hullUrl: null,
  restHeightMeters: 3.16,
  walkZones: [],
  doors: [],
  seats: [],
  pilotSeat: { right: 0, up: -0.62, forward: 6.05 },
  pilotEye: { right: 0, up: 0.25, forward: 6.3 },
  seatStand: { right: 0, forward: 4.5 },
  rampInteracts: [],
  rampMount: null,
  colliders: [],
  rampDismountForward: -Infinity,
  rampDismountGround: { right: 0, forward: 0 },
  cameraBounds: [],
};

let override: ShipLayout | null = null;
const layoutByPrefabId = new Map<string, ShipLayout>();
let activePrefabId: string | null = null;

export function setShipLayoutOverride(layout: ShipLayout | null): void {
  override = layout;
}

export function getShipLayoutOverride(): ShipLayout | null {
  return override;
}

/** Caches a baked layout for a prefab id (multi-ship / render pool). */
export function registerShipLayoutForPrefab(
  prefabId: string,
  layout: ShipLayout,
): void {
  layoutByPrefabId.set(prefabId, layout);
}

export function getShipLayoutForPrefab(prefabId: string): ShipLayout {
  return layoutByPrefabId.get(prefabId) ?? DEFAULT_SHIP_LAYOUT;
}

/** Selects which prefab layout getShipLayout() returns for deck/rig helpers. */
export function setActiveShipPrefabId(prefabId: string): void {
  activePrefabId = prefabId;
  const cached = layoutByPrefabId.get(prefabId);
  if (cached) setShipLayoutOverride(cached);
}

export function getActiveShipPrefabId(): string | null {
  return activePrefabId;
}

export function getShipLayout(): ShipLayout {
  if (activePrefabId) {
    const cached = layoutByPrefabId.get(activePrefabId);
    if (cached) return cached;
  }
  return override ?? DEFAULT_SHIP_LAYOUT;
}

/**
 * Gear-rest height of the active ship for parking (spawn, hangar pads,
 * landing). Unauthored prefabs fall back to the Starhopper's measured value.
 */
export function getShipRestHeightMeters(): number {
  return (
    getShipLayout().restHeightMeters ??
    DEFAULT_SHIP_LAYOUT.restHeightMeters ??
    3.16
  );
}

/** True when deck walking uses collider geometry instead of walk zones. */
export function usesColliderDeck(): boolean {
  const layout = getShipLayout();
  return layout.walkZones.length === 0 && layout.colliders.length > 0;
}
