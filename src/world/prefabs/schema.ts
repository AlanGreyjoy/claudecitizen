import type { Vec3 } from "../../types";
import type { Quat } from "../../math/quat";
import type { StationFloorId } from "../station";

/**
 * Prefab documents are the contract between the editor and the game: a tree
 * of entities with transforms, optional visual content (GLB asset url or a
 * simple primitive), and gameplay components (spawn points, elevators, walk
 * volumes, ...). Documents are plain JSON, tracked under
 * src/world/prefabs/data/<id>.prefab.json (metadata only — asset urls may
 * point at gitignored protected files).
 *
 * Coordinate convention: prefab space equals the render group's local space
 * (the same axes you see in the editor viewport). When a station prefab is
 * placed in the world via updateShipPlacement, the group axes map to
 * station-local gameplay axes as: right = -x, up = y, forward = z.
 */

export type PrefabKind = "station" | "ship" | "site" | "prop" | "item";

export const PREFAB_KINDS: PrefabKind[] = ["station", "ship", "site", "prop", "item"];

/** Horizontal (XZ plane) extent, in prefab/scene axes. */
export interface PrefabVec2 {
  x: number;
  z: number;
}

export interface PrefabTransform {
  position: Vec3;
  rotation: Quat;
  scale: Vec3;
}

export interface PrefabNodeOverride {
  /** GLB node name. Must match a node in this entity's asset scene. */
  node: string;
  /** Local transform applied to the named GLB node. Omit to keep the GLB-authored transform. */
  transform?: PrefabTransform;
  /** Components attached to this GLB node (e.g. box colliders sized to the node). */
  components?: PrefabComponent[];
}

export interface PrefabAsset {
  /** Absolute dev-server url, e.g. "/editor/assets/protected/synty/.../Wall_01.glb". */
  url: string;
  castShadow?: boolean;
}

export interface PrefabPrimitive {
  shape: "box";
  size: Vec3;
  /** CSS hex color, e.g. "#4c5663". */
  color?: string;
}

/** CSS hex color, e.g. "#dfeaff". */
export type PrefabColor = string;

export interface PrefabMaterialOverride {
  /** Three.js material name inside the model, or "__primitive__" for box primitives. */
  material: string;
  color?: PrefabColor;
  emissive?: PrefabColor;
  emissiveIntensity?: number;
  metalness?: number;
  roughness?: number;
  opacity?: number;
}

/** Which gate controls a ship walk zone's walkability. */
export type ShipZoneGate = "ramp" | { doorId: string };

/** Seat role for ship-seat components (pilot seat flies the ship). */
export type ShipSeatRole = "pilot" | "copilot" | "turret" | "passenger";

export const SHIP_SEAT_ROLES: ShipSeatRole[] = [
  "pilot",
  "copilot",
  "turret",
  "passenger",
];

