import type {
  PrefabComponent,
  PrefabComponentType,
  PrefabKind,
} from "./schema";

/**
 * Editor-facing metadata for every prefab component type: which prefab kinds
 * may use it, its default value when added, and the inspector hint. The
 * inspector's add-component autocomplete is driven entirely by this registry,
 * so new component types only need an entry here (plus field editors).
 */
export interface ComponentDef {
  type: PrefabComponentType;
  /** Unique registry key when multiple palette entries share the same type. */
  registryKey?: string;
  label: string;
  /** Prefab kinds whose component palette includes this type. */
  kinds: PrefabKind[];
  /** At most one instance per document (frames, hull markers, pilot seats). */
  singleton?: boolean;
  /**
   * Spatial component that lives on its own empty marker entity
   * (Unity-style): adding it to a model entity creates a child marker
   * positioned with the gizmo instead of attaching to the model itself.
   */
  marker?: boolean;
  createDefault: () => PrefabComponent;
  hint?: string;
}

const ALL_KINDS: PrefabKind[] = ["station", "ship", "site"];

export const COMPONENT_REGISTRY: ComponentDef[] = [
  {
    type: "station-frame",
    label: "Station Frame",
    kinds: ["station"],
    singleton: true,
    createDefault: () => ({ type: "station-frame" }),
    hint: "Marks the prefab origin used for orbital placement.",
  },
  {
    type: "spawn-point",
    label: "Spawn Point",
    kinds: ["station"],
    marker: true,
    createDefault: () => ({ type: "spawn-point", floorId: "lobby" }),
    hint: "Player spawn. Entity forward (+Z) sets the facing direction.",
  },
  {
    type: "elevator",
    label: "Elevator",
    kinds: ["station"],
    marker: true,
    createDefault: () => ({
      type: "elevator",
      id: "lift-1",
      targetFloor: "lobby",
    }),
    hint: "Pair two markers with the same id on different floors to ride between them.",
  },
  {
    type: "hangar-pad",
    label: "Hangar Pad",
    kinds: ["station"],
    marker: true,
    createDefault: () => ({
      type: "hangar-pad",
      hangarId: "bay-1",
      padIndex: 1,
    }),
    hint: "Ship parking spot. Place inside a hangar walk volume, at pad surface height.",
  },
  {
    type: "interaction",
    label: "Interaction",
    kinds: ALL_KINDS,
    marker: true,
    createDefault: () => ({
      type: "interaction",
      id: "info-1",
      prompt: "Press F — inspect",
      radius: 2.5,
    }),
    hint: "Shows a prompt when the player is within the radius.",
  },
  {
    type: "walk-volume",
    label: "Walk Volume",
    kinds: ["station", "site"],
    marker: true,
    createDefault: () => ({
      type: "walk-volume",
      floorId: "lobby",
      min: { x: -5, z: -5 },
      max: { x: 5, z: 5 },
      height: 4,
    }),
    hint: "Walkable floor area (local XZ box). The player collides with its edges.",
  },
  {
    type: "collider",
    label: "Collider",
    kinds: ALL_KINDS,
    createDefault: () => ({
      type: "collider",
      shape: "box",
      size: { x: 1, y: 1, z: 1 },
    }),
    hint: "Reserved for future physics; not used by gameplay yet.",
  },
  // --- ship components -------------------------------------------------------
  {
    type: "ship-frame",
    label: "Ship Frame",
    kinds: ["ship"],
    singleton: true,
    createDefault: () => ({ type: "ship-frame" }),
    hint: "Marks the prefab origin the flight body is anchored to.",
  },
  {
    type: "ship-stats",
    label: "Ship Stats",
    kinds: ["ship"],
    singleton: true,
    createDefault: () => ({
      type: "ship-stats",
      maxSpeedMps: 100,
      maxHp: 1000,
      maxShields: 500,
      shieldRegenPerSec: 25,
    }),
    hint: "Max speed, HP, shields, and shield regen for this ship type. Place on the root next to ship-frame.",
  },
  {
    type: "ship-gear",
    label: "Ship Gear",
    kinds: ["ship"],
    singleton: true,
    createDefault: () => ({
      type: "ship-gear",
      nodes: [
        { name: "LandingGear_BackLeft", deployRadians: -0.55 },
        { name: "LandingGear_BackRight", deployRadians: -0.55 },
        { name: "LandingLeg_Front", deployRadians: 1.4 },
      ],
    }),
    hint: "Landing gear hinge nodes on the hull GLB. Omit to use Starhopper defaults.",
  },
  {
    type: "ship-ramp",
    label: "Ship Ramp",
    kinds: ["ship"],
    singleton: true,
    createDefault: () => ({
      type: "ship-ramp",
      node: "RampParent",
      lowerRadians: -0.62,
    }),
    hint: "Boarding ramp hinge on the hull GLB. Omit to use Starhopper defaults.",
  },
  {
    type: "ship-hull",
    label: "Ship Hull",
    kinds: ["ship"],
    singleton: true,
    createDefault: () => ({ type: "ship-hull" }),
    hint: "Marks the flyable hull model (one per prefab). Keep it at 0,0,0 — the game recenters the model on the ship origin. Rest height sets the parked height above ground.",
  },
  {
    type: "ship-walk-zone",
    label: "Ship Walk Zone",
    kinds: ["ship"],
    marker: true,
    createDefault: () => ({
      type: "ship-walk-zone",
      zoneId: "cabin",
      min: { x: -2, z: -3 },
      max: { x: 2, z: 3 },
      height: 3.1,
    }),
    hint: "Walkable deck volume (local XZ box). Entity Y sets floor height; rotate the entity to tilt ramps and passages.",
  },
  {
    type: "ship-door",
    label: "Ship Door",
    kinds: ["ship"],
    marker: true,
    createDefault: () => ({
      type: "ship-door",
      id: "door-1",
      label: "door",
      motion: "slide",
      axis: "x",
      nodes: [{ name: "Door_L", delta: -1 }],
      radius: 1.6,
    }),
    hint: "Open/close door bound to GLB nodes. Entity position is the interact spot.",
  },
  {
    type: "pilot-seat",
    label: "Ship Seat",
    kinds: ["ship"],
    marker: true,
    createDefault: () => ({
      type: "pilot-seat",
      role: "passenger",
      eye: { x: 0, y: 0.87, z: 0.25 },
      stand: { x: 0, z: -1.55 },
      interactRadius: 1.45,
    }),
    hint: "Seat marker — set role to pilot for flight controls. Entity position is the seat.",
  },
  {
    type: "ship-stairs",
    label: "Ship Stairs",
    kinds: ["ship"],
    marker: true,
    createDefault: () => ({
      type: "ship-stairs",
      variant: "stairs",
      zoneId: "stairs",
      min: { x: -1, z: -1.5 },
      max: { x: 1, z: 1.5 },
      riseUp: 1.2,
      stepCount: 4,
      height: 3.1,
    }),
    hint: "Stepped walk volume (local XZ box). Entity Y is the bottom step; riseUp climbs toward +Z. Use variant Ladder for a smooth climb.",
  },
  {
    type: "ship-stairs",
    registryKey: "ship-ladder",
    label: "Ship Ladder",
    kinds: ["ship"],
    marker: true,
    createDefault: () => ({
      type: "ship-stairs",
      variant: "ladder",
      zoneId: "ladder",
      min: { x: -0.35, z: -1.5 },
      max: { x: 0.35, z: 1.5 },
      riseUp: 1.2,
      height: 3.1,
    }),
    hint: "Vertical climb volume. Entity Y is the bottom; Press F at the foot/head to go up or down.",
  },
  {
    type: "ramp-interact",
    label: "Ramp Interact",
    kinds: ["ship"],
    marker: true,
    createDefault: () => ({
      type: "ramp-interact",
      placement: "outside",
      radius: 3,
    }),
    hint: "Raise/lower ramp prompt — outside at the ramp foot, or a deck panel.",
  },
  {
    type: "ramp-mount",
    label: "Ramp Mount",
    kinds: ["ship"],
    singleton: true,
    marker: true,
    createDefault: () => ({
      type: "ramp-mount",
      min: { x: -1.05, z: -0.4 },
      max: { x: 1.05, z: 0.4 },
    }),
    hint: "Ground strip (local XZ box) where walking in steps onto the lowered ramp.",
  },
];

const registryByType = new Map(
  COMPONENT_REGISTRY.map((def) => [def.registryKey ?? def.type, def]),
);

export function getComponentDef(
  type: PrefabComponentType,
): ComponentDef | null {
  return registryByType.get(type) ?? null;
}

export function getComponentsForKind(kind: PrefabKind): ComponentDef[] {
  return COMPONENT_REGISTRY.filter((def) => def.kinds.includes(kind));
}

/**
 * Case-insensitive substring match over type and label, filtered by prefab
 * kind and with already-present singletons removed. An empty query returns
 * the whole palette for the kind.
 */
export function searchComponents(
  query: string,
  kind: PrefabKind,
  existingTypes: readonly PrefabComponentType[],
): ComponentDef[] {
  const needle = query.trim().toLowerCase();
  return getComponentsForKind(kind).filter((def) => {
    if (def.singleton && existingTypes.includes(def.type)) return false;
    if (!needle) return true;
    return (
      def.type.includes(needle) || def.label.toLowerCase().includes(needle)
    );
  });
}
