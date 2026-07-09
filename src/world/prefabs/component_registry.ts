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

const ALL_KINDS: PrefabKind[] = ["station", "ship", "site", "prop", "item"];
const PROP_KINDS: PrefabKind[] = ["prop"];
const ITEM_KINDS: PrefabKind[] = ["item"];

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
    type: "prop-frame",
    label: "Prop Frame",
    kinds: PROP_KINDS,
    singleton: true,
    createDefault: () => ({ type: "prop-frame" }),
    hint: "Marks the prop origin used when placed in a hangar.",
  },
  {
    type: "item-frame",
    label: "Item Frame",
    kinds: ITEM_KINDS,
    singleton: true,
    createDefault: () => ({ type: "item-frame" }),
    hint: "Marks the item origin used for world pickup or drop visuals.",
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
      floorId: "lobby",
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
      floorId: "hangar",
    }),
    hint: "Ship parking spot. Place at pad surface height.",
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
      floorId: "lobby",
    }),
    hint: "Shows a prompt when the player is within the radius.",
  },
  {
    type: "animation",
    label: "Animation",
    kinds: ALL_KINDS,
    marker: true,
    createDefault: () => ({
      type: "animation",
      id: "anim-1",
      name: "animation",
      motion: "slide",
      axis: "x",
      nodes: [{ name: "Door", delta: -1 }],
      duration: 1.0,
    }),
    hint: "Authored translation or rotation of GLB nodes inside this prefab.",
  },
  {
    type: "avms-terminal",
    label: "AVMS Terminal",
    kinds: ["station"],
    marker: true,
    createDefault: () => ({
      type: "avms-terminal",
      id: "avms-1",
      radius: 2.5,
      floorId: "lobby",
    }),
    hint: "Opens the Asteron Vehicle Management System to call ships from inventory.",
  },
  {
    type: "point-light",
    label: "Point Light",
    kinds: ALL_KINDS,
    marker: true,
    createDefault: () => ({
      type: "point-light",
      color: "#dfeaff",
      intensity: 28,
      distance: 12,
      decay: 2,
      castShadow: false,
    }),
    hint: "Omnidirectional light. Entity position sets the source. Shadows are expensive (6 cube faces).",
  },
  {
    type: "area-light",
    label: "Area Light",
    kinds: ALL_KINDS,
    marker: true,
    createDefault: () => ({
      type: "area-light",
      color: "#cfe8ff",
      intensity: 5,
      width: 4,
      height: 0.45,
    }),
    hint: "Rectangular soft light. Entity rotation aims it; local -Z is the lit side. Does not cast shadows.",
  },
  {
    type: "spot-light",
    label: "Spot Light",
    kinds: ALL_KINDS,
    marker: true,
    createDefault: () => ({
      type: "spot-light",
      color: "#dfeaff",
      intensity: 28,
      distance: 24,
      decay: 2,
      angle: 45,
      penumbra: 0.1,
      castShadow: false,
    }),
    hint: "Directional cone light. Entity rotation aims it; local -Z is the beam axis. Shadows are cheaper than point lights.",
  },
  {
    type: "collider",
    label: "Collider",
    kinds: ["station", "ship", "site", "prop", "item"],
    createDefault: () => ({
      type: "collider",
      shape: "box",
      size: { x: 1, y: 1, z: 1 },
    }),
    hint: "Blocks walking characters. Use Box for simple props or Mesh for GLB walls and hull details.",
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
    type: "ship-controller",
    label: "Ship Controller",
    kinds: ["ship"],
    singleton: true,
    createDefault: () => ({
      type: "ship-controller",
      restHeight: 3.16,
      stats: {
        maxSpeedMps: 100,
        maxHp: 1000,
        maxShields: 500,
        shieldRegenPerSec: 25,
      },
      gear: {
        nodes: [
          { name: "LandingGear_BackLeft", deployRadians: -0.55 },
          { name: "LandingGear_BackRight", deployRadians: -0.55 },
          { name: "LandingLeg_Front", deployRadians: 1.4 },
        ],
      },
      ramp: {
        hinge: { node: "RampParent", lowerRadians: -0.85 },
        outsideInteractId: "ramp-button-outside",
        outsideRadius: 3,
        deckInteractId: "ramp-panel-deck",
        deckRadius: 1.7,
        dismountForward: -8.5,
        dismountGround: { x: 0, z: -9.6 },
      },
      doors: [],
      seats: [],
      cameraBounds: [],
    }),
    hint:
      "Singleton ship wiring on the hull: stats, gear, ramp, doors, seats, and camera bounds. Child empties are referenced by entity id.",
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
