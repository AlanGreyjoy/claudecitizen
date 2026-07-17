import { FLIGHT_CONFIG } from "../flight/flight_config";
import type { LocalOffset, Vec3 } from "../types";
import type { GameplayCollider } from "../physics/colliders";
import type {
  CockpitControlAction,
  CockpitStatKind,
  PrefabNodeOverride,
} from "../world/prefabs/schema";
import type { PrefabSoundSpec } from "../world/prefabs/sound_runtime";

/**
 * Ship gameplay layout: walk zones, doors, seats, and ramp anchors in
 * ship-local right/up/forward meters. Prefab authoring via ship-controller
 * and GLB node colliders replaces the empty default stub.
 */

/** Hinge binding for landing gear articulation (GLB node + deploy angle). */
export interface ShipGearHingeSpec {
  name: string;
  /**
   * Unique ancestor node name. When set, `name` is resolved under that
   * subtree so mirrored legs with duplicate bone names both bind.
   */
  under?: string;
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
  /**
   * Legacy forward acceleration (m/s²). Prefer thrust/mass; kept for
   * admin/DB ships and as a derived fallback.
   */
  throttleAccelMps2: number;
  massKg: number;
  maxAngularRateRadps: number;
  forwardThrustN: number;
  backwardThrustN: number;
  verticalThrustN: number;
  lateralThrustN: number;
  pitchTorqueNm: number;
  yawTorqueNm: number;
  rollTorqueNm: number;
  /** Cockpit FOV widen (deg) at full forward thrust. */
  thrustFovForwardDeg: number;
  /** Cockpit FOV narrow (deg) at full reverse thrust. */
  thrustFovBackwardDeg: number;
  /** FOV lerp rate toward thrust target (1/s). */
  thrustFovBlendPerSec: number;
  /** Cockpit eye shake amplitude while boosting (m). */
  boostShakeAmplitudeM: number;
  /** Boost shake frequency (Hz). */
  boostShakeHz: number;
  /** How quickly boost effects / SFX fade in and out (1/s). */
  boostBlendPerSec: number;
  maxHp: number;
  maxShields: number;
  shieldRegenPerSec: number;
  gearHinges: ShipGearHingeSpec[];
  rampHinge: ShipRampHingeSpec | null;
  /** Landing gear deploy SFX (gearDown → true). */
  gearDeploySoundUrl?: string;
  /** Landing gear retract SFX (gearDown → false). */
  gearRetractSoundUrl?: string;
  /** Cargo ramp lower SFX (rampDown → true). */
  rampOpenSoundUrl?: string;
  /** Cargo ramp raise SFX (rampDown → false). */
  rampCloseSoundUrl?: string;
  /** Looping boost thruster SFX while Shift is held. */
  boostSoundUrl?: string;
  /** Boost SFX gain 0..1. */
  boostSoundVolume: number;
  /** Looping main thruster SFX while throttling forward/back. */
  thrustSoundUrl?: string;
  /** Thrust SFX gain 0..1. */
  thrustSoundVolume: number;
}

/** Starhopper gear/ramp hinges — shared by layout defaults and render fallback. */
export const DEFAULT_STARHOPPER_GEAR_HINGES: ShipGearHingeSpec[] = [
  // Front leg — Unity Take 001 multi-bone endpoints
  { name: "Front_LandingArm", deployRadians: 0.796 },
  { name: "Front_Foot", deployRadians: -0.755 },
  { name: "Front_LandingPiston", deployRadians: -0.563 },
  // Back legs — mount root + under-scoped arm/foot (duplicate bone names)
  { name: "LandingGear_BackLeft", deployRadians: -0.791 },
  {
    name: "Back_Arm",
    under: "LandingGear_BackLeft",
    deployRadians: 0.852,
  },
  {
    name: "Back_Foot",
    under: "LandingGear_BackLeft",
    deployRadians: 0.298,
    axis: "y",
  },
  { name: "LandingGear_BackRight", deployRadians: -0.791 },
  {
    name: "Back_Arm",
    under: "LandingGear_BackRight",
    deployRadians: 0.852,
  },
  {
    name: "Back_Foot",
    under: "LandingGear_BackRight",
    deployRadians: 0.298,
    axis: "y",
  },
];

export const DEFAULT_STARHOPPER_RAMP_HINGE: ShipRampHingeSpec = {
  name: "RampParent",
  lowerRadians: -0.62,
};

/** Reference mass for Starhopper-class defaults (kg). */
export const DEFAULT_SHIP_MASS_KG = 12_000;

