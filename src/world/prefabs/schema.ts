import type { Vec3 } from "../../types";
import type { Quat } from "../../math/quat";
import type { StationFloorId } from "../station";
import { isWeaponSlotType, type WeaponSlotType } from "../../types/equipment";

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
  /** Render only this named GLB node subtree, normalized to the entity transform. */
  node?: string;
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

/** Seat role for ship-seat components (pilot seat flies the ship). */
export type ShipSeatRole = "pilot" | "copilot" | "turret" | "passenger";

export const SHIP_SEAT_ROLES: ShipSeatRole[] = [
  "pilot",
  "copilot",
  "turret",
  "passenger",
];

/** Actions for cockpit look-at controls (Hold F free-look + click). */
export type CockpitControlAction = "landing-gear" | "cargo-ramp";

export const COCKPIT_CONTROL_ACTIONS: CockpitControlAction[] = [
  "landing-gear",
  "cargo-ramp",
];

/** Readout kinds for cockpit-stat instruments (always-on while piloting). */
export type CockpitStatKind = "speed";

export const COCKPIT_STAT_KINDS: CockpitStatKind[] = ["speed"];

export type PrefabSoundZone =
  | { shape: "sphere"; radius: number }
  | { shape: "box"; size: Vec3 };

/** Constant or random range (Unity MinMaxCurve constant/two-constants). */
export type PrefabMinMax =
  | { mode: "constant"; value: number }
  | { mode: "random"; min: number; max: number };

export interface PrefabCurveKey {
  t: number;
  value: number;
}

export interface PrefabGradientKey {
  t: number;
  color: PrefabColor;
  alpha?: number;
}

export type PrefabCurve = PrefabCurveKey[];
export type PrefabGradient = PrefabGradientKey[];

export type PrefabParticleShapeType =
  | "sphere"
  | "hemisphere"
  | "cone"
  | "box"
  | "circle"
  | "edge";

export type PrefabParticleEmitFrom = "volume" | "shell" | "edge";

export type PrefabParticleRenderMode =
  | "billboard"
  | "stretched-billboard"
  | "horizontal"
  | "vertical";

export type PrefabParticleBlendMode = "alpha" | "additive";

export type PrefabParticleSimulationSpace = "local" | "world";

export type PrefabParticleSortMode = "none" | "by-distance";

export interface PrefabParticleBurst {
  time: number;
  count: PrefabMinMax;
  cycles?: number;
  interval?: number;
}

export interface PrefabParticleEmission {
  rateOverTime: number;
  bursts: PrefabParticleBurst[];
}

export interface PrefabParticleShape {
  enabled: boolean;
  shape: PrefabParticleShapeType;
  radius: number;
  /** 0 = shell only, 1 = full volume. */
  radiusThickness: number;
  /** Cone half-angle in degrees. */
  angle: number;
  /** Degrees of the circle/cone arc used for spawn. */
  arc: number;
  box: Vec3;
  emitFrom: PrefabParticleEmitFrom;
  alignToDirection: boolean;
}

export interface PrefabParticleVelocityOverLifetime {
  enabled: boolean;
  space: PrefabParticleSimulationSpace;
  linear: Vec3;
  orbital: Vec3;
  radial: number;
}

export interface PrefabParticleForceOverLifetime {
  enabled: boolean;
  space: PrefabParticleSimulationSpace;
  force: Vec3;
}

export interface PrefabParticleColorOverLifetime {
  enabled: boolean;
  gradient: PrefabGradient;
}

export interface PrefabParticleSizeOverLifetime {
  enabled: boolean;
  curve: PrefabCurve;
}

export interface PrefabParticleTextureSheet {
  enabled: boolean;
  tilesX: number;
  tilesY: number;
  animation: "whole-sheet" | "single-row";
  cycles: number;
  startFrame: number;
}

export interface PrefabParticleCollisionPlane {
  /** Plane point in local emitter space (or world if simulationSpace is world). */
  point: Vec3;
  /** Unit normal. */
  normal: Vec3;
}

export interface PrefabParticleCollision {
  enabled: boolean;
  type: "planes";
  /** Include a world-space Y=0 ground plane. */
  groundPlane: boolean;
  planes: PrefabParticleCollisionPlane[];
  dampen: number;
  bounce: number;
  lifetimeLoss: number;
  maxKillSpeed: number;
}

export interface PrefabParticleTrails {
  enabled: boolean;
  /** Fraction of particles that leave a trail, 0..1. */
  ratio: number;
  lifetime: number;
  minVertexDistance: number;
  widthOverTrail: PrefabCurve;
  colorOverTrail: PrefabGradient;
  dieWithParticles: boolean;
}

export interface PrefabParticleRenderer {
  renderMode: PrefabParticleRenderMode;
  textureUrl?: string;
  blendMode: PrefabParticleBlendMode;
  softParticles: boolean;
  softParticleNearFade: number;
  softParticleFarFade: number;
  lengthScale: number;
  speedScale: number;
  sortMode: PrefabParticleSortMode;
}

export const PARTICLE_MAX_PARTICLES_HARD_CAP = 2048;

export type NpcPlacementBehavior = "stationary" | "wander" | "patrol";