export type PrefabComponent =
  | { type: "station-frame" }
  | { type: "prop-frame" }
  | { type: "item-frame" }
  | { type: "spawn-point"; floorId: StationFloorId }
  | { type: "elevator"; id: string; targetFloor: StationFloorId; floorId: StationFloorId }
  | { type: "hangar-pad"; hangarId: string; padIndex: number; floorId?: StationFloorId }
  | {
      type: "interaction";
      id: string;
      prompt: string;
      radius: number;
      floorId: StationFloorId;
      interactionType?: "info" | "animation";
      targetAnimationId?: string;
      keyLabel?: string;
    }
  | {
      type: "animation";
      id: string;
      name: string;
      motion: "slide" | "hinge";
      axis: "x" | "y" | "z";
      nodes: { name: string; delta: number }[];
      defaultOpen?: boolean;
      duration?: number;
    }
  | { type: "avms-terminal"; id: string; radius: number; floorId: StationFloorId }
  | {
      type: "point-light";
      color?: PrefabColor;
      /** Three.js point light intensity in editor-scale candela. */
      intensity: number;
      /** Maximum reach in prefab meters; 0 means unlimited inverse-square falloff. */
      distance: number;
      /** Attenuation exponent. Physically-correct default is 2. */
      decay?: number;
      castShadow?: boolean;
    }
  | {
      type: "area-light";
      color?: PrefabColor;
      /** Three.js rectangular area light luminance. */
      intensity: number;
      width: number;
      height: number;
    }
  | {
      type: "spot-light";
      color?: PrefabColor;
      /** Three.js spot light intensity in editor-scale candela. */
      intensity: number;
      /** Maximum reach in prefab meters. */
      distance: number;
      /** Attenuation exponent. Physically-correct default is 2. */
      decay?: number;
      /** Cone angle in degrees. Default 45. */
      angle?: number;
      /** Soft edge ratio, 0..1. Default 0. */
      penumbra?: number;
      castShadow?: boolean;
    }
  | {
      type: "collider";
      shape: "box";
      size: Vec3;
      offset?: Vec3;
      /** Optional GLB node name whose ship rig motion drives this collider. */
      node?: string;
    }
  | {
      type: "collider";
      shape: "mesh";
      /** Optional proxy GLB; defaults to the owning entity's asset url. */
      assetUrl?: string;
      /** Checked = convex hull, unchecked = BVH triangle mesh. */
      convex?: boolean;
      offset?: Vec3;
      /** Optional GLB node to extract and/or follow for ship rig motion. */
      node?: string;
    }
  // --- ship components -------------------------------------------------------
  | { type: "ship-frame" }
  /** Static combat and flight tuning for this ship type. */
  | {
      type: "ship-stats";
      maxSpeedMps?: number;
      maxHp?: number;
      maxShields?: number;
      shieldRegenPerSec?: number;
    }
  /** Landing gear hinge nodes on the hull GLB. */
  | {
      type: "ship-gear";
      nodes: { name: string; deployRadians: number; axis?: "x" | "y" | "z" }[];
    }
  /** Boarding ramp hinge node on the hull GLB. */
  | {
      type: "ship-ramp";
      node: string;
      lowerRadians: number;
      axis?: "x" | "y" | "z";
    }
  /** Marks the entity whose GLB asset is the flyable hull. */
  | {
      type: "ship-hull";
      /**
       * Ship origin height above the ground when parked on gear, in meters.
       * Unset: previews rest the hull's lowest point on the pad automatically.
       */
      restHeight?: number;
    }
  | {
      type: "ship-walk-zone";
      zoneId: string;
      /** Local XZ offsets from the entity origin; entity Y is the floor height. */
      min: PrefabVec2;
      max: PrefabVec2;
      /** Interior height above the floor for camera containment (default 3.1). */
      height?: number;
      /** Floor delta at the min-Z edge — slopes for ramps/steps (default flat). */
      slopeMinUp?: number;
      /** Walkable only while the gate is open (boarding ramp or a ship-door id). */
      gate?: ShipZoneGate;
      /** Passage zones connect rooms; real rooms win for camera framing. */
      passage?: boolean;
    }
  | {
      type: "ship-door";
      /** Unique within the prefab; walk zones gate on it. */
      id: string;
      /** Display name for prompts ("Press F — open {label}"). */
      label: string;
      motion: "slide" | "hinge";
      /** Node-local axis the motion happens on. */
      axis: "x" | "y" | "z";
      /** GLB node names + signed open delta (slide: meters, hinge: radians). */
      nodes: { name: string; delta: number }[];
      /** Interact distance from the entity position (default 1.6). */
      radius?: number;
      defaultOpen?: boolean;
    }
  | {
      type: "pilot-seat";
      /** pilot = flight controls; others are for future seated interactions. */
      role?: ShipSeatRole;
      /** Eye offset from the seat in scene axes (default {0, 0.87, 0.25}). */
      eye?: Vec3;
      /** Stand-up spot offset from the seat in scene XZ (default {0, -1.55}). */
      stand?: PrefabVec2;
      /** Interact distance around the chair (default 1.45). */
      interactRadius?: number;
    }
  | {
      type: "ship-stairs";
      /** stairs = discrete treads; ladder = smooth climb slope. */
      variant?: "stairs" | "ladder";
      zoneId: string;
      /** Local XZ offsets from the entity origin; entity Y is the bottom step height. */
      min: PrefabVec2;
      max: PrefabVec2;
      /** Total rise from the bottom to the top edge of the run (meters). */
      riseUp: number;
      /** Number of discrete steps across the run (default 4; ignored for ladder). */
      stepCount?: number;
      /** Interior height above the top step for camera containment (default 3.1). */
      height?: number;
      gate?: ShipZoneGate;
      passage?: boolean;
    }
  | {
      type: "ramp-interact";
      /** outside: ground-level ramp toggle; deck: interior ramp panel. */
      placement: "outside" | "deck";
      radius?: number;
    }
  /** Tail strip (local XZ box) where a grounded character steps onto the ramp. */
  | { type: "ramp-mount"; min: PrefabVec2; max: PrefabVec2 };