export const DEFAULT_SHIP_SPEC: ShipSpec = {
  maxSpeedMps: FLIGHT_CONFIG.MAX_SPEED_METERS_PER_SECOND,
  throttleAccelMps2: FLIGHT_CONFIG.THROTTLE_ACCEL,
  massKg: DEFAULT_SHIP_MASS_KG,
  maxAngularRateRadps: 0.85,
  forwardThrustN: FLIGHT_CONFIG.THROTTLE_ACCEL * DEFAULT_SHIP_MASS_KG,
  backwardThrustN: FLIGHT_CONFIG.THROTTLE_ACCEL * DEFAULT_SHIP_MASS_KG * 0.6,
  verticalThrustN: FLIGHT_CONFIG.LIFT_ACCEL * DEFAULT_SHIP_MASS_KG,
  lateralThrustN: FLIGHT_CONFIG.STRAFE_ACCEL * DEFAULT_SHIP_MASS_KG,
  pitchTorqueNm: FLIGHT_CONFIG.PITCH_RATE * 2 * DEFAULT_SHIP_MASS_KG * FLIGHT_CONFIG.INERTIA_FACTOR,
  yawTorqueNm: FLIGHT_CONFIG.YAW_RATE * 2 * DEFAULT_SHIP_MASS_KG * FLIGHT_CONFIG.INERTIA_FACTOR,
  rollTorqueNm: FLIGHT_CONFIG.ROLL_RATE * 2.2 * DEFAULT_SHIP_MASS_KG * FLIGHT_CONFIG.INERTIA_FACTOR,
  thrustFovForwardDeg: 5,
  thrustFovBackwardDeg: 3.5,
  thrustFovBlendPerSec: 8,
  boostShakeAmplitudeM: 0.015,
  boostShakeHz: 20,
  boostBlendPerSec: 4.5,
  boostSoundVolume: 1,
  thrustSoundVolume: 1,
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

export type ShipDoorTrigger = "radial" | "raycast";

export interface ShipDoorSpec {
  id: string;
  /** Prompt name ("Press F — open {label}"). */
  label: string;
  motion: "slide" | "hinge";
  axis: "x" | "y" | "z";
  /** GLB node names + signed open delta (slide: meters, hinge: radians). */
  nodes: {
    name: string;
    delta: number;
    /** Unique ancestor when duplicate bone/node names exist. */
    under?: string;
  }[];
  /** Ship-local interact anchor. */
  interact: LocalOffset;
  /** radial = stand in sphere; raycast = camera aim within radius. */
  trigger: ShipDoorTrigger;
  /** Radial stand reach / raycast max camera distance. */
  radius: number;
  /** Raycast hit tolerance (perpendicular meters from camera ray). */
  aimRadius: number;
  defaultOpen: boolean;
  /** One-shot SFX when opening (optional). */
  openSoundUrl?: string;
  /** One-shot SFX when closing (optional). */
  closeSoundUrl?: string;
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

/** Ship bunk baked from a bed marker (F to lie down; no flight). */
export interface ShipBedSpec {
  id: string;
  label: string;
  /** Mattress / interact anchor in ship-local space. */
  bed: LocalOffset;
  eye: LocalOffset;
  /** Get-up spot beside the bunk (2D deck local). */
  stand: { right: number; forward: number };
  trigger: "radial" | "raycast";
  radius: number;
  aimRadius: number;
}

/** Cockpit look-at control baked from a cockpit-control marker. */
export type { CockpitControlAction, CockpitStatKind };

export interface CockpitControlSpec {
  id: string;
  action: CockpitControlAction;
  /** Optional authored label; runtime may override from rig state. */
  label?: string;
  /** Anchor in ship-local right/up/forward meters. */
  position: LocalOffset;
  /** Max perpendicular distance from the camera ray (m). */
  gazeRadius: number;
  /** Max distance from the camera (m). */
  maxDistance: number;
}

/** Cockpit instrument baked from a cockpit-stat marker. */
export interface CockpitStatSpec {
  id: string;
  kind: CockpitStatKind;
  /** Optional authored title; runtime defaults from kind. */
  label?: string;
  /** Anchor in ship-local right/up/forward meters. */
  position: LocalOffset;
  /** Max distance from the pilot eye to show (m). */
  maxDistance: number;
}

/** Bunk entertainment system baked from an entertainment-system marker. */
export interface EntertainmentSystemSpec {
  id: string;
  /** Gaze prompt (default "Turn on ES"). */
  label: string;
  /** Anchor in ship-local right/up/forward meters. */
  position: LocalOffset;
  /**
   * Screen orientation in ship-group space (prefab/scene quat).
   * Plane faces local +Z; identity = upright facing ship +forward.
   */
  rotation: { x: number; y: number; z: number; w: number };
  /** Max perpendicular distance from the camera ray (m). */
  gazeRadius: number;
  /** Max distance from the camera (m). */
  maxDistance: number;
  /** Powered screen plane width (m). */
  screenWidth: number;
  /** Powered screen plane height (m). */
  screenHeight: number;
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
  /** Hull GLB node overrides — must match collider bake for aligned render. */
  hullNodeOverrides?: PrefabNodeOverride[];
  /**
   * Ship origin height above the ground when parked on gear, in meters.
   * null = unauthored; previews measure the hull and rest it on the pad.
   */
  restHeightMeters: number | null;
  walkZones: ShipWalkZone[];
  doors: ShipDoorSpec[];
  /** All authored seat markers from the prefab (may be empty). */
  seats: ShipSeatSpec[];
  /** Authored bunk markers (F to lie down; no flight). */
  beds: ShipBedSpec[];
  /** Cockpit look-at controls (Hold F + click) baked from cockpit-control markers. */
  cockpitControls: CockpitControlSpec[];
  /** Cockpit instruments (always-on while piloting) baked from cockpit-stat markers. */
  cockpitStats: CockpitStatSpec[];
  /** Bunk entertainment screens (gaze + F while in bed). */
  entertainmentSystems: EntertainmentSystemSpec[];
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
  /** Prefab-local authored ambience and positional sound zones. */
  sounds: PrefabSoundSpec[];
}

/** Minimal fallback when a ship prefab is missing or not yet loaded. */
export const DEFAULT_SHIP_LAYOUT: ShipLayout = {
  spec: DEFAULT_SHIP_SPEC,
  hullUrl: null,
  restHeightMeters: 3.16,
  walkZones: [],
  doors: [],
  seats: [],
  beds: [],
  cockpitControls: [],
  cockpitStats: [],
  entertainmentSystems: [],
  pilotSeat: { right: 0, up: -0.62, forward: 6.05 },
  pilotEye: { right: 0, up: 0.25, forward: 6.3 },
  seatStand: { right: 0, forward: 4.5 },
  rampInteracts: [],
  rampMount: null,
  colliders: [],
  rampDismountForward: -Infinity,
  rampDismountGround: { right: 0, forward: 0 },
  cameraBounds: [],
  sounds: [],
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