export type PrefabComponent =
  | { type: "station-frame" }
  | { type: "prop-frame" }
  | { type: "item-frame" }
  | {
      type: "equipment-socket";
      /** Unique within the item prefab (e.g. rifle-primary). */
      id: string;
      /** Exact weapon compatibility accepted by this socket. */
      accepts: WeaponSlotType;
    }
  | {
      /**
       * Per-weapon hand grip pose. Entity transform is the weapon root's local
       * TRS when parented under the character drawn mount (typically prop_r).
       */
      type: "drawn-grip";
    }
  | { type: "spawn-point"; floorId: StationFloorId }
  | {
      type: "npc-spawner";
      /** Unique within the station prefab. */
      id: string;
      /** Reusable population definition resolved by the NPC catalog. */
      populationId: string;
      floorId: StationFloorId;
      minAlive: number;
      maxAlive: number;
      /** Waypoint route group used by spawned NPCs. */
      routeGroup: string;
      /** Horizontal spawn jitter around the marker, in meters. */
      radius: number;
    }
  | {
      type: "npc-waypoint";
      /** Unique waypoint id within the station prefab. */
      id: string;
      floorId: StationFloorId;
      routeGroup: string;
      /** Undirected connections to other waypoint ids. */
      links: string[];
      waitMinSeconds: number;
      waitMaxSeconds: number;
    }
  | {
      type: "npc-placement";
      /** Stable authored instance id within the station prefab. */
      id: string;
      npcDefinitionId: string;
      displayName?: string;
      floorId: StationFloorId;
      behavior: NpcPlacementBehavior;
      /** Required by wander/patrol; omitted for stationary placements. */
      routeGroup?: string;
    }
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
      proximitySoundUrl?: string;
      interactSoundUrl?: string;
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
  /**
   * Continuous cosmetic motion (spin / hover). Empty `nodes` animates the
   * host entity visual root; otherwise named GLB nodes are driven.
   * Visual only — does not move colliders.
   */
  | {
      type: "object-animation";
      id: string;
      mode: "spin" | "hover";
      axis: "x" | "y" | "z";
      /** GLB node names. Empty / omitted = animate the host entity root. */
      nodes?: { name: string }[];
      /** Spin: rad/s. Hover: cycles per second. */
      speed?: number;
      /** Hover only: meters peak displacement from rest. */
      amplitude?: number;
      /** Radians phase offset so neighbors don't sync. */
      phase?: number;
      /** Spin only: reverse rotation direction. */
      reverse?: boolean;
    }
  | { type: "avms-terminal"; id: string; radius: number; floorId: StationFloorId }
  /**
   * Station weapon vendor screen (gaze + F while on foot). Empty marker
   * position is the gaze / powered-screen anchor in station space.
   */
  | {
      type: "weapon-shop";
      id: string;
      /** Prompt when gazing (default "Browse weapons"). */
      label?: string;
      /** Max perpendicular distance from the camera ray to count as a gaze hit (m). */
      gazeRadius?: number;
      /** Max distance from the camera to the marker (m). */
      maxDistance?: number;
      /** Powered screen plane width in meters (visual only). */
      screenWidth?: number;
      /** Powered screen plane height in meters (visual only). */
      screenHeight?: number;
      /**
       * Optional filter of catalog weapon definition ids.
       * Empty / omitted = sell all weapons from the live catalog.
       */
      itemDefinitionIds?: string[];
    }
  /**
   * Station outfitters vendor screen (gaze + F while on foot). Empty marker
   * position is the gaze / powered-screen anchor in station space.
   */
  | {
      type: "outfitters";
      id: string;
      /** Prompt when gazing (default "Browse outfitters"). */
      label?: string;
      /** Max perpendicular distance from the camera ray to count as a gaze hit (m). */
      gazeRadius?: number;
      /** Max distance from the camera to the marker (m). */
      maxDistance?: number;
      /** Powered screen plane width in meters (visual only). */
      screenWidth?: number;
      /** Powered screen plane height in meters (visual only). */
      screenHeight?: number;
      /**
       * Optional filter of catalog outfitters item definition ids.
       * Empty / omitted = sell all stocked categories from the live catalog.
       */
      itemDefinitionIds?: string[];
    }
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
      type: "sound";
      /** Assigned audio asset. May be omitted while the marker is being authored. */
      soundUrl?: string;
      mode: "ambient" | "spatial";
      playback: "loop" | "enter";
      /** Per-source gain before the global master/SFX settings, 0..1. */
      volume: number;
      /** Local-space distance over which a loop fades in from the zone boundary. */
      blendDistance: number;
      zone: PrefabSoundZone;
    }
  | {
      type: "particle-system";
      enabled?: boolean;
      playOnAwake?: boolean;
      duration: number;
      looping: boolean;
      prewarm?: boolean;
      startDelay: PrefabMinMax;
      startLifetime: PrefabMinMax;
      startSpeed: PrefabMinMax;
      startSize: PrefabMinMax;
      startColor: PrefabColor;
      startRotation: PrefabMinMax;
      gravityModifier: number;
      simulationSpace: PrefabParticleSimulationSpace;
      maxParticles: number;
      emission: PrefabParticleEmission;
      shape: PrefabParticleShape;
      velocityOverLifetime?: PrefabParticleVelocityOverLifetime;
      forceOverLifetime?: PrefabParticleForceOverLifetime;
      colorOverLifetime?: PrefabParticleColorOverLifetime;
      sizeOverLifetime?: PrefabParticleSizeOverLifetime;
      textureSheetAnimation?: PrefabParticleTextureSheet;
      collision?: PrefabParticleCollision;
      trails?: PrefabParticleTrails;
      renderer: PrefabParticleRenderer;
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
  /**
   * Singleton ship wiring on the hull entity: stats, articulation, doors,
   * seats, ramp interacts, camera bounds, and deck spawn. Child empties are
   * referenced by entity id for gizmo placement.
   */
  | {
      type: "ship-controller";
      restHeight?: number;
      stats?: {
        maxSpeedMps?: number;
        maxHp?: number;
        maxShields?: number;
        shieldRegenPerSec?: number;
        /** Inertial mass (kg). Higher = slower accel / turn. */
        massKg?: number;
        /** Hard cap on |angular velocity| (rad/s). */
        maxAngularRateRadps?: number;
        /** Forward thruster force (N). Accel ≈ thrust / mass. */
        forwardThrustN?: number;
        /** Reverse thruster force (N). */
        backwardThrustN?: number;
        /** Vertical thruster force (N). */
        verticalThrustN?: number;
        /** Lateral thruster force (N). */
        lateralThrustN?: number;
        /** Pitch thruster torque (N·m). */
        pitchTorqueNm?: number;
        /** Yaw thruster torque (N·m). */
        yawTorqueNm?: number;
        /** Roll thruster torque (N·m). */
        rollTorqueNm?: number;
        /**
         * Cockpit FOV widen (degrees) at full forward thrust.
         * 0 = disabled.
         */
        thrustFovForwardDeg?: number;
        /**
         * Cockpit FOV narrow (degrees) at full reverse thrust.
         * 0 = disabled.
         */
        thrustFovBackwardDeg?: number;
        /** How quickly FOV lerps toward the thrust target (1/s). */
        thrustFovBlendPerSec?: number;
        /** Cockpit eye shake amplitude while boosting (meters). 0 = off. */
        boostShakeAmplitudeM?: number;
        /** Boost shake oscillation rate (Hz). */
        boostShakeHz?: number;
        /** How quickly boost effects / SFX fade in and out (1/s). */
        boostBlendPerSec?: number;
        /** Looping SFX while boost is held (drag audio from the asset browser). */
        boostSoundUrl?: string;
        /** Boost SFX volume 0..1 (default 1). */
        boostSoundVolume?: number;
        /** Looping SFX while throttling forward/back (drag audio from the asset browser). */
        thrustSoundUrl?: string;
        /** Thrust SFX volume 0..1 (default 1). */
        thrustSoundVolume?: number;
      };
      gear?: {
        nodes: {
          name: string;
          /** Unique ancestor for duplicate bone names (mirrored back legs). */
          under?: string;
          deployRadians: number;
          axis?: "x" | "y" | "z";
        }[];
        /** SFX when gear deploys (gearDown → true). */
        deploySoundUrl?: string;
        /** SFX when gear retracts (gearDown → false). */
        retractSoundUrl?: string;
      };
      ramp?: {
        hinge: { node: string; lowerRadians: number; axis?: "x" | "y" | "z" };
        outsideInteractId?: string;
        outsideRadius?: number;
        deckInteractId?: string;
        deckRadius?: number;
        /** SFX when ramp lowers (rampDown → true). */
        openSoundUrl?: string;
        /** SFX when ramp raises (rampDown → false). */
        closeSoundUrl?: string;
      };
      doors?: {
        id: string;
        label: string;
        motion: "slide" | "hinge";
        axis: "x" | "y" | "z";
        nodes: {
          name: string;
          delta: number;
          under?: string;
        }[];
        interactEntityId: string;
        trigger?: "radial" | "raycast";
        radius?: number;
        aimRadius?: number;
        defaultOpen?: boolean;
        openSoundUrl?: string;
        closeSoundUrl?: string;
      }[];
      seats?: {
        role?: ShipSeatRole;
        entityId: string;
        eye?: Vec3;
        stand?: PrefabVec2;
        interactRadius?: number;
      }[];
      deckSpawnEntityId?: string;
      cameraBounds?: {
        id?: string;
        min: PrefabVec2;
        max: PrefabVec2;
        floorUp: number;
        slopeMinUp?: number;
        ceilingUp: number;
        /** Ramp volumes open to the outside skip interior camera clamping. */
        openToOutside?: boolean;
      }[];
    }
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
      nodes: {
        name: string;
        /** Unique ancestor for duplicate bone names (mirrored back legs). */
        under?: string;
        deployRadians: number;
        axis?: "x" | "y" | "z";
      }[];
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
      type: "ship-door";
      /** Unique within the prefab. */
      id: string;
      /** Display name for prompts ("Press F — open {label}"). */
      label: string;
      motion: "slide" | "hinge";
      /** Node-local axis the motion happens on. */
      axis: "x" | "y" | "z";
      /** GLB node names + signed open delta (slide: meters, hinge: radians). */
      nodes: {
        name: string;
        delta: number;
        /** Unique ancestor when duplicate bone/node names exist (mirrored wardrobe). */
        under?: string;
      }[];
      /**
       * How F-key interact is detected (default radial).
       * radial = stand inside the sphere; raycast = aim camera at the marker within radius.
       */
      trigger?: "radial" | "raycast";
      /** Interact distance from the entity (radial stand reach / raycast max range; default 1.6). */
      radius?: number;
      /** Raycast-only: max perpendicular miss from the camera ray to the marker (default 0.35). */
      aimRadius?: number;
      defaultOpen?: boolean;
      /** One-shot SFX when the door opens (asset browser drag). */
      openSoundUrl?: string;
      /** One-shot SFX when the door closes. */
      closeSoundUrl?: string;
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
  /** Ship bunk: F to lie down (no flight). Empty position is the mattress/interact anchor. */
  | {
      type: "bed";
      /** Unique within the prefab. */
      id: string;
      /** Display name for prompts ("Press F — lie down" / label variant). */
      label?: string;
      /**
       * How F-key interact is detected (default radial).
       * radial = stand inside the sphere; raycast = aim camera at the marker within radius.
       */
      trigger?: "radial" | "raycast";
      /** Interact distance from the entity (radial stand reach / raycast max range; default 1.6). */
      radius?: number;
      /** Raycast-only: max perpendicular miss from the camera ray to the marker (default 0.35). */
      aimRadius?: number;
      /** Head/eye offset from the marker in scene axes (default {0, 0.3, 0.15}). */
      eye?: Vec3;
      /** Get-up spot offset from the marker in scene XZ (default {-0.9, 0}). */
      stand?: PrefabVec2;
    }
  | {
      type: "ramp-interact";
      /** outside: ground-level ramp toggle; deck: interior ramp panel. */
      placement: "outside" | "deck";
      radius?: number;
    }
  /**
   * Cockpit look-at control (Hold F free-look + click). Empty marker entity
   * position is the gaze target in ship space.
   */
  | {
      type: "cockpit-control";
      id: string;
      action: CockpitControlAction;
      /** Optional label override; runtime otherwise derives from action + rig state. */
      label?: string;
      /** Max perpendicular distance from the camera ray to count as a gaze hit (m). */
      gazeRadius?: number;
      /** Max distance from the camera to the marker (m). */
      maxDistance?: number;
    }
  /**
   * Cockpit instrument readout (always-on while piloting). Empty marker
   * position is the world-projected HUD anchor in ship space.
   */
  | {
      type: "cockpit-stat";
      id: string;
      kind: CockpitStatKind;
      /** Optional title override (default from kind, e.g. SPEED). */
      label?: string;
      /** Max distance from the pilot eye to show this instrument (m). */
      maxDistance?: number;
    }
  /**
   * Bunk entertainment system screen (gaze + F while in bed). Empty marker
   * position is the gaze / powered-screen anchor in ship space.
   */
  | {
      type: "entertainment-system";
      id: string;
      /** Prompt when gazing (default "Turn on ES"). */
      label?: string;
      /** Max perpendicular distance from the camera ray to count as a gaze hit (m). */
      gazeRadius?: number;
      /** Max distance from the camera to the marker (m). */
      maxDistance?: number;
      /** Powered screen plane width in meters (visual only). */
      screenWidth?: number;
      /** Powered screen plane height in meters (visual only). */
      screenHeight?: number;
    };

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

function parseClampedNumber(
  value: unknown,
  path: string,
  min: number,
  max: number,
): number {
  return Math.min(max, Math.max(min, parseFiniteNumber(value, path)));
}

function parseMinMax(
  value: unknown,
  path: string,
  min: number,
  max: number,
): PrefabMinMax {
  if (typeof value === "number" && Number.isFinite(value)) {
    return { mode: "constant", value: Math.min(max, Math.max(min, value)) };
  }
  if (!isRecord(value)) fail(path, "expected number or {mode,value}|{mode,min,max}");
  if (value.mode === "random") {
    const lo = parseClampedNumber(value.min, `${path}.min`, min, max);
    const hi = parseClampedNumber(value.max, `${path}.max`, min, max);
    return { mode: "random", min: Math.min(lo, hi), max: Math.max(lo, hi) };
  }
  const constant =
    value.value === undefined
      ? parseClampedNumber(value.constant, `${path}.value`, min, max)
      : parseClampedNumber(value.value, `${path}.value`, min, max);
  return { mode: "constant", value: constant };
}

function parseCurve(value: unknown, path: string): PrefabCurve {
  if (!Array.isArray(value) || value.length === 0) {
    fail(path, "expected non-empty keyframe array");
  }
  if (value.length > 16) fail(path, "too many curve keys (max 16)");
  return value.map((key, index) => {
    if (!isRecord(key)) fail(`${path}[${index}]`, "expected {t,value}");
    return {
      t: parseUnitValue(key.t, `${path}[${index}].t`),
      value: parseFiniteNumber(key.value, `${path}[${index}].value`),
    };
  });
}

function parseGradient(value: unknown, path: string): PrefabGradient {
  if (!Array.isArray(value) || value.length === 0) {
    fail(path, "expected non-empty gradient keyframe array");
  }
  if (value.length > 16) fail(path, "too many gradient keys (max 16)");
  return value.map((key, index) => {
    if (!isRecord(key)) fail(`${path}[${index}]`, "expected {t,color}");
    return {
      t: parseUnitValue(key.t, `${path}[${index}].t`),
      color: parseColor(key.color, `${path}[${index}].color`),
      alpha:
        key.alpha === undefined
          ? undefined
          : parseUnitValue(key.alpha, `${path}[${index}].alpha`),
    };
  });
}

function parseOptionalCurve(
  value: unknown,
  path: string,
): PrefabCurve | undefined {
  return value === undefined ? undefined : parseCurve(value, path);
}

function parseOptionalGradient(
  value: unknown,
  path: string,
): PrefabGradient | undefined {
  return value === undefined ? undefined : parseGradient(value, path);
}

export function createDefaultParticleSystemComponent(): PrefabComponent & {
  type: "particle-system";
} {
  return {
    type: "particle-system",
    enabled: true,
    playOnAwake: true,
    duration: 5,
    looping: true,
    prewarm: false,
    startDelay: { mode: "constant", value: 0 },
    startLifetime: { mode: "random", min: 0.8, max: 1.4 },
    startSpeed: { mode: "random", min: 0.4, max: 1.2 },
    startSize: { mode: "random", min: 0.04, max: 0.1 },
    startColor: "#ffe6a8",
    startRotation: { mode: "constant", value: 0 },
    gravityModifier: 0.15,
    simulationSpace: "local",
    maxParticles: 128,
    emission: {
      rateOverTime: 24,
      bursts: [],
    },
    shape: {
      enabled: true,
      shape: "cone",
      radius: 0.15,
      radiusThickness: 1,
      angle: 18,
      arc: 360,
      box: { x: 1, y: 1, z: 1 },
      emitFrom: "volume",
      alignToDirection: true,
    },
    velocityOverLifetime: {
      enabled: false,
      space: "local",
      linear: { x: 0, y: 0, z: 0 },
      orbital: { x: 0, y: 0, z: 0 },
      radial: 0,
    },
    forceOverLifetime: {
      enabled: false,
      space: "local",
      force: { x: 0, y: 0, z: 0 },
    },
    colorOverLifetime: {
      enabled: true,
      gradient: [
        { t: 0, color: "#ffe6a8", alpha: 1 },
        { t: 1, color: "#ff6a2a", alpha: 0 },
      ],
    },
    sizeOverLifetime: {
      enabled: true,
      curve: [
        { t: 0, value: 1 },
        { t: 1, value: 0.2 },
      ],
    },
    textureSheetAnimation: {
      enabled: false,
      tilesX: 1,
      tilesY: 1,
      animation: "whole-sheet",
      cycles: 1,
      startFrame: 0,
    },
    collision: {
      enabled: false,
      type: "planes",
      groundPlane: true,
      planes: [],
      dampen: 0.1,
      bounce: 0.3,
      lifetimeLoss: 0.1,
      maxKillSpeed: 100,
    },
    trails: {
      enabled: false,
      ratio: 0.3,
      lifetime: 0.35,
      minVertexDistance: 0.05,
      widthOverTrail: [
        { t: 0, value: 1 },
        { t: 1, value: 0 },
      ],
      colorOverTrail: [
        { t: 0, color: "#ffe6a8", alpha: 0.8 },
        { t: 1, color: "#ff6a2a", alpha: 0 },
      ],
      dieWithParticles: true,
    },
    renderer: {
      renderMode: "billboard",
      blendMode: "additive",
      softParticles: false,
      softParticleNearFade: 0.2,
      softParticleFarFade: 1.5,
      lengthScale: 1,
      speedScale: 0.05,
      sortMode: "none",
    },
  };
}

function parseParticleSystemComponent(
  value: Record<string, unknown>,
  path: string,
): PrefabComponent & { type: "particle-system" } {
  const defaults = createDefaultParticleSystemComponent();
  const simulationSpace =
    value.simulationSpace === "world" ? "world" : "local";
  const emissionRaw = isRecord(value.emission) ? value.emission : {};
  const burstsRaw = Array.isArray(emissionRaw.bursts) ? emissionRaw.bursts : [];
  if (burstsRaw.length > 16) fail(`${path}.emission.bursts`, "too many bursts (max 16)");
  const shapeRaw = isRecord(value.shape) ? value.shape : {};
  const shapeType = shapeRaw.shape;
  const parsedShapeType: PrefabParticleShapeType =
    shapeType === "sphere" ||
    shapeType === "hemisphere" ||
    shapeType === "cone" ||
    shapeType === "box" ||
    shapeType === "circle" ||
    shapeType === "edge"
      ? shapeType
      : defaults.shape.shape;
  const emitFrom =
    shapeRaw.emitFrom === "shell" || shapeRaw.emitFrom === "edge"
      ? shapeRaw.emitFrom
      : "volume";
  const rendererRaw = isRecord(value.renderer) ? value.renderer : {};
  const renderMode =
    rendererRaw.renderMode === "stretched-billboard" ||
    rendererRaw.renderMode === "horizontal" ||
    rendererRaw.renderMode === "vertical"
      ? rendererRaw.renderMode
      : "billboard";
  const blendMode =
    rendererRaw.blendMode === "alpha" ? "alpha" : "additive";
  const sortMode =
    rendererRaw.sortMode === "by-distance" ? "by-distance" : "none";

  const parseOptionalModule = <T>(
    raw: unknown,
    build: (record: Record<string, unknown>) => T,
  ): T | undefined => {
    if (raw === undefined) return undefined;
    if (!isRecord(raw)) return undefined;
    return build(raw);
  };

  return {
    type: "particle-system",
    enabled: value.enabled === undefined ? true : Boolean(value.enabled),
    playOnAwake:
      value.playOnAwake === undefined ? true : Boolean(value.playOnAwake),
    duration: parseClampedNumber(value.duration ?? defaults.duration, `${path}.duration`, 0.01, 600),
    looping: value.looping === undefined ? true : Boolean(value.looping),
    prewarm: value.prewarm === undefined ? false : Boolean(value.prewarm),
    startDelay: parseMinMax(value.startDelay ?? defaults.startDelay, `${path}.startDelay`, 0, 60),
    startLifetime: parseMinMax(
      value.startLifetime ?? defaults.startLifetime,
      `${path}.startLifetime`,
      0.01,
      120,
    ),
    startSpeed: parseMinMax(
      value.startSpeed ?? defaults.startSpeed,
      `${path}.startSpeed`,
      -200,
      200,
    ),
    startSize: parseMinMax(
      value.startSize ?? defaults.startSize,
      `${path}.startSize`,
      0.001,
      50,
    ),
    startColor: parseColor(
      value.startColor ?? defaults.startColor,
      `${path}.startColor`,
    ),
    startRotation: parseMinMax(
      value.startRotation ?? defaults.startRotation,
      `${path}.startRotation`,
      -3600,
      3600,
    ),
    gravityModifier: parseClampedNumber(
      value.gravityModifier ?? defaults.gravityModifier,
      `${path}.gravityModifier`,
      -20,
      20,
    ),
    simulationSpace,
    maxParticles: Math.min(
      PARTICLE_MAX_PARTICLES_HARD_CAP,
      Math.max(
        1,
        Math.floor(
          parseFiniteNumber(
            value.maxParticles ?? defaults.maxParticles,
            `${path}.maxParticles`,
          ),
        ),
      ),
    ),
    emission: {
      rateOverTime: parseClampedNumber(
        emissionRaw.rateOverTime ?? defaults.emission.rateOverTime,
        `${path}.emission.rateOverTime`,
        0,
        10_000,
      ),
      bursts: burstsRaw.map((burst, index) => {
        if (!isRecord(burst)) {
          fail(`${path}.emission.bursts[${index}]`, "expected burst object");
        }
        return {
          time: parseClampedNumber(burst.time, `${path}.emission.bursts[${index}].time`, 0, 600),
          count: parseMinMax(
            burst.count ?? { mode: "constant", value: 8 },
            `${path}.emission.bursts[${index}].count`,
            0,
            2048,
          ),
          cycles:
            burst.cycles === undefined
              ? undefined
              : Math.min(
                  1000,
                  Math.max(
                    1,
                    Math.floor(
                      parseFiniteNumber(
                        burst.cycles,
                        `${path}.emission.bursts[${index}].cycles`,
                      ),
                    ),
                  ),
                ),
          interval:
            burst.interval === undefined
              ? undefined
              : parseClampedNumber(
                  burst.interval,
                  `${path}.emission.bursts[${index}].interval`,
                  0.01,
                  60,
                ),
        };
      }),
    },
    shape: {
      enabled: shapeRaw.enabled === undefined ? true : Boolean(shapeRaw.enabled),
      shape: parsedShapeType,
      radius: parseClampedNumber(
        shapeRaw.radius ?? defaults.shape.radius,
        `${path}.shape.radius`,
        0,
        500,
      ),
      radiusThickness: parseUnitValue(
        shapeRaw.radiusThickness ?? defaults.shape.radiusThickness,
        `${path}.shape.radiusThickness`,
      ),
      angle: parseClampedNumber(
        shapeRaw.angle ?? defaults.shape.angle,
        `${path}.shape.angle`,
        0,
        180,
      ),
      arc: parseClampedNumber(
        shapeRaw.arc ?? defaults.shape.arc,
        `${path}.shape.arc`,
        0,
        360,
      ),
      box: (() => {
        const box = parseVec3(shapeRaw.box ?? defaults.shape.box, `${path}.shape.box`);
        return {
          x: Math.min(500, Math.max(0.01, box.x)),
          y: Math.min(500, Math.max(0.01, box.y)),
          z: Math.min(500, Math.max(0.01, box.z)),
        };
      })(),
      emitFrom,
      alignToDirection: Boolean(
        shapeRaw.alignToDirection ?? defaults.shape.alignToDirection,
      ),
    },
    velocityOverLifetime: parseOptionalModule(value.velocityOverLifetime, (raw) => ({
      enabled: Boolean(raw.enabled),
      space: raw.space === "world" ? "world" : "local",
      linear: parseVec3(raw.linear ?? { x: 0, y: 0, z: 0 }, `${path}.velocityOverLifetime.linear`),
      orbital: parseVec3(
        raw.orbital ?? { x: 0, y: 0, z: 0 },
        `${path}.velocityOverLifetime.orbital`,
      ),
      radial: parseClampedNumber(
        raw.radial ?? 0,
        `${path}.velocityOverLifetime.radial`,
        -200,
        200,
      ),
    })),
    forceOverLifetime: parseOptionalModule(value.forceOverLifetime, (raw) => ({
      enabled: Boolean(raw.enabled),
      space: raw.space === "world" ? "world" : "local",
      force: parseVec3(raw.force ?? { x: 0, y: 0, z: 0 }, `${path}.forceOverLifetime.force`),
    })),
    colorOverLifetime: parseOptionalModule(value.colorOverLifetime, (raw) => ({
      enabled: Boolean(raw.enabled),
      gradient: parseGradient(
        raw.gradient ?? defaults.colorOverLifetime!.gradient,
        `${path}.colorOverLifetime.gradient`,
      ),
    })),
    sizeOverLifetime: parseOptionalModule(value.sizeOverLifetime, (raw) => ({
      enabled: Boolean(raw.enabled),
      curve: parseCurve(
        raw.curve ?? defaults.sizeOverLifetime!.curve,
        `${path}.sizeOverLifetime.curve`,
      ),
    })),
    textureSheetAnimation: parseOptionalModule(value.textureSheetAnimation, (raw) => ({
      enabled: Boolean(raw.enabled),
      tilesX: Math.min(
        16,
        Math.max(1, Math.floor(parseFiniteNumber(raw.tilesX ?? 1, `${path}.textureSheetAnimation.tilesX`))),
      ),
      tilesY: Math.min(
        16,
        Math.max(1, Math.floor(parseFiniteNumber(raw.tilesY ?? 1, `${path}.textureSheetAnimation.tilesY`))),
      ),
      animation: raw.animation === "single-row" ? "single-row" : "whole-sheet",
      cycles: parseClampedNumber(
        raw.cycles ?? 1,
        `${path}.textureSheetAnimation.cycles`,
        0.01,
        64,
      ),
      startFrame: Math.min(
        255,
        Math.max(
          0,
          Math.floor(
            parseFiniteNumber(raw.startFrame ?? 0, `${path}.textureSheetAnimation.startFrame`),
          ),
        ),
      ),
    })),
    collision: parseOptionalModule(value.collision, (raw) => {
      const planesRaw = Array.isArray(raw.planes) ? raw.planes : [];
      if (planesRaw.length > 8) fail(`${path}.collision.planes`, "too many planes (max 8)");
      return {
        enabled: Boolean(raw.enabled),
        type: "planes" as const,
        groundPlane: raw.groundPlane === undefined ? true : Boolean(raw.groundPlane),
        planes: planesRaw.map((plane, index) => {
          if (!isRecord(plane)) {
            fail(`${path}.collision.planes[${index}]`, "expected {point,normal}");
          }
          return {
            point: parseVec3(plane.point, `${path}.collision.planes[${index}].point`),
            normal: parseVec3(plane.normal, `${path}.collision.planes[${index}].normal`),
          };
        }),
        dampen: parseUnitValue(raw.dampen ?? 0.1, `${path}.collision.dampen`),
        bounce: parseUnitValue(raw.bounce ?? 0.3, `${path}.collision.bounce`),
        lifetimeLoss: parseUnitValue(
          raw.lifetimeLoss ?? 0.1,
          `${path}.collision.lifetimeLoss`,
        ),
        maxKillSpeed: parseClampedNumber(
          raw.maxKillSpeed ?? 100,
          `${path}.collision.maxKillSpeed`,
          0,
          10_000,
        ),
      };
    }),
    trails: parseOptionalModule(value.trails, (raw) => ({
      enabled: Boolean(raw.enabled),
      ratio: parseUnitValue(raw.ratio ?? 0.3, `${path}.trails.ratio`),
      lifetime: parseClampedNumber(raw.lifetime ?? 0.35, `${path}.trails.lifetime`, 0.01, 30),
      minVertexDistance: parseClampedNumber(
        raw.minVertexDistance ?? 0.05,
        `${path}.trails.minVertexDistance`,
        0.001,
        10,
      ),
      widthOverTrail:
        parseOptionalCurve(raw.widthOverTrail, `${path}.trails.widthOverTrail`) ??
        defaults.trails!.widthOverTrail,
      colorOverTrail:
        parseOptionalGradient(raw.colorOverTrail, `${path}.trails.colorOverTrail`) ??
        defaults.trails!.colorOverTrail,
      dieWithParticles:
        raw.dieWithParticles === undefined ? true : Boolean(raw.dieWithParticles),
    })),
    renderer: {
      renderMode,
      textureUrl:
        rendererRaw.textureUrl === undefined
          ? undefined
          : parseAssetUrl(rendererRaw.textureUrl, `${path}.renderer.textureUrl`),
      blendMode,
      softParticles: Boolean(rendererRaw.softParticles),
      softParticleNearFade: parseClampedNumber(
        rendererRaw.softParticleNearFade ?? defaults.renderer.softParticleNearFade,
        `${path}.renderer.softParticleNearFade`,
        0,
        50,
      ),
      softParticleFarFade: parseClampedNumber(
        rendererRaw.softParticleFarFade ?? defaults.renderer.softParticleFarFade,
        `${path}.renderer.softParticleFarFade`,
        0.01,
        200,
      ),
      lengthScale: parseClampedNumber(
        rendererRaw.lengthScale ?? defaults.renderer.lengthScale,
        `${path}.renderer.lengthScale`,
        0,
        50,
      ),
      speedScale: parseClampedNumber(
        rendererRaw.speedScale ?? defaults.renderer.speedScale,
        `${path}.renderer.speedScale`,
        0,
        10,
      ),
      sortMode,
    },
  };
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
    case "equipment-socket": {
      if (!isWeaponSlotType(value.accepts)) {
        fail(`${path}.accepts`, "expected sword, handgun, or rifle");
      }
      return {
        type,
        id: parseString(value.id, `${path}.id`, 64),
        accepts: value.accepts,
      };
    }
    case "drawn-grip":
      return { type };
    case "spawn-point":
      return { type, floorId: parseFloorId(value.floorId, `${path}.floorId`) };
    case "npc-spawner": {
      const minAlive = Math.min(
        32,
        Math.max(0, Math.round(parseFiniteNumber(value.minAlive, `${path}.minAlive`))),
      );
      const maxAlive = Math.min(
        32,
        Math.max(minAlive, Math.round(parseFiniteNumber(value.maxAlive, `${path}.maxAlive`))),
      );
      return {
        type,
        id: parseString(value.id, `${path}.id`, 64),
        populationId: parseString(value.populationId, `${path}.populationId`, 64),
        floorId: parseFloorId(value.floorId, `${path}.floorId`),
        minAlive,
        maxAlive,
        routeGroup: parseString(value.routeGroup, `${path}.routeGroup`, 64),
        radius: Math.min(
          20,
          Math.max(0, parseFiniteNumber(value.radius, `${path}.radius`)),
        ),
      };
    }
    case "npc-waypoint": {
      if (!Array.isArray(value.links)) {
        fail(`${path}.links`, "expected array of waypoint ids");
      }
      if (value.links.length > 16) {
        fail(`${path}.links`, "too many waypoint links (max 16)");
      }
      const links = value.links
        .map((link, index) => parseString(link, `${path}.links[${index}]`, 64))
        .filter((link, index, all) => link.length > 0 && all.indexOf(link) === index);
      const waitMinSeconds = Math.min(
        120,
        Math.max(0, parseFiniteNumber(value.waitMinSeconds, `${path}.waitMinSeconds`)),
      );
      const waitMaxSeconds = Math.min(
        120,
        Math.max(
          waitMinSeconds,
          parseFiniteNumber(value.waitMaxSeconds, `${path}.waitMaxSeconds`),
        ),
      );
      return {
        type,
        id: parseString(value.id, `${path}.id`, 64),
        floorId: parseFloorId(value.floorId, `${path}.floorId`),
        routeGroup: parseString(value.routeGroup, `${path}.routeGroup`, 64),
        links,
        waitMinSeconds,
        waitMaxSeconds,
      };
    }
    case "npc-placement": {
      const behavior = value.behavior;
      if (behavior !== "stationary" && behavior !== "wander" && behavior !== "patrol") {
        fail(`${path}.behavior`, 'expected "stationary", "wander", or "patrol"');
      }
      return {
        type,
        id: parseString(value.id, `${path}.id`, 64),
        npcDefinitionId: parseString(value.npcDefinitionId, `${path}.npcDefinitionId`, 64),
        ...(value.displayName === undefined
          ? {}
          : { displayName: parseString(value.displayName, `${path}.displayName`, 64) }),
        floorId: parseFloorId(value.floorId, `${path}.floorId`),
        behavior,
        ...(value.routeGroup === undefined
          ? {}
          : { routeGroup: parseString(value.routeGroup, `${path}.routeGroup`, 64) }),
      };
    }
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
        ...(value.proximitySoundUrl !== undefined
          ? { proximitySoundUrl: parseAssetUrl(value.proximitySoundUrl, `${path}.proximitySoundUrl`) }
          : {}),
        ...(value.interactSoundUrl !== undefined
          ? { interactSoundUrl: parseAssetUrl(value.interactSoundUrl, `${path}.interactSoundUrl`) }
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
    case "object-animation": {
      const mode = value.mode;
      if (mode !== "spin" && mode !== "hover") {
        fail(`${path}.mode`, 'expected "spin" or "hover"');
      }
      const axis = value.axis;
      if (axis !== "x" && axis !== "y" && axis !== "z") {
        fail(`${path}.axis`, 'expected "x", "y", or "z"');
      }
      let nodes: { name: string }[] | undefined;
      if (value.nodes !== undefined) {
        if (!Array.isArray(value.nodes)) {
          fail(`${path}.nodes`, "expected array of {name}");
        }
        if (value.nodes.length > 8) {
          fail(`${path}.nodes`, "too many object-animation nodes (max 8)");
        }
        nodes = value.nodes.map((node, index) => {
          if (!isRecord(node)) {
            fail(`${path}.nodes[${index}]`, "expected {name}");
          }
          return {
            name: parseString(node.name, `${path}.nodes[${index}].name`, 128),
          };
        });
      }
      return {
        type,
        id: parseString(value.id, `${path}.id`, 64),
        mode,
        axis,
        ...(nodes !== undefined ? { nodes } : {}),
        speed:
          value.speed === undefined
            ? undefined
            : Math.min(
                100,
                Math.max(0, parseFiniteNumber(value.speed, `${path}.speed`)),
              ),
        amplitude:
          value.amplitude === undefined
            ? undefined
            : Math.min(
                10,
                Math.max(
                  0,
                  parseFiniteNumber(value.amplitude, `${path}.amplitude`),
                ),
              ),
        phase:
          value.phase === undefined
            ? undefined
            : parseFiniteNumber(value.phase, `${path}.phase`),
        reverse:
          value.reverse === undefined ? undefined : Boolean(value.reverse),
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
    case "weapon-shop": {
      const idsRaw = value.itemDefinitionIds;
      let itemDefinitionIds: string[] | undefined;
      if (idsRaw !== undefined) {
        if (!Array.isArray(idsRaw)) {
          fail(`${path}.itemDefinitionIds`, "expected array of strings");
        }
        itemDefinitionIds = idsRaw
          .map((id, index) =>
            parseString(id, `${path}.itemDefinitionIds[${index}]`, 64),
          )
          .filter((id) => id.length > 0);
        if (itemDefinitionIds.length === 0) itemDefinitionIds = undefined;
      }
      return {
        type,
        id: parseString(value.id, `${path}.id`, 64),
        label:
          value.label === undefined
            ? undefined
            : parseString(value.label, `${path}.label`, 64),
        gazeRadius:
          value.gazeRadius === undefined
            ? undefined
            : Math.min(
                2,
                Math.max(
                  0.05,
                  parseFiniteNumber(value.gazeRadius, `${path}.gazeRadius`),
                ),
              ),
        maxDistance:
          value.maxDistance === undefined
            ? undefined
            : Math.min(
                10,
                Math.max(
                  0.5,
                  parseFiniteNumber(value.maxDistance, `${path}.maxDistance`),
                ),
              ),
        screenWidth:
          value.screenWidth === undefined
            ? undefined
            : Math.min(
                2,
                Math.max(
                  0.2,
                  parseFiniteNumber(value.screenWidth, `${path}.screenWidth`),
                ),
              ),
        screenHeight:
          value.screenHeight === undefined
            ? undefined
            : Math.min(
                1.5,
                Math.max(
                  0.15,
                  parseFiniteNumber(value.screenHeight, `${path}.screenHeight`),
                ),
              ),
        itemDefinitionIds,
      };
    }
    case "outfitters": {
      const idsRaw = value.itemDefinitionIds;
      let itemDefinitionIds: string[] | undefined;
      if (idsRaw !== undefined) {
        if (!Array.isArray(idsRaw)) {
          fail(`${path}.itemDefinitionIds`, "expected array of strings");
        }
        itemDefinitionIds = idsRaw
          .map((id, index) =>
            parseString(id, `${path}.itemDefinitionIds[${index}]`, 64),
          )
          .filter((id) => id.length > 0);
        if (itemDefinitionIds.length === 0) itemDefinitionIds = undefined;
      }
      return {
        type,
        id: parseString(value.id, `${path}.id`, 64),
        label:
          value.label === undefined
            ? undefined
            : parseString(value.label, `${path}.label`, 64),
        gazeRadius:
          value.gazeRadius === undefined
            ? undefined
            : Math.min(
                2,
                Math.max(
                  0.05,
                  parseFiniteNumber(value.gazeRadius, `${path}.gazeRadius`),
                ),
              ),
        maxDistance:
          value.maxDistance === undefined
            ? undefined
            : Math.min(
                10,
                Math.max(
                  0.5,
                  parseFiniteNumber(value.maxDistance, `${path}.maxDistance`),
                ),
              ),
        screenWidth:
          value.screenWidth === undefined
            ? undefined
            : Math.min(
                2,
                Math.max(
                  0.2,
                  parseFiniteNumber(value.screenWidth, `${path}.screenWidth`),
                ),
              ),
        screenHeight:
          value.screenHeight === undefined
            ? undefined
            : Math.min(
                1.5,
                Math.max(
                  0.15,
                  parseFiniteNumber(value.screenHeight, `${path}.screenHeight`),
                ),
              ),
        itemDefinitionIds,
      };
    }
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
    case "sound": {
      const mode = value.mode;
      if (mode !== "ambient" && mode !== "spatial") {
        fail(`${path}.mode`, 'expected "ambient" or "spatial"');
      }
      const playback = value.playback;
      if (playback !== "loop" && playback !== "enter") {
        fail(`${path}.playback`, 'expected "loop" or "enter"');
      }
      if (!isRecord(value.zone)) fail(`${path}.zone`, "expected zone object");
      const shape = value.zone.shape;
      const zone: PrefabSoundZone =
        shape === "sphere"
          ? {
              shape,
              radius: Math.min(
                500,
                Math.max(
                  0.05,
                  parseFiniteNumber(value.zone.radius, `${path}.zone.radius`),
                ),
              ),
            }
          : shape === "box"
            ? {
                shape,
                size: (() => {
                  const size = parseVec3(value.zone.size, `${path}.zone.size`);
                  return {
                    x: Math.min(1_000, Math.max(0.05, size.x)),
                    y: Math.min(1_000, Math.max(0.05, size.y)),
                    z: Math.min(1_000, Math.max(0.05, size.z)),
                  };
                })(),
              }
            : fail(`${path}.zone.shape`, 'expected "sphere" or "box"');
      const maxBlend =
        zone.shape === "sphere"
          ? zone.radius
          : Math.min(zone.size.x, zone.size.y, zone.size.z) / 2;
      return {
        type,
        soundUrl:
          value.soundUrl === undefined
            ? undefined
            : parseAssetUrl(value.soundUrl, `${path}.soundUrl`),
        mode,
        playback,
        volume: parseUnitValue(value.volume, `${path}.volume`),
        blendDistance: Math.min(
          maxBlend,
          Math.max(
            0,
            parseFiniteNumber(value.blendDistance, `${path}.blendDistance`),
          ),
        ),
        zone,
      };
    }
    case "particle-system":
      return parseParticleSystemComponent(value, path);
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
    case "ship-controller": {
      const parseHingeAxis = (
        raw: unknown,
        path: string,
      ): "x" | "y" | "z" | undefined => {
        if (raw === undefined) return undefined;
        if (raw === "x" || raw === "y" || raw === "z") return raw;
        fail(path, 'expected "x", "y", or "z"');
      };
      const parseGearNodes = (raw: unknown, path: string) => {
        if (!Array.isArray(raw) || raw.length === 0) {
          fail(path, "expected non-empty array of gear hinges");
        }
        if (raw.length > 16) fail(path, "too many gear nodes (max 16)");
        return raw.map((node, index) => {
          if (!isRecord(node))
            fail(`${path}[${index}]`, "expected {name, deployRadians}");
          const under =
            node.under === undefined
              ? undefined
              : parseString(node.under, `${path}[${index}].under`, 128);
          return {
            name: parseString(node.name, `${path}[${index}].name`, 128),
            ...(under ? { under } : {}),
            deployRadians: Math.min(
              10,
              Math.max(
                -10,
                parseFiniteNumber(
                  node.deployRadians,
                  `${path}[${index}].deployRadians`,
                ),
              ),
            ),
            axis: parseHingeAxis(node.axis, `${path}[${index}].axis`),
          };
        });
      };
      const parseDoorNodes = (raw: unknown, path: string) => {
        if (!Array.isArray(raw) || raw.length === 0) {
          fail(path, "expected non-empty array of {name, delta}");
        }
        if (raw.length > 8) fail(path, "too many door nodes (max 8)");
        return raw.map((node, index) => {
          if (!isRecord(node))
            fail(`${path}[${index}]`, "expected {name, delta}");
          const under =
            node.under === undefined
              ? undefined
              : parseString(node.under, `${path}[${index}].under`, 128);
          return {
            name: parseString(node.name, `${path}[${index}].name`, 128),
            delta: Math.min(
              20,
              Math.max(
                -20,
                parseFiniteNumber(node.delta, `${path}[${index}].delta`),
              ),
            ),
            ...(under ? { under } : {}),
          };
        });
      };
      const doors =
        value.doors === undefined
          ? undefined
          : (Array.isArray(value.doors) ? value.doors : fail(`${path}.doors`, "expected array")).map(
              (door, index) => {
                if (!isRecord(door))
                  fail(`${path}.doors[${index}]`, "expected door object");
                const motion = door.motion;
                if (motion !== "slide" && motion !== "hinge") {
                  fail(`${path}.doors[${index}].motion`, 'expected "slide" or "hinge"');
                }
                const axis = door.axis;
                if (axis !== "x" && axis !== "y" && axis !== "z") {
                  fail(`${path}.doors[${index}].axis`, 'expected "x", "y", or "z"');
                }
                return {
                  id: parseString(door.id, `${path}.doors[${index}].id`, 64),
                  label: parseString(door.label, `${path}.doors[${index}].label`, 64),
                  motion: motion as "slide" | "hinge",
                  axis: axis as "x" | "y" | "z",
                  nodes: parseDoorNodes(door.nodes, `${path}.doors[${index}].nodes`),
                  interactEntityId: parseString(
                    door.interactEntityId,
                    `${path}.doors[${index}].interactEntityId`,
                    128,
                  ),
                  trigger: parseShipDoorTrigger(
                    door.trigger,
                    `${path}.doors[${index}].trigger`,
                  ),
                  radius:
                    door.radius === undefined
                      ? undefined
                      : Math.min(
                          20,
                          Math.max(
                            0.5,
                            parseFiniteNumber(
                              door.radius,
                              `${path}.doors[${index}].radius`,
                            ),
                          ),
                        ),
                  aimRadius:
                    door.aimRadius === undefined
                      ? undefined
                      : Math.min(
                          5,
                          Math.max(
                            0.05,
                            parseFiniteNumber(
                              door.aimRadius,
                              `${path}.doors[${index}].aimRadius`,
                            ),
                          ),
                        ),
                  defaultOpen:
                    door.defaultOpen === undefined
                      ? undefined
                      : Boolean(door.defaultOpen),
                  ...(door.openSoundUrl === undefined
                    ? {}
                    : {
                        openSoundUrl: parseAssetUrl(
                          door.openSoundUrl,
                          `${path}.doors[${index}].openSoundUrl`,
                        ),
                      }),
                  ...(door.closeSoundUrl === undefined
                    ? {}
                    : {
                        closeSoundUrl: parseAssetUrl(
                          door.closeSoundUrl,
                          `${path}.doors[${index}].closeSoundUrl`,
                        ),
                      }),
                };
              },
            );
      const seats =
        value.seats === undefined
          ? undefined
          : (Array.isArray(value.seats) ? value.seats : fail(`${path}.seats`, "expected array")).map(
              (seat, index) => {
                if (!isRecord(seat))
                  fail(`${path}.seats[${index}]`, "expected seat object");
                const roleRaw = seat.role;
                const role =
                  roleRaw === undefined
                    ? undefined
                    : SHIP_SEAT_ROLES.includes(roleRaw as ShipSeatRole)
                      ? (roleRaw as ShipSeatRole)
                      : fail(
                          `${path}.seats[${index}].role`,
                          `expected one of: ${SHIP_SEAT_ROLES.join(", ")}`,
                        );
                return {
                  role,
                  entityId: parseString(
                    seat.entityId,
                    `${path}.seats[${index}].entityId`,
                    128,
                  ),
                  eye:
                    seat.eye === undefined
                      ? undefined
                      : parseVec3(seat.eye, `${path}.seats[${index}].eye`),
                  stand:
                    seat.stand === undefined
                      ? undefined
                      : parseVec2(seat.stand, `${path}.seats[${index}].stand`),
                  interactRadius:
                    seat.interactRadius === undefined
                      ? undefined
                      : Math.min(
                          10,
                          Math.max(
                            0.5,
                            parseFiniteNumber(
                              seat.interactRadius,
                              `${path}.seats[${index}].interactRadius`,
                            ),
                          ),
                        ),
                };
              },
            );
      const cameraBounds =
        value.cameraBounds === undefined
          ? undefined
          : (Array.isArray(value.cameraBounds)
              ? value.cameraBounds
              : fail(`${path}.cameraBounds`, "expected array")
            ).map((bound, index) => {
              if (!isRecord(bound))
                fail(`${path}.cameraBounds[${index}]`, "expected bounds object");
              return {
                id:
                  bound.id === undefined
                    ? undefined
                    : parseString(bound.id, `${path}.cameraBounds[${index}].id`, 64),
                min: parseVec2(bound.min, `${path}.cameraBounds[${index}].min`),
                max: parseVec2(bound.max, `${path}.cameraBounds[${index}].max`),
                floorUp: Math.min(
                  20,
                  Math.max(
                    -20,
                    parseFiniteNumber(
                      bound.floorUp,
                      `${path}.cameraBounds[${index}].floorUp`,
                    ),
                  ),
                ),
                slopeMinUp:
                  bound.slopeMinUp === undefined
                    ? undefined
                    : Math.min(
                        20,
                        Math.max(
                          -20,
                          parseFiniteNumber(
                            bound.slopeMinUp,
                            `${path}.cameraBounds[${index}].slopeMinUp`,
                          ),
                        ),
                      ),
                ceilingUp: Math.min(
                  20,
                  Math.max(
                    -20,
                    parseFiniteNumber(
                      bound.ceilingUp,
                      `${path}.cameraBounds[${index}].ceilingUp`,
                    ),
                  ),
                ),
                openToOutside:
                  bound.openToOutside === undefined
                    ? undefined
                    : Boolean(bound.openToOutside),
              };
            });
      let ramp:
        | {
            hinge: {
              node: string;
              lowerRadians: number;
              axis?: "x" | "y" | "z";
            };
            outsideInteractId?: string;
            outsideRadius?: number;
            deckInteractId?: string;
            deckRadius?: number;
            openSoundUrl?: string;
            closeSoundUrl?: string;
          }
        | undefined;
      if (value.ramp !== undefined) {
        if (!isRecord(value.ramp)) fail(`${path}.ramp`, "expected ramp object");
        if (!isRecord(value.ramp.hinge))
          fail(`${path}.ramp.hinge`, "expected hinge object");
        ramp = {
          hinge: {
            node: parseString(value.ramp.hinge.node, `${path}.ramp.hinge.node`, 128),
            lowerRadians: Math.min(
              10,
              Math.max(
                -10,
                parseFiniteNumber(
                  value.ramp.hinge.lowerRadians,
                  `${path}.ramp.hinge.lowerRadians`,
                ),
              ),
            ),
            axis: parseHingeAxis(value.ramp.hinge.axis, `${path}.ramp.hinge.axis`),
          },
          outsideInteractId:
            value.ramp.outsideInteractId === undefined
              ? undefined
              : parseString(
                  value.ramp.outsideInteractId,
                  `${path}.ramp.outsideInteractId`,
                  128,
                ),
          outsideRadius:
            value.ramp.outsideRadius === undefined
              ? undefined
              : Math.min(
                  20,
                  Math.max(
                    0.5,
                    parseFiniteNumber(
                      value.ramp.outsideRadius,
                      `${path}.ramp.outsideRadius`,
                    ),
                  ),
                ),
          deckInteractId:
            value.ramp.deckInteractId === undefined
              ? undefined
              : parseString(
                  value.ramp.deckInteractId,
                  `${path}.ramp.deckInteractId`,
                  128,
                ),
          deckRadius:
            value.ramp.deckRadius === undefined
              ? undefined
              : Math.min(
                  20,
                  Math.max(
                    0.5,
                    parseFiniteNumber(
                      value.ramp.deckRadius,
                      `${path}.ramp.deckRadius`,
                    ),
                  ),
                ),
          ...(value.ramp.openSoundUrl === undefined
            ? {}
            : {
                openSoundUrl: parseAssetUrl(
                  value.ramp.openSoundUrl,
                  `${path}.ramp.openSoundUrl`,
                ),
              }),
          ...(value.ramp.closeSoundUrl === undefined
            ? {}
            : {
                closeSoundUrl: parseAssetUrl(
                  value.ramp.closeSoundUrl,
                  `${path}.ramp.closeSoundUrl`,
                ),
              }),
        };
      }
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
        stats:
          value.stats === undefined || !isRecord(value.stats)
            ? undefined
            : {
                maxSpeedMps:
                  value.stats.maxSpeedMps === undefined
                    ? undefined
                    : Math.min(
                        500,
                        Math.max(
                          5,
                          parseFiniteNumber(
                            value.stats.maxSpeedMps,
                            `${path}.stats.maxSpeedMps`,
                          ),
                        ),
                      ),
                maxHp:
                  value.stats.maxHp === undefined
                    ? undefined
                    : Math.min(
                        100_000,
                        Math.max(
                          1,
                          parseFiniteNumber(
                            value.stats.maxHp,
                            `${path}.stats.maxHp`,
                          ),
                        ),
                      ),
                maxShields:
                  value.stats.maxShields === undefined
                    ? undefined
                    : Math.min(
                        100_000,
                        Math.max(
                          0,
                          parseFiniteNumber(
                            value.stats.maxShields,
                            `${path}.stats.maxShields`,
                          ),
                        ),
                      ),
                shieldRegenPerSec:
                  value.stats.shieldRegenPerSec === undefined
                    ? undefined
                    : Math.min(
                        10_000,
                        Math.max(
                          0,
                          parseFiniteNumber(
                            value.stats.shieldRegenPerSec,
                            `${path}.stats.shieldRegenPerSec`,
                          ),
                        ),
                      ),
                massKg:
                  value.stats.massKg === undefined
                    ? undefined
                    : Math.min(
                        50_000_000,
                        Math.max(
                          100,
                          parseFiniteNumber(
                            value.stats.massKg,
                            `${path}.stats.massKg`,
                          ),
                        ),
                      ),
                maxAngularRateRadps:
                  value.stats.maxAngularRateRadps === undefined
                    ? undefined
                    : Math.min(
                        10,
                        Math.max(
                          0.05,
                          parseFiniteNumber(
                            value.stats.maxAngularRateRadps,
                            `${path}.stats.maxAngularRateRadps`,
                          ),
                        ),
                      ),
                forwardThrustN:
                  value.stats.forwardThrustN === undefined
                    ? undefined
                    : Math.min(
                        1e12,
                        Math.max(
                          1,
                          parseFiniteNumber(
                            value.stats.forwardThrustN,
                            `${path}.stats.forwardThrustN`,
                          ),
                        ),
                      ),
                backwardThrustN:
                  value.stats.backwardThrustN === undefined
                    ? undefined
                    : Math.min(
                        1e12,
                        Math.max(
                          1,
                          parseFiniteNumber(
                            value.stats.backwardThrustN,
                            `${path}.stats.backwardThrustN`,
                          ),
                        ),
                      ),
                verticalThrustN:
                  value.stats.verticalThrustN === undefined
                    ? undefined
                    : Math.min(
                        1e12,
                        Math.max(
                          1,
                          parseFiniteNumber(
                            value.stats.verticalThrustN,
                            `${path}.stats.verticalThrustN`,
                          ),
                        ),
                      ),
                lateralThrustN:
                  value.stats.lateralThrustN === undefined
                    ? undefined
                    : Math.min(
                        1e12,
                        Math.max(
                          1,
                          parseFiniteNumber(
                            value.stats.lateralThrustN,
                            `${path}.stats.lateralThrustN`,
                          ),
                        ),
                      ),
                pitchTorqueNm:
                  value.stats.pitchTorqueNm === undefined
                    ? undefined
                    : Math.min(
                        1e12,
                        Math.max(
                          1,
                          parseFiniteNumber(
                            value.stats.pitchTorqueNm,
                            `${path}.stats.pitchTorqueNm`,
                          ),
                        ),
                      ),
                yawTorqueNm:
                  value.stats.yawTorqueNm === undefined
                    ? undefined
                    : Math.min(
                        1e12,
                        Math.max(
                          1,
                          parseFiniteNumber(
                            value.stats.yawTorqueNm,
                            `${path}.stats.yawTorqueNm`,
                          ),
                        ),
                      ),
                rollTorqueNm:
                  value.stats.rollTorqueNm === undefined
                    ? undefined
                    : Math.min(
                        1e12,
                        Math.max(
                          1,
                          parseFiniteNumber(
                            value.stats.rollTorqueNm,
                            `${path}.stats.rollTorqueNm`,
                          ),
                        ),
                      ),
                thrustFovForwardDeg:
                  value.stats.thrustFovForwardDeg === undefined
                    ? undefined
                    : Math.min(
                        30,
                        Math.max(
                          0,
                          parseFiniteNumber(
                            value.stats.thrustFovForwardDeg,
                            `${path}.stats.thrustFovForwardDeg`,
                          ),
                        ),
                      ),
                thrustFovBackwardDeg:
                  value.stats.thrustFovBackwardDeg === undefined
                    ? undefined
                    : Math.min(
                        30,
                        Math.max(
                          0,
                          parseFiniteNumber(
                            value.stats.thrustFovBackwardDeg,
                            `${path}.stats.thrustFovBackwardDeg`,
                          ),
                        ),
                      ),
                thrustFovBlendPerSec:
                  value.stats.thrustFovBlendPerSec === undefined
                    ? undefined
                    : Math.min(
                        40,
                        Math.max(
                          0.5,
                          parseFiniteNumber(
                            value.stats.thrustFovBlendPerSec,
                            `${path}.stats.thrustFovBlendPerSec`,
                          ),
                        ),
                      ),
                boostShakeAmplitudeM:
                  value.stats.boostShakeAmplitudeM === undefined
                    ? undefined
                    : Math.min(
                        0.2,
                        Math.max(
                          0,
                          parseFiniteNumber(
                            value.stats.boostShakeAmplitudeM,
                            `${path}.stats.boostShakeAmplitudeM`,
                          ),
                        ),
                      ),
                boostShakeHz:
                  value.stats.boostShakeHz === undefined
                    ? undefined
                    : Math.min(
                        60,
                        Math.max(
                          1,
                          parseFiniteNumber(
                            value.stats.boostShakeHz,
                            `${path}.stats.boostShakeHz`,
                          ),
                        ),
                      ),
                boostBlendPerSec:
                  value.stats.boostBlendPerSec === undefined
                    ? undefined
                    : Math.min(
                        40,
                        Math.max(
                          0.5,
                          parseFiniteNumber(
                            value.stats.boostBlendPerSec,
                            `${path}.stats.boostBlendPerSec`,
                          ),
                        ),
                      ),
                ...(value.stats.boostSoundUrl === undefined
                  ? {}
                  : {
                      boostSoundUrl: parseAssetUrl(
                        value.stats.boostSoundUrl,
                        `${path}.stats.boostSoundUrl`,
                      ),
                    }),
                boostSoundVolume:
                  value.stats.boostSoundVolume === undefined
                    ? undefined
                    : Math.min(
                        1,
                        Math.max(
                          0,
                          parseFiniteNumber(
                            value.stats.boostSoundVolume,
                            `${path}.stats.boostSoundVolume`,
                          ),
                        ),
                      ),
                ...(value.stats.thrustSoundUrl === undefined
                  ? {}
                  : {
                      thrustSoundUrl: parseAssetUrl(
                        value.stats.thrustSoundUrl,
                        `${path}.stats.thrustSoundUrl`,
                      ),
                    }),
                thrustSoundVolume:
                  value.stats.thrustSoundVolume === undefined
                    ? undefined
                    : Math.min(
                        1,
                        Math.max(
                          0,
                          parseFiniteNumber(
                            value.stats.thrustSoundVolume,
                            `${path}.stats.thrustSoundVolume`,
                          ),
                        ),
                      ),
              },
        gear:
          value.gear === undefined || !isRecord(value.gear)
            ? undefined
            : {
                nodes: parseGearNodes(value.gear.nodes, `${path}.gear.nodes`),
                ...(value.gear.deploySoundUrl === undefined
                  ? {}
                  : {
                      deploySoundUrl: parseAssetUrl(
                        value.gear.deploySoundUrl,
                        `${path}.gear.deploySoundUrl`,
                      ),
                    }),
                ...(value.gear.retractSoundUrl === undefined
                  ? {}
                  : {
                      retractSoundUrl: parseAssetUrl(
                        value.gear.retractSoundUrl,
                        `${path}.gear.retractSoundUrl`,
                      ),
                    }),
              },
        ramp,
        doors,
        seats,
        deckSpawnEntityId:
          value.deckSpawnEntityId === undefined
            ? undefined
            : parseString(value.deckSpawnEntityId, `${path}.deckSpawnEntityId`, 128),
        cameraBounds,
      };
    }
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
      if (value.nodes.length > 16)
        fail(`${path}.nodes`, "too many gear nodes (max 16)");
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
          const under =
            node.under === undefined
              ? undefined
              : parseString(node.under, `${path}.nodes[${index}].under`, 128);
          return {
            name: parseString(node.name, `${path}.nodes[${index}].name`, 128),
            ...(under ? { under } : {}),
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
          const under =
            node.under === undefined
              ? undefined
              : parseString(node.under, `${path}.nodes[${index}].under`, 128);
          return {
            name: parseString(node.name, `${path}.nodes[${index}].name`, 128),
            delta: Math.min(
              20,
              Math.max(
                -20,
                parseFiniteNumber(node.delta, `${path}.nodes[${index}].delta`),
              ),
            ),
            ...(under ? { under } : {}),
          };
        }),
        trigger: parseShipDoorTrigger(value.trigger, `${path}.trigger`),
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
        aimRadius:
          value.aimRadius === undefined
            ? undefined
            : Math.min(
                5,
                Math.max(
                  0.05,
                  parseFiniteNumber(value.aimRadius, `${path}.aimRadius`),
                ),
              ),
        defaultOpen:
          value.defaultOpen === undefined
            ? undefined
            : Boolean(value.defaultOpen),
        ...(value.openSoundUrl === undefined
          ? {}
          : {
              openSoundUrl: parseAssetUrl(
                value.openSoundUrl,
                `${path}.openSoundUrl`,
              ),
            }),
        ...(value.closeSoundUrl === undefined
          ? {}
          : {
              closeSoundUrl: parseAssetUrl(
                value.closeSoundUrl,
                `${path}.closeSoundUrl`,
              ),
            }),
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
    case "bed": {
      return {
        type,
        id: parseString(value.id, `${path}.id`, 64),
        label:
          value.label === undefined
            ? undefined
            : parseString(value.label, `${path}.label`, 64),
        trigger: parseShipDoorTrigger(value.trigger, `${path}.trigger`),
        radius:
          value.radius === undefined
            ? undefined
            : Math.min(
                10,
                Math.max(0.5, parseFiniteNumber(value.radius, `${path}.radius`)),
              ),
        aimRadius:
          value.aimRadius === undefined
            ? undefined
            : Math.min(
                5,
                Math.max(
                  0.05,
                  parseFiniteNumber(value.aimRadius, `${path}.aimRadius`),
                ),
              ),
        eye:
          value.eye === undefined
            ? undefined
            : parseVec3(value.eye, `${path}.eye`),
        stand:
          value.stand === undefined
            ? undefined
            : parseVec2(value.stand, `${path}.stand`),
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
    case "cockpit-control": {
      const actionRaw = value.action;
      if (
        actionRaw !== "landing-gear" &&
        actionRaw !== "cargo-ramp"
      ) {
        fail(
          `${path}.action`,
          `expected one of: ${COCKPIT_CONTROL_ACTIONS.join(", ")}`,
        );
      }
      return {
        type,
        id: parseString(value.id, `${path}.id`, 64),
        action: actionRaw,
        label:
          value.label === undefined
            ? undefined
            : parseString(value.label, `${path}.label`, 64),
        gazeRadius:
          value.gazeRadius === undefined
            ? undefined
            : Math.min(
                2,
                Math.max(
                  0.05,
                  parseFiniteNumber(value.gazeRadius, `${path}.gazeRadius`),
                ),
              ),
        maxDistance:
          value.maxDistance === undefined
            ? undefined
            : Math.min(
                10,
                Math.max(
                  0.5,
                  parseFiniteNumber(value.maxDistance, `${path}.maxDistance`),
                ),
              ),
      };
    }
    case "cockpit-stat": {
      const kindRaw = value.kind;
      if (kindRaw !== "speed") {
        fail(
          `${path}.kind`,
          `expected one of: ${COCKPIT_STAT_KINDS.join(", ")}`,
        );
      }
      return {
        type,
        id: parseString(value.id, `${path}.id`, 64),
        kind: kindRaw,
        label:
          value.label === undefined
            ? undefined
            : parseString(value.label, `${path}.label`, 64),
        maxDistance:
          value.maxDistance === undefined
            ? undefined
            : Math.min(
                10,
                Math.max(
                  0.5,
                  parseFiniteNumber(value.maxDistance, `${path}.maxDistance`),
                ),
              ),
      };
    }
    case "entertainment-system": {
      return {
        type,
        id: parseString(value.id, `${path}.id`, 64),
        label:
          value.label === undefined
            ? undefined
            : parseString(value.label, `${path}.label`, 64),
        gazeRadius:
          value.gazeRadius === undefined
            ? undefined
            : Math.min(
                2,
                Math.max(
                  0.05,
                  parseFiniteNumber(value.gazeRadius, `${path}.gazeRadius`),
                ),
              ),
        maxDistance:
          value.maxDistance === undefined
            ? undefined
            : Math.min(
                10,
                Math.max(
                  0.5,
                  parseFiniteNumber(value.maxDistance, `${path}.maxDistance`),
                ),
              ),
        screenWidth:
          value.screenWidth === undefined
            ? undefined
            : Math.min(
                2,
                Math.max(
                  0.2,
                  parseFiniteNumber(value.screenWidth, `${path}.screenWidth`),
                ),
              ),
        screenHeight:
          value.screenHeight === undefined
            ? undefined
            : Math.min(
                1.5,
                Math.max(
                  0.15,
                  parseFiniteNumber(value.screenHeight, `${path}.screenHeight`),
                ),
              ),
      };
    }
    default:
      // Unknown component types are dropped for forward compatibility.
      console.warn(
        `Prefab component of unknown type "${String(type)}" at ${path} was ignored.`,
      );
      return null;
  }
}

function parseShipDoorTrigger(
  value: unknown,
  path: string,
): "radial" | "raycast" | undefined {
  if (value === undefined) return undefined;
  if (value === "radial" || value === "raycast") return value;
  fail(path, 'expected "radial" or "raycast"');
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
      ...(value.asset.node !== undefined
        ? { node: parseString(value.asset.node, `${path}.asset.node`, 128) }
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
