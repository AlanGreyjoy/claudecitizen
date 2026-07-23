import type { Vec3 } from "../../types";
import type { WeaponSlotType } from "../../types/equipment";
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
  | {
      /** Flash origin/orientation. Entity local +Z points down the bore. */
      type: "muzzle-flash";
    }
  | {
      /** Ballistic ray origin. Entity local +Z points down the bore. */
      type: "barrel-end";
    }
  | {
      /** Prefab-owned presentation assets; combat balance lives in the catalog. */
      type: "weapon-combat";
      fireSoundUrl: string | null;
      dryFireSoundUrl: string | null;
      reloadSoundUrl: string | null;
      hitDecalUrl: string | null;
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
  /**
   * Station food vendor screen (gaze + F while on foot). Sells consumable
   * items with subType "food". Empty marker is the gaze / screen anchor.
   */
  | {
      type: "food-shop";
      id: string;
      /** Prompt when gazing (default "Browse food"). */
      label?: string;
      gazeRadius?: number;
      maxDistance?: number;
      screenWidth?: number;
      screenHeight?: number;
      /** Optional filter of catalog food item ids. Empty = all food consumables. */
      itemDefinitionIds?: string[];
    }
  /**
   * Station drinks vendor screen (gaze + F while on foot). Sells consumable
   * items with subType "drink". Empty marker is the gaze / screen anchor.
   */
  | {
      type: "drinks-shop";
      id: string;
      /** Prompt when gazing (default "Browse drinks"). */
      label?: string;
      gazeRadius?: number;
      maxDistance?: number;
      screenWidth?: number;
      screenHeight?: number;
      /** Optional filter of catalog drink item ids. Empty = all drink consumables. */
      itemDefinitionIds?: string[];
    }
  /**
   * Station canteen vendor screen (gaze + F while on foot). Sells both food
   * and drink consumables. Empty marker is the gaze / screen anchor.
   */
  | {
      type: "canteen";
      id: string;
      /** Prompt when gazing (default "Browse food & drinks"). */
      label?: string;
      gazeRadius?: number;
      maxDistance?: number;
      screenWidth?: number;
      screenHeight?: number;
      /** Optional filter of catalog consumable ids. Empty = all food and drinks. */
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


export { createDefaultParticleSystemComponent } from "./schema_parse_common";
import {
  COMPONENT_PARSER_BY_TYPE,
  parseUnknownComponent,
} from "./schema_component_parsers";
import {
  fail,
  isRecord,
  parseAssetUrl,
  parseMaterialOverride,
  parseString,
  parseTransform,
  parseVec3,
} from "./schema_parse_common";

function parseComponent(value: unknown, path: string): PrefabComponent | null {
  if (!isRecord(value)) fail(path, "expected component object");
  const type = value.type;
  if (typeof type !== "string") {
    return parseUnknownComponent(type, path);
  }
  const parser = COMPONENT_PARSER_BY_TYPE[type];
  if (!parser) {
    return parseUnknownComponent(type, path);
  }
  return parser(value, path);
}

function parseEntityAsset(
  value: Record<string, unknown>,
  path: string,
): PrefabEntity["asset"] {
  if (!isRecord(value.asset)) fail(`${path}.asset`, "expected asset object");
  return {
    url: parseAssetUrl(value.asset.url, `${path}.asset.url`),
    ...(value.asset.castShadow !== undefined
      ? { castShadow: Boolean(value.asset.castShadow) }
      : {}),
    ...(value.asset.node !== undefined
      ? { node: parseString(value.asset.node, `${path}.asset.node`, 128) }
      : {}),
  };
}

function parseEntityPrimitive(
  value: Record<string, unknown>,
  path: string,
): PrefabEntity["primitive"] {
  if (!isRecord(value.primitive))
    fail(`${path}.primitive`, "expected primitive object");
  if (value.primitive.shape !== "box")
    fail(`${path}.primitive.shape`, 'expected "box"');
  const color = value.primitive.color;
  return {
    shape: "box",
    size: parseVec3(value.primitive.size, `${path}.primitive.size`),
    ...(typeof color === "string" && /^#[0-9a-fA-F]{6}$/.test(color)
      ? { color }
      : {}),
  };
}

function parseEntityNodeOverride(
  override: unknown,
  path: string,
): PrefabNodeOverride {
  if (!isRecord(override)) fail(path, "expected override object");
  const parsed: PrefabNodeOverride = {
    node: parseString(override.node, `${path}.node`, 128),
  };
  if (override.transform !== undefined) {
    parsed.transform = parseTransform(override.transform, `${path}.transform`);
  }
  if (override.components !== undefined) {
    if (!Array.isArray(override.components))
      fail(`${path}.components`, "expected array");
    const components = override.components
      .map((component, ci) => parseComponent(component, `${path}.components[${ci}]`))
      .filter((component): component is PrefabComponent => component !== null);
    if (components.length > 0) parsed.components = components;
  }
  return parsed;
}

function parseEntityNodeOverrides(
  value: Record<string, unknown>,
  path: string,
): PrefabNodeOverride[] {
  if (!Array.isArray(value.nodeOverrides)) {
    fail(`${path}.nodeOverrides`, "expected array");
  }
  if (value.nodeOverrides.length > 512) {
    fail(`${path}.nodeOverrides`, "too many node overrides");
  }
  return value.nodeOverrides.map((override, index) =>
    parseEntityNodeOverride(override, `${path}.nodeOverrides[${index}]`),
  );
}

function parseEntityStringArray(
  raw: unknown,
  path: string,
  maxItems: number,
  tooManyMessage: string,
): string[] {
  if (!Array.isArray(raw)) fail(path, "expected array");
  if (raw.length > maxItems) fail(path, tooManyMessage);
  return raw.map((node, index) => parseString(node, `${path}[${index}]`, 128));
}

function parseEntityComponents(
  value: Record<string, unknown>,
  path: string,
): PrefabComponent[] {
  if (!Array.isArray(value.components))
    fail(`${path}.components`, "expected array");
  return value.components
    .map((component, index) =>
      parseComponent(component, `${path}.components[${index}]`),
    )
    .filter((component): component is PrefabComponent => component !== null);
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
    entity.asset = parseEntityAsset(value, path);
  }
  if (value.primitive !== undefined) {
    entity.primitive = parseEntityPrimitive(value, path);
  }
  if (value.nodeOverrides !== undefined) {
    entity.nodeOverrides = parseEntityNodeOverrides(value, path);
  }
  if (value.hiddenNodes !== undefined) {
    entity.hiddenNodes = parseEntityStringArray(
      value.hiddenNodes,
      `${path}.hiddenNodes`,
      512,
      "too many hidden nodes",
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
    const components = parseEntityComponents(value, path);
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
