import type {
  PrefabComponent,
  PrefabComponentType,
  PrefabKind,
} from "./schema";
import { createDefaultParticleSystemComponent } from "./schema";

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
    type: "equipment-socket",
    label: "Equipment Socket",
    kinds: ITEM_KINDS,
    marker: true,
    createDefault: () => ({
      type: "equipment-socket",
      id: "rifle-primary",
      accepts: "rifle",
    }),
    hint: "Attachment socket supplied by an item. Backpacks require rifle-primary and rifle-secondary sockets.",
  },
  {
    type: "drawn-grip",
    label: "Drawn Grip",
    kinds: ITEM_KINDS,
    marker: true,
    singleton: true,
    createDefault: () => ({ type: "drawn-grip" }),
    hint: "Weapon hand pose when drawn. Entity transform is the mesh offset/rotation in the character's hand.",
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
    type: "npc-spawner",
    label: "NPC Spawner",
    kinds: ["station"],
    marker: true,
    createDefault: () => ({
      type: "npc-spawner",
      id: "civilians-1",
      populationId: "station-civilians",
      floorId: "lobby",
      minAlive: 3,
      maxAlive: 5,
      routeGroup: "lobby",
      radius: 1.5,
    }),
    hint: "Runtime ambient population source. Spawned NPCs walk the selected waypoint route group.",
  },
  {
    type: "npc-waypoint",
    label: "NPC Waypoint",
    kinds: ["station"],
    marker: true,
    createDefault: () => ({
      type: "npc-waypoint",
      id: "waypoint-1",
      floorId: "lobby",
      routeGroup: "lobby",
      links: [],
      waitMinSeconds: 0.75,
      waitMaxSeconds: 3,
    }),
    hint: "Navigation graph node. Links are undirected; connect enough nodes to route around corners and obstacles.",
  },
  {
    type: "npc-placement",
    label: "NPC Placement",
    kinds: ["station"],
    marker: true,
    createDefault: () => ({
      type: "npc-placement",
      id: "npc-1",
      npcDefinitionId: "station-staff",
      displayName: "Station Staff",
      floorId: "lobby",
      behavior: "stationary",
    }),
    hint: "Explicit named or service NPC. Wander/patrol placements can use an authored waypoint route group.",
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
    type: "object-animation",
    label: "Object Animation",
    kinds: ALL_KINDS,
    marker: false,
    createDefault: () => ({
      type: "object-animation",
      id: "obj-anim-1",
      mode: "hover",
      axis: "y",
      nodes: [],
      speed: 0.5,
      amplitude: 0.08,
      phase: 0,
    }),
    hint: "Continuous spin or hover on an entity root or named GLB nodes (visual only).",
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
    type: "weapon-shop",
    label: "Weapon Shop",
    kinds: ["station"],
    marker: true,
    createDefault: () => ({
      type: "weapon-shop",
      id: "weapon-shop-1",
      label: "Browse weapons",
      gazeRadius: 0.4,
      maxDistance: 3,
      screenWidth: 0.45,
      screenHeight: 0.28,
    }),
    hint:
      "Vendor screen. Place an Empty on the terminal display. Walk up, look at it, and press F to buy weapons for ARC.",
  },
  {
    type: "outfitters",
    label: "Outfitters",
    kinds: ["station"],
    marker: true,
    createDefault: () => ({
      type: "outfitters",
      id: "outfitters-1",
      label: "Browse outfitters",
      gazeRadius: 0.4,
      maxDistance: 3,
      screenWidth: 0.45,
      screenHeight: 0.28,
    }),
    hint:
      "Outfitters screen. Place an Empty on the terminal display. Walk up, look at it, and press F to buy backpacks and gear for ARC.",
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
    type: "sound",
    label: "Sound",
    kinds: ["station", "ship"],
    marker: true,
    createDefault: () => ({
      type: "sound",
      mode: "ambient",
      playback: "loop",
      volume: 1,
      blendDistance: 1,
      zone: { shape: "sphere", radius: 5 },
    }),
    hint: "Loop ambience or play a one-shot when the listener enters a 3D sphere or box zone.",
  },
  {
    type: "particle-system",
    label: "Particle System",
    kinds: ALL_KINDS,
    marker: true,
    createDefault: () => createDefaultParticleSystemComponent(),
    hint: "Unity-style modular particle emitter. Entity transform is the emitter origin; local -Y is down for gravity.",
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
        massKg: 12_000,
        maxAngularRateRadps: 0.85,
        forwardThrustN: 3_696_000,
        backwardThrustN: 2_217_600,
        verticalThrustN: 2_520_000,
        lateralThrustN: 2_016_000,
        pitchTorqueNm: 960_000,
        yawTorqueNm: 1_104_000,
        rollTorqueNm: 1_584_000,
      },
      gear: {
        nodes: [
          { name: "Front_LandingArm", deployRadians: 0.796 },
          { name: "Front_Foot", deployRadians: -0.755 },
          { name: "Front_LandingPiston", deployRadians: -0.563 },
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
        ],
      },
      ramp: {
        hinge: { node: "RampParent", lowerRadians: -0.85 },
        outsideRadius: 3,
        deckRadius: 1.7,
      },
      doors: [],
      seats: [],
      cameraBounds: [],
    }),
    hint:
      "Singleton ship wiring on the hull: stats, gear, ramp, seats, and camera bounds. Prefer Ship Door marker empties for doors/cubbies.",
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
      nodes: [{ name: "Door", delta: 1 }],
      trigger: "radial",
      radius: 1.6,
      aimRadius: 0.35,
    }),
    hint:
      "F-key door/cubby. Empty is the interact target (radial stand-in or camera-aim raycast). Bind GLB nodes + deltas; drag Open/Close SFX from the asset browser.",
  },
  {
    type: "cockpit-control",
    label: "Cockpit Control",
    kinds: ["ship"],
    marker: true,
    createDefault: () => ({
      type: "cockpit-control",
      id: "cockpit-1",
      action: "landing-gear",
      gazeRadius: 0.2,
      maxDistance: 2.5,
    }),
    hint:
      "Look-at target while Hold F free-looking in the seat. Left-click toggles landing gear or cargo ramp.",
  },
  {
    type: "cockpit-stat",
    label: "Cockpit Stat",
    kinds: ["ship"],
    marker: true,
    createDefault: () => ({
      type: "cockpit-stat",
      id: "cockpit-stat-1",
      kind: "speed",
      maxDistance: 3.5,
    }),
    hint:
      "Always-on pilot instrument (e.g. speed number + bar). Place an Empty on the dash; boost raises the speed cap and bar ceiling.",
  },
  {
    type: "bed",
    label: "Bed",
    kinds: ["ship"],
    marker: true,
    createDefault: () => ({
      type: "bed",
      id: "bed-1",
      label: "bed",
      trigger: "radial",
      radius: 1.6,
      aimRadius: 0.35,
      eye: { x: 0, y: 0.3, z: 0.15 },
      stand: { x: -0.9, z: 0 },
    }),
    hint:
      "F-key bunk. Empty is the mattress/interact target (radial or raycast). Eye/stand offsets set lie-down camera and get-up spot. No flight.",
  },
  {
    type: "entertainment-system",
    label: "Entertainment System",
    kinds: ["ship"],
    marker: true,
    createDefault: () => ({
      type: "entertainment-system",
      id: "es-1",
      label: "Turn on ES",
      gazeRadius: 0.35,
      maxDistance: 2,
      screenWidth: 0.55,
      screenHeight: 0.32,
    }),
    hint:
      "Bunk mini-TV. Place an Empty on the overhead screen. While in bed, look at it and press F to open the Entertainment System.",
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