export type PrefabComponentType = PrefabComponent["type"];

export interface PrefabEntity {
  id: string;
  name: string;
  transform: PrefabTransform;
  asset?: PrefabAsset;
  primitive?: PrefabPrimitive;
  nodeOverrides?: PrefabNodeOverride[];
  /** Names of GLB nodes that should be hidden (deleted) for this entity. */
  hiddenNodes?: string[];
  materialOverrides?: PrefabMaterialOverride[];
  components?: PrefabComponent[];
  /** GLB node name under the asset entity's model tree that owns this child. */
  glbAnchor?: string;
  children?: PrefabEntity[];
}

export interface PrefabDocument {
  id: string;
  name: string;
  version: 1;
  kind: PrefabKind;
  root: PrefabEntity;
}

export const PREFAB_ID_PATTERN = /^[a-z0-9][a-z0-9-]{0,63}$/;

export function slugifyPrefabName(name: string): string {
  return name
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "")
    .slice(0, 64);
}

const STATION_FLOOR_IDS: StationFloorId[] = ["hab", "lobby", "hangar"];

function fail(path: string, message: string): never {
  throw new Error(`Invalid prefab document at ${path}: ${message}`);
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function parseFiniteNumber(value: unknown, path: string): number {
  if (typeof value !== "number" || !Number.isFinite(value))
    fail(path, "expected finite number");
  return value;
}

function parseString(value: unknown, path: string, maxLength = 256): string {
  if (typeof value !== "string") fail(path, "expected string");
  return value.slice(0, maxLength);
}

function parseVec3(value: unknown, path: string): Vec3 {
  if (!isRecord(value)) fail(path, "expected {x,y,z}");
  return {
    x: parseFiniteNumber(value.x, `${path}.x`),
    y: parseFiniteNumber(value.y, `${path}.y`),
    z: parseFiniteNumber(value.z, `${path}.z`),
  };
}

function parseVec2(value: unknown, path: string): PrefabVec2 {
  if (!isRecord(value)) fail(path, "expected {x,z}");
  return {
    x: parseFiniteNumber(value.x, `${path}.x`),
    z: parseFiniteNumber(value.z, `${path}.z`),
  };
}

function parseQuat(value: unknown, path: string): Quat {
  if (!isRecord(value)) fail(path, "expected {x,y,z,w}");
  return {
    x: parseFiniteNumber(value.x, `${path}.x`),
    y: parseFiniteNumber(value.y, `${path}.y`),
    z: parseFiniteNumber(value.z, `${path}.z`),
    w: parseFiniteNumber(value.w, `${path}.w`),
  };
}

function parseTransform(value: unknown, path: string): PrefabTransform {
  if (!isRecord(value)) fail(path, "expected transform object");
  return {
    position: parseVec3(value.position, `${path}.position`),
    rotation: parseQuat(value.rotation, `${path}.rotation`),
    scale: parseVec3(value.scale, `${path}.scale`),
  };
}

function parseFloorId(value: unknown, path: string): StationFloorId {
  if (
    typeof value !== "string" ||
    !STATION_FLOOR_IDS.includes(value as StationFloorId)
  ) {
    fail(path, `expected one of ${STATION_FLOOR_IDS.join(", ")}`);
  }
  return value as StationFloorId;
}

function parseAssetUrl(value: unknown, path: string): string {
  const url = parseString(value, path, 512);
  if (!url.startsWith("/") || url.includes("..")) {
    fail(path, 'asset url must be an absolute path without ".."');
  }
  return url;
}

function parseColor(value: unknown, path: string): PrefabColor {
  const color = parseString(value, path, 32);
  if (!/^#[0-9a-fA-F]{6}$/.test(color)) fail(path, "expected CSS hex color");
  return color;
}

function parseUnitValue(value: unknown, path: string): number {
  return Math.min(1, Math.max(0, parseFiniteNumber(value, path)));
}

function parseOptionalUnitValue(value: unknown, path: string): number | undefined {
  return value === undefined ? undefined : parseUnitValue(value, path);
}

function parseOptionalNonNegativeNumber(
  value: unknown,
  path: string,
  max = 50,
): number | undefined {
  if (value === undefined) return undefined;
  return Math.min(max, Math.max(0, parseFiniteNumber(value, path)));
}

function parseMaterialOverride(
  value: unknown,
  path: string,
): PrefabMaterialOverride {
  if (!isRecord(value)) fail(path, "expected material override object");
  return {
    material: parseString(value.material, `${path}.material`, 128),
    ...(value.color !== undefined
      ? { color: parseColor(value.color, `${path}.color`) }
      : {}),
    ...(value.emissive !== undefined
      ? { emissive: parseColor(value.emissive, `${path}.emissive`) }
      : {}),
    ...(value.emissiveIntensity !== undefined
      ? {
          emissiveIntensity: parseOptionalNonNegativeNumber(
            value.emissiveIntensity,
            `${path}.emissiveIntensity`,
            20,
          ),
        }
      : {}),
    ...(value.metalness !== undefined
      ? { metalness: parseOptionalUnitValue(value.metalness, `${path}.metalness`) }
      : {}),
    ...(value.roughness !== undefined
      ? { roughness: parseOptionalUnitValue(value.roughness, `${path}.roughness`) }
      : {}),
    ...(value.opacity !== undefined
      ? { opacity: parseOptionalUnitValue(value.opacity, `${path}.opacity`) }
      : {}),
  };
}

function parseComponent(value: unknown, path: string): PrefabComponent | null {
  if (!isRecord(value)) fail(path, "expected component object");
  const type = value.type;
  switch (type) {
    case "station-frame":
      return { type };
    case "prop-frame":
      return { type };
    case "item-frame":
      return { type };
    case "spawn-point":
      return { type, floorId: parseFloorId(value.floorId, `${path}.floorId`) };
    case "elevator":
      return {
        type,
        id: parseString(value.id, `${path}.id`, 64),
        targetFloor: parseFloorId(value.targetFloor, `${path}.targetFloor`),
        floorId: parseFloorId(value.floorId, `${path}.floorId`),
      };
    case "hangar-pad":
      return {
        type,
        hangarId: parseString(value.hangarId, `${path}.hangarId`, 64),
        padIndex: Math.max(
          1,
          Math.round(parseFiniteNumber(value.padIndex, `${path}.padIndex`)),
        ),
        floorId:
          value.floorId === undefined
            ? "hangar"
            : parseFloorId(value.floorId, `${path}.floorId`),
      };
    case "interaction": {
      const interactionType = value.interactionType;
      if (interactionType !== undefined && interactionType !== "info" && interactionType !== "animation") {
        fail(`${path}.interactionType`, 'expected "info" or "animation"');
      }
      return {
        type,
        id: parseString(value.id, `${path}.id`, 64),
        prompt: parseString(value.prompt, `${path}.prompt`, 200),
        radius: Math.min(
          50,
          Math.max(0.5, parseFiniteNumber(value.radius, `${path}.radius`)),
        ),
        floorId: parseFloorId(value.floorId, `${path}.floorId`),
        ...(interactionType !== undefined ? { interactionType } : {}),
        ...(value.targetAnimationId !== undefined
          ? { targetAnimationId: parseString(value.targetAnimationId, `${path}.targetAnimationId`, 64) }
          : {}),
        ...(value.keyLabel !== undefined
          ? { keyLabel: parseString(value.keyLabel, `${path}.keyLabel`, 10) }
          : {}),
      };
    }
    case "animation": {
      if (!Array.isArray(value.nodes) || value.nodes.length === 0) {
        fail(`${path}.nodes`, "expected non-empty array of {name, delta}");
      }
      if (value.nodes.length > 8)
        fail(`${path}.nodes`, "too many animation nodes (max 8)");
      const motion = value.motion;
      if (motion !== "slide" && motion !== "hinge") {
        fail(`${path}.motion`, 'expected "slide" or "hinge"');
      }
      const axis = value.axis;
      if (axis !== "x" && axis !== "y" && axis !== "z") {
        fail(`${path}.axis`, 'expected "x", "y", or "z"');
      }
      return {
        type,
        id: parseString(value.id, `${path}.id`, 64),
        name: parseString(value.name, `${path}.name`, 64),
        motion,
        axis,
        nodes: value.nodes.map((node, index) => {
          if (!isRecord(node))
            fail(`${path}.nodes[${index}]`, "expected {name, delta}");
          return {
            name: parseString(node.name, `${path}.nodes[${index}].name`, 128),
            delta: Math.min(
              20,
              Math.max(
                -20,
                parseFiniteNumber(node.delta, `${path}.nodes[${index}].delta`),
              ),
            ),
          };
        }),
        defaultOpen:
          value.defaultOpen === undefined
            ? undefined
            : Boolean(value.defaultOpen),
        duration:
          value.duration === undefined
            ? undefined
            : Math.min(
                60,
                Math.max(
                  0.01,
                  parseFiniteNumber(value.duration, `${path}.duration`),
                ),
              ),
      };
    }
    case "avms-terminal":
      return {
        type,
        id: parseString(value.id, `${path}.id`, 64),
        radius: Math.min(
          50,
          Math.max(0.5, parseFiniteNumber(value.radius, `${path}.radius`)),
        ),
        floorId: parseFloorId(value.floorId, `${path}.floorId`),
      };
    case "point-light":
      return {
        type,
        color:
          value.color === undefined
            ? undefined
            : parseColor(value.color, `${path}.color`),
        intensity: Math.min(
          5_000,
          Math.max(0, parseFiniteNumber(value.intensity, `${path}.intensity`)),
        ),
        distance: Math.min(
          500,
          Math.max(0, parseFiniteNumber(value.distance, `${path}.distance`)),
        ),
        decay:
          value.decay === undefined
            ? undefined
            : Math.min(
                4,
                Math.max(0, parseFiniteNumber(value.decay, `${path}.decay`)),
              ),
        castShadow:
          value.castShadow === undefined ? undefined : Boolean(value.castShadow),
      };
    case "area-light":
      return {
        type,
        color:
          value.color === undefined
            ? undefined
            : parseColor(value.color, `${path}.color`),
        intensity: Math.min(
          500,
          Math.max(0, parseFiniteNumber(value.intensity, `${path}.intensity`)),
        ),
        width: Math.min(
          100,
          Math.max(0.05, parseFiniteNumber(value.width, `${path}.width`)),
        ),
        height: Math.min(
          100,
          Math.max(0.05, parseFiniteNumber(value.height, `${path}.height`)),
        ),
      };
    case "spot-light":
      return {
        type,
        color:
          value.color === undefined
            ? undefined
            : parseColor(value.color, `${path}.color`),
        intensity: Math.min(
          5_000,
          Math.max(0, parseFiniteNumber(value.intensity, `${path}.intensity`)),
        ),
        distance: Math.min(
          500,
          Math.max(0, parseFiniteNumber(value.distance, `${path}.distance`)),
        ),
        decay:
          value.decay === undefined
            ? undefined
            : Math.min(
                4,
                Math.max(0, parseFiniteNumber(value.decay, `${path}.decay`)),
              ),
        angle:
          value.angle === undefined
            ? undefined
            : Math.min(
                90,
                Math.max(0, parseFiniteNumber(value.angle, `${path}.angle`)),
              ),
        penumbra:
          value.penumbra === undefined
            ? undefined
            : Math.min(
                1,
                Math.max(0, parseFiniteNumber(value.penumbra, `${path}.penumbra`)),
              ),
        castShadow:
          value.castShadow === undefined ? undefined : Boolean(value.castShadow),
      };
    case "collider": {
      const shape = value.shape === "mesh" ? "mesh" : "box";
      const offset =
        value.offset === undefined
          ? undefined
          : parseVec3(value.offset, `${path}.offset`);
      const node =
        value.node === undefined
          ? undefined
          : parseString(value.node, `${path}.node`, 128);
      if (shape === "mesh") {
        return {
          type,
          shape,
          assetUrl:
            value.assetUrl === undefined
              ? undefined
              : parseAssetUrl(value.assetUrl, `${path}.assetUrl`),
          convex: value.convex === undefined ? undefined : Boolean(value.convex),
          offset,
          node,
        };
      }
      return {
        type,
        shape,
        size: parseVec3(value.size, `${path}.size`),
        offset,
        node,
      };
    }
    case "ship-frame":
      return { type };
    case "ship-stats":
      return {
        type,
        maxSpeedMps:
          value.maxSpeedMps === undefined
            ? undefined
            : Math.min(
                500,
                Math.max(
                  5,
                  parseFiniteNumber(value.maxSpeedMps, `${path}.maxSpeedMps`),
                ),
              ),
        maxHp:
          value.maxHp === undefined
            ? undefined
            : Math.min(
                100_000,
                Math.max(1, parseFiniteNumber(value.maxHp, `${path}.maxHp`)),
              ),
        maxShields:
          value.maxShields === undefined
            ? undefined
            : Math.min(
                100_000,
                Math.max(
                  0,
                  parseFiniteNumber(value.maxShields, `${path}.maxShields`),
                ),
              ),
        shieldRegenPerSec:
          value.shieldRegenPerSec === undefined
            ? undefined
            : Math.min(
                10_000,
                Math.max(
                  0,
                  parseFiniteNumber(
                    value.shieldRegenPerSec,
                    `${path}.shieldRegenPerSec`,
                  ),
                ),
              ),
      };
    case "ship-gear": {
      if (!Array.isArray(value.nodes) || value.nodes.length === 0) {
        fail(`${path}.nodes`, "expected non-empty array of gear hinges");
      }
      if (value.nodes.length > 12)
        fail(`${path}.nodes`, "too many gear nodes (max 12)");
      return {
        type,
        nodes: value.nodes.map((node, index) => {
          if (!isRecord(node))
            fail(`${path}.nodes[${index}]`, "expected {name, deployRadians}");
          const axisRaw = node.axis;
          const axis =
            axisRaw === undefined
              ? undefined
              : axisRaw === "x" || axisRaw === "y" || axisRaw === "z"
                ? axisRaw
                : fail(`${path}.nodes[${index}].axis`, 'expected "x", "y", or "z"');
          return {
            name: parseString(node.name, `${path}.nodes[${index}].name`, 128),
            deployRadians: Math.min(
              10,
              Math.max(
                -10,
                parseFiniteNumber(
                  node.deployRadians,
                  `${path}.nodes[${index}].deployRadians`,
                ),
              ),
            ),
            axis,
          };
        }),
      };
    }
    case "ship-ramp": {
      const axisRaw = value.axis;
      const axis =
        axisRaw === undefined
          ? undefined
          : axisRaw === "x" || axisRaw === "y" || axisRaw === "z"
            ? axisRaw
            : fail(`${path}.axis`, 'expected "x", "y", or "z"');
      return {
        type,
        node: parseString(value.node, `${path}.node`, 128),
        lowerRadians: Math.min(
          10,
          Math.max(
            -10,
            parseFiniteNumber(value.lowerRadians, `${path}.lowerRadians`),
          ),
        ),
        axis,
      };
    }
    case "ship-hull":
      return {
        type,
        restHeight:
          value.restHeight === undefined
            ? undefined
            : Math.min(
                50,
                Math.max(
                  0.2,
                  parseFiniteNumber(value.restHeight, `${path}.restHeight`),
                ),
              ),
      };
    case "ship-walk-zone":
      return {
        type,
        zoneId: parseString(value.zoneId, `${path}.zoneId`, 64),
        min: parseVec2(value.min, `${path}.min`),
        max: parseVec2(value.max, `${path}.max`),
        height:
          value.height === undefined
            ? undefined
            : Math.min(
                100,
                Math.max(
                  0.5,
                  parseFiniteNumber(value.height, `${path}.height`),
                ),
              ),
        slopeMinUp:
          value.slopeMinUp === undefined
            ? undefined
            : Math.min(
                20,
                Math.max(
                  -20,
                  parseFiniteNumber(value.slopeMinUp, `${path}.slopeMinUp`),
                ),
              ),
        gate: parseShipZoneGate(value.gate, `${path}.gate`),
        passage:
          value.passage === undefined ? undefined : Boolean(value.passage),
      };
    case "ship-door": {
      if (!Array.isArray(value.nodes) || value.nodes.length === 0) {
        fail(`${path}.nodes`, "expected non-empty array of {name, delta}");
      }
      if (value.nodes.length > 8)
        fail(`${path}.nodes`, "too many door nodes (max 8)");
      const motion = value.motion;
      if (motion !== "slide" && motion !== "hinge") {
        fail(`${path}.motion`, 'expected "slide" or "hinge"');
      }
      const axis = value.axis;
      if (axis !== "x" && axis !== "y" && axis !== "z") {
        fail(`${path}.axis`, 'expected "x", "y", or "z"');
      }
      return {
        type,
        id: parseString(value.id, `${path}.id`, 64),
        label: parseString(value.label, `${path}.label`, 64),
        motion,
        axis,
        nodes: value.nodes.map((node, index) => {
          if (!isRecord(node))
            fail(`${path}.nodes[${index}]`, "expected {name, delta}");
          return {
            name: parseString(node.name, `${path}.nodes[${index}].name`, 128),
            delta: Math.min(
              20,
              Math.max(
                -20,
                parseFiniteNumber(node.delta, `${path}.nodes[${index}].delta`),
              ),
            ),
          };
        }),
        radius:
          value.radius === undefined
            ? undefined
            : Math.min(
                20,
                Math.max(
                  0.5,
                  parseFiniteNumber(value.radius, `${path}.radius`),
                ),
              ),
        defaultOpen:
          value.defaultOpen === undefined
            ? undefined
            : Boolean(value.defaultOpen),
      };
    }
    case "pilot-seat": {
      const roleRaw = value.role;
      const role =
        roleRaw === undefined
          ? undefined
          : SHIP_SEAT_ROLES.includes(roleRaw as ShipSeatRole)
            ? (roleRaw as ShipSeatRole)
            : fail(
                `${path}.role`,
                `expected one of: ${SHIP_SEAT_ROLES.join(", ")}`,
              );
      return {
        type,
        role,
        eye:
          value.eye === undefined
            ? undefined
            : parseVec3(value.eye, `${path}.eye`),
        stand:
          value.stand === undefined
            ? undefined
            : parseVec2(value.stand, `${path}.stand`),
        interactRadius:
          value.interactRadius === undefined
            ? undefined
            : Math.min(
                10,
                Math.max(
                  0.5,
                  parseFiniteNumber(
                    value.interactRadius,
                    `${path}.interactRadius`,
                  ),
                ),
              ),
      };
    }
    case "ship-stairs": {
      const variantRaw = value.variant;
      const variant =
        variantRaw === undefined
          ? undefined
          : variantRaw === "stairs" || variantRaw === "ladder"
            ? variantRaw
            : fail(`${path}.variant`, 'expected "stairs" or "ladder"');
      return {
        type,
        variant,
        zoneId: parseString(value.zoneId, `${path}.zoneId`, 64),
        min: parseVec2(value.min, `${path}.min`),
        max: parseVec2(value.max, `${path}.max`),
        riseUp: Math.min(
          20,
          Math.max(0.05, parseFiniteNumber(value.riseUp, `${path}.riseUp`)),
        ),
        stepCount:
          value.stepCount === undefined
            ? undefined
            : Math.min(
                64,
                Math.max(
                  1,
                  Math.floor(
                    parseFiniteNumber(value.stepCount, `${path}.stepCount`),
                  ),
                ),
              ),
        height:
          value.height === undefined
            ? undefined
            : Math.min(
                20,
                Math.max(1, parseFiniteNumber(value.height, `${path}.height`)),
              ),
        gate:
          value.gate === undefined
            ? undefined
            : parseShipZoneGate(value.gate, `${path}.gate`),
        passage:
          value.passage === undefined ? undefined : Boolean(value.passage),
      };
    }
    case "ramp-interact": {
      const placement = value.placement;
      if (placement !== "outside" && placement !== "deck") {
        fail(`${path}.placement`, 'expected "outside" or "deck"');
      }
      return {
        type,
        placement,
        radius:
          value.radius === undefined
            ? undefined
            : Math.min(
                20,
                Math.max(
                  0.5,
                  parseFiniteNumber(value.radius, `${path}.radius`),
                ),
              ),
      };
    }
    case "ramp-mount":
      return {
        type,
        min: parseVec2(value.min, `${path}.min`),
        max: parseVec2(value.max, `${path}.max`),
      };
    default:
      // Unknown component types are dropped for forward compatibility.
      console.warn(
        `Prefab component of unknown type "${String(type)}" at ${path} was ignored.`,
      );
      return null;
  }
}

function parseShipZoneGate(
  value: unknown,
  path: string,
): ShipZoneGate | undefined {
  if (value === undefined) return undefined;
  if (value === "ramp") return "ramp";
  if (isRecord(value) && typeof value.doorId === "string") {
    return { doorId: parseString(value.doorId, `${path}.doorId`, 64) };
  }
  fail(path, 'expected "ramp" or {doorId}');
}

function parseEntity(
  value: unknown,
  path: string,
  depth: number,
): PrefabEntity {
  if (depth > 32) fail(path, "entity tree too deep");
  if (!isRecord(value)) fail(path, "expected entity object");

  const entity: PrefabEntity = {
    id: parseString(value.id, `${path}.id`, 64),
    name: parseString(value.name, `${path}.name`, 128),
    transform: parseTransform(value.transform, `${path}.transform`),
  };

  if (value.asset !== undefined) {
    if (!isRecord(value.asset)) fail(`${path}.asset`, "expected asset object");
    entity.asset = {
      url: parseAssetUrl(value.asset.url, `${path}.asset.url`),
      ...(value.asset.castShadow !== undefined
        ? { castShadow: Boolean(value.asset.castShadow) }
        : {}),
    };
  }

  if (value.primitive !== undefined) {
    if (!isRecord(value.primitive))
      fail(`${path}.primitive`, "expected primitive object");
    if (value.primitive.shape !== "box")
      fail(`${path}.primitive.shape`, 'expected "box"');
    const color = value.primitive.color;
    entity.primitive = {
      shape: "box",
      size: parseVec3(value.primitive.size, `${path}.primitive.size`),
      ...(typeof color === "string" && /^#[0-9a-fA-F]{6}$/.test(color)
        ? { color }
        : {}),
    };
  }

  if (value.nodeOverrides !== undefined) {
    if (!Array.isArray(value.nodeOverrides)) {
      fail(`${path}.nodeOverrides`, "expected array");
    }
    if (value.nodeOverrides.length > 512) {
      fail(`${path}.nodeOverrides`, "too many node overrides");
    }
    entity.nodeOverrides = value.nodeOverrides.map((override, index) => {
      if (!isRecord(override)) {
        fail(`${path}.nodeOverrides[${index}]`, "expected override object");
      }
      const parsed: PrefabNodeOverride = {
        node: parseString(override.node, `${path}.nodeOverrides[${index}].node`, 128),
      };
      if (override.transform !== undefined) {
        parsed.transform = parseTransform(
          override.transform,
          `${path}.nodeOverrides[${index}].transform`,
        );
      }
      if (override.components !== undefined) {
        if (!Array.isArray(override.components))
          fail(`${path}.nodeOverrides[${index}].components`, "expected array");
        const components = override.components
          .map((component, ci) =>
            parseComponent(component, `${path}.nodeOverrides[${index}].components[${ci}]`),
          )
          .filter((component): component is PrefabComponent => component !== null);
        if (components.length > 0) parsed.components = components;
      }
      return parsed;
    });
  }

  if (value.hiddenNodes !== undefined) {
    if (!Array.isArray(value.hiddenNodes)) {
      fail(`${path}.hiddenNodes`, "expected array");
    }
    if (value.hiddenNodes.length > 512) {
      fail(`${path}.hiddenNodes`, "too many hidden nodes");
    }
    entity.hiddenNodes = value.hiddenNodes.map((node, index) =>
      parseString(node, `${path}.hiddenNodes[${index}]`, 128),
    );
  }

  if (value.materialOverrides !== undefined) {
    if (!Array.isArray(value.materialOverrides)) {
      fail(`${path}.materialOverrides`, "expected array");
    }
    if (value.materialOverrides.length > 512) {
      fail(`${path}.materialOverrides`, "too many material overrides");
    }
    entity.materialOverrides = value.materialOverrides.map((override, index) =>
      parseMaterialOverride(override, `${path}.materialOverrides[${index}]`),
    );
  }

  if (value.components !== undefined) {
    if (!Array.isArray(value.components))
      fail(`${path}.components`, "expected array");
    const components = value.components
      .map((component, index) =>
        parseComponent(component, `${path}.components[${index}]`),
      )
      .filter((component): component is PrefabComponent => component !== null);
    if (components.length > 0) entity.components = components;
  }

  if (value.glbAnchor !== undefined) {
    entity.glbAnchor = parseString(value.glbAnchor, `${path}.glbAnchor`, 128);
  }

  if (value.children !== undefined) {
    if (!Array.isArray(value.children))
      fail(`${path}.children`, "expected array");
    if (value.children.length > 4096)
      fail(`${path}.children`, "too many children");
    entity.children = value.children.map((child, index) =>
      parseEntity(child, `${path}.children[${index}]`, depth + 1),
    );
  }

  return entity;
}

/**
 * Validates untrusted JSON into a PrefabDocument (throws on malformed input).
 * All prefab loading — bundled files, dev API responses — goes through here.
 */
export function parsePrefabDocument(value: unknown): PrefabDocument {
  if (!isRecord(value)) fail("$", "expected document object");
  const id = parseString(value.id, "$.id", 64);
  if (!PREFAB_ID_PATTERN.test(id))
    fail("$.id", "expected lowercase slug (a-z, 0-9, -)");
  if (value.version !== 1) fail("$.version", "expected version 1");
  const kind = value.kind;
  if (typeof kind !== "string" || !PREFAB_KINDS.includes(kind as PrefabKind)) {
    fail("$.kind", `expected one of ${PREFAB_KINDS.join(", ")}`);
  }
  return {
    id,
    name:
      typeof value.name === "string" && value.name.trim()
        ? value.name.slice(0, 128)
        : id,
    version: 1,
    kind: kind as PrefabKind,
    root: parseEntity(value.root, "$.root", 0),
  };
}
