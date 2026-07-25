import {
  mulQuat,
  quatIdentity,
  rotateVec3ByQuat,
  type Quat,
} from "../../math/quat";
import { vec3 } from "../../math/vec3";
import {
  DEFAULT_SHIP_LAYOUT,
  DEFAULT_SHIP_SPEC,
  DEFAULT_STARHOPPER_GEAR_HINGES,
  DEFAULT_STARHOPPER_RAMP_HINGE,
  type ShipCameraBounds,
  type ShipDoorSpec,
  type CockpitControlSpec,
  type CockpitStatSpec,
  type EntertainmentSystemSpec,
  type ShipBedSpec,
  type ShipGearHingeSpec,
  type ShipLayout,
  type ShipRampInteract,
  type ShipSeatSpec,
  type ShipSpec,
} from "../../player/ship_layout";
import type { PrefabComponent, PrefabDocument, PrefabEntity, PrefabNodeOverride } from "./schema";
import type { LocalOffset, Vec3 } from "../../types";
import {
  type ColliderAnimationBinding,
  type GameplayCollider,
  preloadMeshColliders,
  validateMeshColliders,
} from "../../physics/colliders";
import { buildPrefabColliders } from "../../physics/prefab_colliders";
import { buildPrefabSounds } from "./sound_runtime";

/**
 * Derives the ship gameplay layout (doors, seats, ramp anchors, hull url)
 * from a ship prefab's components.
 *
 * Prefab/scene axes map to ship-local gameplay axes as right = -x, up = y,
 * forward = z (matching the render group orientation from
 * updateShipPlacement).
 */

const DEFAULT_DOOR_RADIUS = 1.6;
const DEFAULT_DOOR_AIM_RADIUS = 0.35;
const DEFAULT_RAMP_OUTSIDE_RADIUS = 3.0;
const DEFAULT_RAMP_DECK_RADIUS = 1.7;
const DEFAULT_CHAIR_RADIUS = 1.45;
const DEFAULT_BED_RADIUS = 1.6;
const DEFAULT_BED_AIM_RADIUS = 0.35;
const DEFAULT_COCKPIT_GAZE_RADIUS = 0.2;
const DEFAULT_COCKPIT_MAX_DISTANCE = 2.5;
const DEFAULT_ES_GAZE_RADIUS = 0.35;
const DEFAULT_ES_MAX_DISTANCE = 2;
const DEFAULT_ES_SCREEN_WIDTH = 0.55;
const DEFAULT_ES_SCREEN_HEIGHT = 0.32;
const DEFAULT_COCKPIT_STAT_MAX_DISTANCE = 3.5;

interface CollectedShip {
  hullUrl: string | null;
  hullNodeOverrides: PrefabNodeOverride[] | null;
  restHeight: number | null;
  spec: Partial<ShipSpec>;
  doors: ShipDoorSpec[];
  seats: ShipSeatSpec[];
  beds: ShipBedSpec[];
  cockpitControls: CockpitControlSpec[];
  cockpitStats: CockpitStatSpec[];
  entertainmentSystems: EntertainmentSystemSpec[];
  rampInteracts: ShipRampInteract[];
  cameraBounds: ShipCameraBounds[];
  deckSpawn: { right: number; forward: number } | null;
  testSpawn: LocalOffset | null;
  hasController: boolean;
}

interface EntityWorldTransform {
  position: Vec3;
  rotation: Quat;
  scale: Vec3;
}

function buildEntityTransformMap(
  entity: PrefabEntity,
  parentPosition: Vec3,
  parentRotation: Quat,
  parentScale: Vec3,
  out: Map<string, EntityWorldTransform>,
): void {
  const scaledLocal = vec3(
    entity.transform.position.x * parentScale.x,
    entity.transform.position.y * parentScale.y,
    entity.transform.position.z * parentScale.z,
  );
  const rotated = rotateVec3ByQuat(scaledLocal, parentRotation);
  const position = vec3(
    parentPosition.x + rotated.x,
    parentPosition.y + rotated.y,
    parentPosition.z + rotated.z,
  );
  const rotation = mulQuat(parentRotation, entity.transform.rotation);
  const scale = vec3(
    parentScale.x * entity.transform.scale.x,
    parentScale.y * entity.transform.scale.y,
    parentScale.z * entity.transform.scale.z,
  );
  out.set(entity.id, { position, rotation, scale });
  for (const child of entity.children ?? []) {
    buildEntityTransformMap(child, position, rotation, scale, out);
  }
}

function findEntityByName(
  entity: PrefabEntity,
  name: string,
): PrefabEntity | null {
  if (entity.name.trim().toLowerCase() === name.toLowerCase()) return entity;
  for (const child of entity.children ?? []) {
    const found = findEntityByName(child, name);
    if (found) return found;
  }
  return null;
}

function resolveEntityShipPoint(
  entityId: string,
  transforms: Map<string, EntityWorldTransform>,
): { right: number; up: number; forward: number } | null {
  const transform = transforms.get(entityId);
  if (!transform) return null;
  return sceneToShipPoint(transform.position);
}

function findHullEntityWithController(
  entity: PrefabEntity,
): { entity: PrefabEntity; controller: Extract<PrefabComponent, { type: "ship-controller" }> } | null {
  for (const component of entity.components ?? []) {
    if (component.type === "ship-controller" && entity.asset) {
      return { entity, controller: component };
    }
  }
  for (const child of entity.children ?? []) {
    const found = findHullEntityWithController(child);
    if (found) return found;
  }
  return null;
}

type ShipControllerComponent = Extract<PrefabComponent, { type: "ship-controller" }>;

const CONTROLLER_NUMERIC_STAT_FIELDS = [
  "maxSpeedMps",
  "maxHp",
  "maxShields",
  "shieldRegenPerSec",
  "massKg",
  "maxAngularRateRadps",
  "forwardThrustN",
  "backwardThrustN",
  "verticalThrustN",
  "lateralThrustN",
  "pitchTorqueNm",
  "yawTorqueNm",
  "rollTorqueNm",
  "thrustFovForwardDeg",
  "thrustFovBackwardDeg",
  "thrustFovBlendPerSec",
  "boostShakeAmplitudeM",
  "boostShakeHz",
  "boostBlendPerSec",
  "boostSoundVolume",
  "thrustSoundVolume",
] as const satisfies readonly (keyof NonNullable<ShipControllerComponent["stats"]>)[];

function copyControllerNumericStats(
  stats: NonNullable<ShipControllerComponent["stats"]>,
  spec: Partial<ShipSpec>,
): void {
  for (const field of CONTROLLER_NUMERIC_STAT_FIELDS) {
    const value = stats[field];
    if (value !== undefined) {
      spec[field] = value;
    }
  }
}

function copyControllerSoundStats(
  stats: NonNullable<ShipControllerComponent["stats"]>,
  spec: Partial<ShipSpec>,
): void {
  if (stats.boostSoundUrl) spec.boostSoundUrl = stats.boostSoundUrl;
  if (stats.thrustSoundUrl) spec.thrustSoundUrl = stats.thrustSoundUrl;
}

function bakeControllerHull(
  hull: PrefabEntity,
  controller: ShipControllerComponent,
  out: CollectedShip,
): void {
  out.hasController = true;
  out.hullUrl = hull.asset?.url ?? null;
  out.hullNodeOverrides = hull.nodeOverrides ? [...hull.nodeOverrides] : null;
  if (controller.restHeight !== undefined) out.restHeight = controller.restHeight;
  if (!controller.stats) return;
  copyControllerNumericStats(controller.stats, out.spec);
  copyControllerSoundStats(controller.stats, out.spec);
}

function mapGearHingeNode(
  node: NonNullable<NonNullable<ShipControllerComponent["gear"]>["nodes"]>[number],
): ShipGearHingeSpec {
  return {
    name: node.name,
    ...(node.under ? { under: node.under } : {}),
    deployRadians: node.deployRadians,
    ...(node.axis ? { axis: node.axis } : {}),
  };
}

function bakeControllerGear(controller: ShipControllerComponent, out: CollectedShip): void {
  if (controller.gear?.nodes?.length) {
    out.spec.gearHinges = controller.gear.nodes.map(mapGearHingeNode);
  }
  if (controller.gear?.deploySoundUrl) {
    out.spec.gearDeploySoundUrl = controller.gear.deploySoundUrl;
  }
  if (controller.gear?.retractSoundUrl) {
    out.spec.gearRetractSoundUrl = controller.gear.retractSoundUrl;
  }
}

function pushControllerRampInteract(
  interactId: string,
  placement: ShipRampInteract["placement"],
  radius: number,
  transforms: Map<string, EntityWorldTransform>,
  out: CollectedShip,
  missingLabel: string,
): void {
  const point = resolveEntityShipPoint(interactId, transforms);
  if (!point) {
    console.warn(missingLabel);
    return;
  }
  out.rampInteracts.push({
    placement,
    right: point.right,
    forward: point.forward,
    radius,
  });
}

function bakeControllerRamp(
  controller: ShipControllerComponent,
  transforms: Map<string, EntityWorldTransform>,
  out: CollectedShip,
): void {
  const ramp = controller.ramp;
  if (!ramp?.hinge) return;
  out.spec.rampHinge = {
    name: ramp.hinge.node,
    lowerRadians: ramp.hinge.lowerRadians,
    ...(ramp.hinge.axis ? { axis: ramp.hinge.axis } : {}),
  };
  if (ramp.openSoundUrl) out.spec.rampOpenSoundUrl = ramp.openSoundUrl;
  if (ramp.closeSoundUrl) out.spec.rampCloseSoundUrl = ramp.closeSoundUrl;
  if (ramp.outsideInteractId) {
    pushControllerRampInteract(
      ramp.outsideInteractId,
      "outside",
      ramp.outsideRadius ?? DEFAULT_RAMP_OUTSIDE_RADIUS,
      transforms,
      out,
      `Ship controller ramp.outsideInteractId "${ramp.outsideInteractId}" not found.`,
    );
  }
  if (ramp.deckInteractId) {
    pushControllerRampInteract(
      ramp.deckInteractId,
      "deck",
      ramp.deckRadius ?? DEFAULT_RAMP_DECK_RADIUS,
      transforms,
      out,
      `Ship controller ramp.deckInteractId "${ramp.deckInteractId}" not found.`,
    );
  }
}

function bakeControllerDoor(
  door: NonNullable<ShipControllerComponent["doors"]>[number],
  transforms: Map<string, EntityWorldTransform>,
  out: CollectedShip,
): void {
  const interact = resolveEntityShipPoint(door.interactEntityId, transforms);
  if (!interact) {
    console.warn(
      `Ship controller door "${door.id}" interactEntityId "${door.interactEntityId}" not found.`,
    );
    return;
  }
  upsertShipDoor(out, {
    id: door.id,
    label: door.label,
    motion: door.motion,
    axis: door.axis,
    nodes: door.nodes.map((node) => ({ ...node })),
    interact: {
      right: interact.right,
      up: interact.up,
      forward: interact.forward,
    },
    trigger: door.trigger ?? "radial",
    radius: door.radius ?? DEFAULT_DOOR_RADIUS,
    aimRadius: door.aimRadius ?? DEFAULT_DOOR_AIM_RADIUS,
    defaultOpen: door.defaultOpen ?? false,
    ...(door.openSoundUrl ? { openSoundUrl: door.openSoundUrl } : {}),
    ...(door.closeSoundUrl ? { closeSoundUrl: door.closeSoundUrl } : {}),
  });
}

function bakeControllerSeat(
  seat: NonNullable<ShipControllerComponent["seats"]>[number],
  transforms: Map<string, EntityWorldTransform>,
  out: CollectedShip,
): void {
  const point = resolveEntityShipPoint(seat.entityId, transforms);
  if (!point) {
    console.warn(`Ship controller seat entityId "${seat.entityId}" not found.`);
    return;
  }
  const eye = seat.eye ?? { x: 0, y: 0.87, z: 0.25 };
  const stand = seat.stand ?? { x: 0, z: -1.55 };
  const transform = transforms.get(seat.entityId);
  const position = transform?.position ?? vec3(0, 0, 0);
  out.seats.push({
    id: seat.entityId,
    role: seat.role ?? "passenger",
    seat: { right: point.right, up: point.up, forward: point.forward },
    eye: {
      right: -(position.x + eye.x),
      up: position.y + eye.y,
      forward: position.z + eye.z,
    },
    stand: {
      right: -(position.x + stand.x),
      forward: position.z + stand.z,
    },
    interactRadius: seat.interactRadius ?? DEFAULT_CHAIR_RADIUS,
  });
}

function bakeControllerCameraBounds(
  controller: ShipControllerComponent,
  out: CollectedShip,
): void {
  for (const bound of controller.cameraBounds ?? []) {
    out.cameraBounds.push({
      id: bound.id ?? "camera",
      minRight: -bound.max.x,
      maxRight: -bound.min.x,
      minForward: bound.min.z,
      maxForward: bound.max.z,
      floorUp: bound.floorUp,
      ...(bound.slopeMinUp !== undefined ? { slopeMinUp: bound.slopeMinUp } : {}),
      ceilingUp: bound.ceilingUp,
      ...(bound.openToOutside ? { openToOutside: true } : {}),
    });
  }
}

function bakeFromShipController(
  hull: PrefabEntity,
  controller: ShipControllerComponent,
  transforms: Map<string, EntityWorldTransform>,
  out: CollectedShip,
): void {
  bakeControllerHull(hull, controller, out);
  bakeControllerGear(controller, out);
  bakeControllerRamp(controller, transforms, out);
  for (const door of controller.doors ?? []) {
    bakeControllerDoor(door, transforms, out);
  }
  for (const seat of controller.seats ?? []) {
    bakeControllerSeat(seat, transforms, out);
  }
  if (controller.deckSpawnEntityId) {
    const point = resolveEntityShipPoint(controller.deckSpawnEntityId, transforms);
    if (point) {
      out.deckSpawn = { right: point.right, forward: point.forward };
    }
  }
  bakeControllerCameraBounds(controller, out);
}

function resolveShipThrustDefaults(partial: Partial<ShipSpec>): {
  massKg: number;
  forwardThrustN: number;
  throttleAccelMps2: number;
} {
  const massKg = partial.massKg ?? DEFAULT_SHIP_SPEC.massKg;
  const forwardThrustN =
    partial.forwardThrustN ??
    (partial.throttleAccelMps2 !== undefined
      ? partial.throttleAccelMps2 * massKg
      : DEFAULT_SHIP_SPEC.forwardThrustN);
  const throttleAccelMps2 =
    partial.throttleAccelMps2 ?? forwardThrustN / Math.max(massKg, 1);
  return { massKg, forwardThrustN, throttleAccelMps2 };
}

const CORE_SPEC_OVERRIDE_KEYS = [
  "maxSpeedMps",
  "maxAngularRateRadps",
  "backwardThrustN",
  "verticalThrustN",
  "lateralThrustN",
  "pitchTorqueNm",
  "yawTorqueNm",
  "rollTorqueNm",
  "thrustFovForwardDeg",
  "thrustFovBackwardDeg",
  "thrustFovBlendPerSec",
  "boostShakeAmplitudeM",
  "boostShakeHz",
  "boostBlendPerSec",
  "boostSoundVolume",
  "thrustSoundVolume",
  "maxHp",
  "maxShields",
  "shieldRegenPerSec",
] as const satisfies readonly (keyof ShipSpec)[];

function buildCoreShipSpec(
  partial: Partial<ShipSpec>,
  thrust: ReturnType<typeof resolveShipThrustDefaults>,
): ShipSpec {
  const spec: ShipSpec = {
    ...DEFAULT_SHIP_SPEC,
    ...thrust,
    gearHinges:
      partial.gearHinges && partial.gearHinges.length > 0
        ? partial.gearHinges
        : DEFAULT_STARHOPPER_GEAR_HINGES,
    rampHinge: partial.rampHinge ?? DEFAULT_STARHOPPER_RAMP_HINGE,
  };
  for (const key of CORE_SPEC_OVERRIDE_KEYS) {
    const value = partial[key];
    if (value !== undefined) {
      spec[key] = value;
    }
  }
  return spec;
}

function appendOptionalShipSounds(
  partial: Partial<ShipSpec>,
  spec: ShipSpec,
): ShipSpec {
  return {
    ...spec,
    ...(partial.gearDeploySoundUrl
      ? { gearDeploySoundUrl: partial.gearDeploySoundUrl }
      : {}),
    ...(partial.gearRetractSoundUrl
      ? { gearRetractSoundUrl: partial.gearRetractSoundUrl }
      : {}),
    ...(partial.rampOpenSoundUrl
      ? { rampOpenSoundUrl: partial.rampOpenSoundUrl }
      : {}),
    ...(partial.rampCloseSoundUrl
      ? { rampCloseSoundUrl: partial.rampCloseSoundUrl }
      : {}),
    ...(partial.boostSoundUrl ? { boostSoundUrl: partial.boostSoundUrl } : {}),
    ...(partial.thrustSoundUrl ? { thrustSoundUrl: partial.thrustSoundUrl } : {}),
  };
}

function mergeShipSpec(partial: Partial<ShipSpec>): ShipSpec {
  const thrust = resolveShipThrustDefaults(partial);
  return appendOptionalShipSounds(partial, buildCoreShipSpec(partial, thrust));
}

interface CollectEntityContext {
  entity: PrefabEntity;
  position: Vec3;
  right: number;
  forward: number;
}

function collectShipStatsComponent(
  component: Extract<PrefabComponent, { type: "ship-stats" }>,
  out: CollectedShip,
): void {
  if (component.maxSpeedMps !== undefined) out.spec.maxSpeedMps ??= component.maxSpeedMps;
  if (component.maxHp !== undefined) out.spec.maxHp ??= component.maxHp;
  if (component.maxShields !== undefined) out.spec.maxShields ??= component.maxShields;
  if (component.shieldRegenPerSec !== undefined) {
    out.spec.shieldRegenPerSec ??= component.shieldRegenPerSec;
  }
}

function collectShipGearComponent(
  component: Extract<PrefabComponent, { type: "ship-gear" }>,
  out: CollectedShip,
): void {
  out.spec.gearHinges = component.nodes.map(
    (node): ShipGearHingeSpec => ({
      name: node.name,
      ...(node.under ? { under: node.under } : {}),
      deployRadians: node.deployRadians,
      ...(node.axis ? { axis: node.axis } : {}),
    }),
  );
}

function collectShipRampComponent(
  component: Extract<PrefabComponent, { type: "ship-ramp" }>,
  out: CollectedShip,
): void {
  out.spec.rampHinge = {
    name: component.node,
    lowerRadians: component.lowerRadians,
    ...(component.axis ? { axis: component.axis } : {}),
  };
}

function collectShipHullComponent(
  component: Extract<PrefabComponent, { type: "ship-hull" }>,
  entity: PrefabEntity,
  out: CollectedShip,
): void {
  if (entity.asset) out.hullUrl ??= entity.asset.url;
  if (component.restHeight !== undefined) out.restHeight ??= component.restHeight;
}

function collectShipDoorComponent(
  component: Extract<PrefabComponent, { type: "ship-door" }>,
  ctx: CollectEntityContext,
  out: CollectedShip,
): void {
  upsertShipDoor(out, {
    id: component.id,
    label: component.label,
    motion: component.motion,
    axis: component.axis,
    nodes: component.nodes.map((node) => ({ ...node })),
    interact: { right: ctx.right, up: ctx.position.y, forward: ctx.forward },
    trigger: component.trigger ?? "radial",
    radius: component.radius ?? DEFAULT_DOOR_RADIUS,
    aimRadius: component.aimRadius ?? DEFAULT_DOOR_AIM_RADIUS,
    defaultOpen: component.defaultOpen ?? false,
    ...(component.openSoundUrl ? { openSoundUrl: component.openSoundUrl } : {}),
    ...(component.closeSoundUrl ? { closeSoundUrl: component.closeSoundUrl } : {}),
  });
}

function collectPilotSeatComponent(
  component: Extract<PrefabComponent, { type: "pilot-seat" }>,
  ctx: CollectEntityContext,
  out: CollectedShip,
): void {
  const eye = component.eye ?? { x: 0, y: 0.87, z: 0.25 };
  const stand = component.stand ?? { x: 0, z: -1.55 };
  const { position, right, forward, entity } = ctx;
  out.seats.push({
    id: entity.id,
    role: component.role ?? "passenger",
    seat: { right, up: position.y, forward },
    eye: {
      right: -(position.x + eye.x),
      up: position.y + eye.y,
      forward: position.z + eye.z,
    },
    stand: {
      right: -(position.x + stand.x),
      forward: position.z + stand.z,
    },
    interactRadius: component.interactRadius ?? DEFAULT_CHAIR_RADIUS,
  });
}

function collectRampInteractComponent(
  component: Extract<PrefabComponent, { type: "ramp-interact" }>,
  ctx: CollectEntityContext,
  out: CollectedShip,
): void {
  out.rampInteracts.push({
    placement: component.placement,
    right: ctx.right,
    forward: ctx.forward,
    radius:
      component.radius ??
      (component.placement === "outside"
        ? DEFAULT_RAMP_OUTSIDE_RADIUS
        : DEFAULT_RAMP_DECK_RADIUS),
  });
}

function collectCockpitControlComponent(
  component: Extract<PrefabComponent, { type: "cockpit-control" }>,
  ctx: CollectEntityContext,
  out: CollectedShip,
): void {
  const point = sceneToShipPoint(ctx.position);
  out.cockpitControls.push({
    id: component.id || ctx.entity.id,
    action: component.action,
    ...(component.label ? { label: component.label } : {}),
    position: {
      right: point.right,
      up: point.up,
      forward: point.forward,
    },
    gazeRadius: component.gazeRadius ?? DEFAULT_COCKPIT_GAZE_RADIUS,
    maxDistance: component.maxDistance ?? DEFAULT_COCKPIT_MAX_DISTANCE,
  });
}

function collectCockpitStatComponent(
  component: Extract<PrefabComponent, { type: "cockpit-stat" }>,
  ctx: CollectEntityContext,
  out: CollectedShip,
): void {
  const point = sceneToShipPoint(ctx.position);
  out.cockpitStats.push({
    id: component.id || ctx.entity.id,
    kind: component.kind,
    ...(component.label ? { label: component.label } : {}),
    position: {
      right: point.right,
      up: point.up,
      forward: point.forward,
    },
    maxDistance: component.maxDistance ?? DEFAULT_COCKPIT_STAT_MAX_DISTANCE,
  });
}

function collectLegacyShipComponent(
  component: PrefabComponent,
  ctx: CollectEntityContext,
  out: CollectedShip,
): void {
  switch (component.type) {
    case "ship-stats":
      collectShipStatsComponent(component, out);
      break;
    case "ship-gear":
      collectShipGearComponent(component, out);
      break;
    case "ship-ramp":
      collectShipRampComponent(component, out);
      break;
    case "ship-hull":
      collectShipHullComponent(component, ctx.entity, out);
      break;
    case "ship-door":
      collectShipDoorComponent(component, ctx, out);
      break;
    case "pilot-seat":
      collectPilotSeatComponent(component, ctx, out);
      break;
    case "ramp-interact":
      collectRampInteractComponent(component, ctx, out);
      break;
    case "cockpit-control":
      collectCockpitControlComponent(component, ctx, out);
      break;
    case "cockpit-stat":
      collectCockpitStatComponent(component, ctx, out);
      break;
    default:
      break;
  }
}

function sceneToShipPoint(point: Vec3): {
  right: number;
  up: number;
  forward: number;
} {
  return { right: -point.x, up: point.y, forward: point.z };
}

function collect(
  entity: PrefabEntity,
  parentPosition: Vec3,
  parentRotation: Quat,
  parentScale: Vec3,
  out: CollectedShip,
): void {
  const scaledLocal = vec3(
    entity.transform.position.x * parentScale.x,
    entity.transform.position.y * parentScale.y,
    entity.transform.position.z * parentScale.z,
  );
  const rotated = rotateVec3ByQuat(scaledLocal, parentRotation);
  const position = vec3(
    parentPosition.x + rotated.x,
    parentPosition.y + rotated.y,
    parentPosition.z + rotated.z,
  );
  const rotation = mulQuat(parentRotation, entity.transform.rotation);
  const scale = vec3(
    parentScale.x * entity.transform.scale.x,
    parentScale.y * entity.transform.scale.y,
    parentScale.z * entity.transform.scale.z,
  );

  const ctx: CollectEntityContext = {
    entity,
    position,
    right: -position.x,
    forward: position.z,
  };

  for (const component of entity.components ?? []) {
    collectLegacyShipComponent(component, ctx, out);
  }

  for (const child of entity.children ?? []) {
    collect(child, position, rotation, scale, out);
  }
}

function primaryPilotSeat(seats: ShipSeatSpec[]): ShipSeatSpec | null {
  return seats.find((seat) => seat.role === "pilot") ?? null;
}

/** Insert or replace a door by id (markers win over controller.doors). */
function upsertShipDoor(out: CollectedShip, door: ShipDoorSpec): void {
  const index = out.doors.findIndex((entry) => entry.id === door.id);
  if (index >= 0) out.doors[index] = door;
  else out.doors.push(door);
}

/**
 * Walks the entity tree for ship-door markers (works with ship-controller hulls).
 * Marker entries replace any controller.doors with the same id.
 */
function collectShipDoors(
  entity: PrefabEntity,
  transforms: Map<string, EntityWorldTransform>,
  out: CollectedShip,
): void {
  for (const component of entity.components ?? []) {
    if (component.type !== "ship-door") continue;
    const point = resolveEntityShipPoint(entity.id, transforms);
    if (!point) {
      console.warn(
        `Ship door "${component.id}" entity "${entity.id}" has no transform.`,
      );
      continue;
    }
    upsertShipDoor(out, {
      id: component.id,
      label: component.label,
      motion: component.motion,
      axis: component.axis,
      nodes: component.nodes.map((node) => ({ ...node })),
      interact: {
        right: point.right,
        up: point.up,
        forward: point.forward,
      },
      trigger: component.trigger ?? "radial",
      radius: component.radius ?? DEFAULT_DOOR_RADIUS,
      aimRadius: component.aimRadius ?? DEFAULT_DOOR_AIM_RADIUS,
      defaultOpen: component.defaultOpen ?? false,
      ...(component.openSoundUrl
        ? { openSoundUrl: component.openSoundUrl }
        : {}),
      ...(component.closeSoundUrl
        ? { closeSoundUrl: component.closeSoundUrl }
        : {}),
    });
  }
  for (const child of entity.children ?? []) {
    collectShipDoors(child, transforms, out);
  }
}

/**
 * Walks the entity tree for bed markers (works with ship-controller hulls).
 * Marker beds replace any earlier entry with the same id.
 */
function collectBeds(
  entity: PrefabEntity,
  transforms: Map<string, EntityWorldTransform>,
  out: CollectedShip,
): void {
  for (const component of entity.components ?? []) {
    if (component.type !== "bed") continue;
    const transform = transforms.get(entity.id);
    const point = resolveEntityShipPoint(entity.id, transforms);
    if (!point || !transform) {
      console.warn(
        `Ship bed "${component.id}" entity "${entity.id}" has no transform.`,
      );
      continue;
    }
    const position = transform.position;
    const eye = component.eye ?? { x: 0, y: 0.3, z: 0.15 };
    const stand = component.stand ?? { x: -0.9, z: 0 };
    const bed: ShipBedSpec = {
      id: component.id || entity.id,
      label: component.label ?? "bed",
      bed: {
        right: point.right,
        up: point.up,
        forward: point.forward,
      },
      eye: {
        right: -(position.x + eye.x),
        up: position.y + eye.y,
        forward: position.z + eye.z,
      },
      stand: {
        right: -(position.x + stand.x),
        forward: position.z + stand.z,
      },
      trigger: component.trigger ?? "radial",
      radius: component.radius ?? DEFAULT_BED_RADIUS,
      aimRadius: component.aimRadius ?? DEFAULT_BED_AIM_RADIUS,
    };
    const index = out.beds.findIndex((entry) => entry.id === bed.id);
    if (index >= 0) out.beds[index] = bed;
    else out.beds.push(bed);
  }
  for (const child of entity.children ?? []) {
    collectBeds(child, transforms, out);
  }
}

/** Walks the entity tree for cockpit-control markers (works with ship-controller hulls). */
function collectCockpitControls(
  entity: PrefabEntity,
  transforms: Map<string, EntityWorldTransform>,
  out: CollectedShip,
): void {
  for (const component of entity.components ?? []) {
    if (component.type !== "cockpit-control") continue;
    const point = resolveEntityShipPoint(entity.id, transforms);
    if (!point) {
      console.warn(
        `Cockpit control "${component.id}" entity "${entity.id}" has no transform.`,
      );
      continue;
    }
    // Avoid duplicates when legacy collect() already pushed the same marker.
    if (out.cockpitControls.some((c) => c.id === (component.id || entity.id))) {
      continue;
    }
    out.cockpitControls.push({
      id: component.id || entity.id,
      action: component.action,
      ...(component.label ? { label: component.label } : {}),
      position: {
        right: point.right,
        up: point.up,
        forward: point.forward,
      },
      gazeRadius: component.gazeRadius ?? DEFAULT_COCKPIT_GAZE_RADIUS,
      maxDistance: component.maxDistance ?? DEFAULT_COCKPIT_MAX_DISTANCE,
    });
  }
  for (const child of entity.children ?? []) {
    collectCockpitControls(child, transforms, out);
  }
}

/** Walks the entity tree for cockpit-stat markers (works with ship-controller hulls). */
function collectCockpitStats(
  entity: PrefabEntity,
  transforms: Map<string, EntityWorldTransform>,
  out: CollectedShip,
): void {
  for (const component of entity.components ?? []) {
    if (component.type !== "cockpit-stat") continue;
    const point = resolveEntityShipPoint(entity.id, transforms);
    if (!point) {
      console.warn(
        `Cockpit stat "${component.id}" entity "${entity.id}" has no transform.`,
      );
      continue;
    }
    if (out.cockpitStats.some((c) => c.id === (component.id || entity.id))) {
      continue;
    }
    out.cockpitStats.push({
      id: component.id || entity.id,
      kind: component.kind,
      ...(component.label ? { label: component.label } : {}),
      position: {
        right: point.right,
        up: point.up,
        forward: point.forward,
      },
      maxDistance: component.maxDistance ?? DEFAULT_COCKPIT_STAT_MAX_DISTANCE,
    });
  }
  for (const child of entity.children ?? []) {
    collectCockpitStats(child, transforms, out);
  }
}

/** Walks the entity tree for entertainment-system markers (bunk mini-TV). */
function collectEntertainmentSystems(
  entity: PrefabEntity,
  transforms: Map<string, EntityWorldTransform>,
  out: CollectedShip,
): void {
  for (const component of entity.components ?? []) {
    if (component.type !== "entertainment-system") continue;
    const point = resolveEntityShipPoint(entity.id, transforms);
    if (!point) {
      console.warn(
        `Entertainment system "${component.id}" entity "${entity.id}" has no transform.`,
      );
      continue;
    }
    if (
      out.entertainmentSystems.some((c) => c.id === (component.id || entity.id))
    ) {
      continue;
    }
    const xf = transforms.get(entity.id)!;
    out.entertainmentSystems.push({
      id: component.id || entity.id,
      label: component.label?.trim() || "Turn on ES",
      position: {
        right: point.right,
        up: point.up,
        forward: point.forward,
      },
      rotation: {
        x: xf.rotation.x,
        y: xf.rotation.y,
        z: xf.rotation.z,
        w: xf.rotation.w,
      },
      gazeRadius: component.gazeRadius ?? DEFAULT_ES_GAZE_RADIUS,
      maxDistance: component.maxDistance ?? DEFAULT_ES_MAX_DISTANCE,
      screenWidth: component.screenWidth ?? DEFAULT_ES_SCREEN_WIDTH,
      screenHeight: component.screenHeight ?? DEFAULT_ES_SCREEN_HEIGHT,
    });
  }
  for (const child of entity.children ?? []) {
    collectEntertainmentSystems(child, transforms, out);
  }
}

function animationForNode(
  nodeName: string,
  doors: ShipDoorSpec[],
  spec: ShipSpec,
): ColliderAnimationBinding | undefined {
  for (const door of doors) {
    const node = door.nodes.find((entry) => entry.name === nodeName);
    if (node) {
      return {
        kind: "door",
        doorId: door.id,
        motion: door.motion,
        axis: door.axis,
        delta: node.delta,
      };
    }
  }
  if (spec.rampHinge?.name === nodeName) {
    return {
      kind: "ramp",
      axis: spec.rampHinge.axis ?? "x",
      radians: spec.rampHinge.lowerRadians,
    };
  }
  const gear = spec.gearHinges.find((entry) => entry.name === nodeName);
  if (gear) {
    return {
      kind: "gear",
      axis: gear.axis ?? "x",
      radians: gear.deployRadians,
    };
  }
  return undefined;
}

function bindColliderAnimations(
  colliders: GameplayCollider[],
  doors: ShipDoorSpec[],
  spec: ShipSpec,
  prefabId: string,
): GameplayCollider[] {
  const boundNodes = new Set<string>();
  const result = colliders.map((collider) => {
    if (!collider.node) return collider;
    const animation = animationForNode(collider.node, doors, spec);
    if (!animation) return collider;
    boundNodes.add(collider.node);
    return { ...collider, animation };
  });
  // A door with no bound collider animates visually but its collider stays
  // enabled (the custom collision resolver never moves it), so the player
  // can't walk through. Warn once per unbound door. A collider with no
  // matching node is simply a static hull/floor collider — that is normal and
  // not warned about.
  for (const door of doors) {
    if (!door.nodes.some((n) => boundNodes.has(n.name))) {
      console.warn(
        `Ship prefab "${prefabId}" door "${door.id}" has no collider bound to node(s) ${door.nodes
          .map((n) => `"${n.name}"`)
          .join(", ")}; the door will animate visually but its collider stays enabled (player can't walk through).`,
      );
    }
  }
  return result;
}

function createEmptyCollectedShip(): CollectedShip {
  return {
    hullUrl: null,
    hullNodeOverrides: null,
    restHeight: null,
    spec: {},
    doors: [],
    seats: [],
    beds: [],
    cockpitControls: [],
    cockpitStats: [],
    entertainmentSystems: [],
    rampInteracts: [],
    cameraBounds: [],
    deckSpawn: null,
    testSpawn: null,
    hasController: false,
  };
}

function populateCollectedShipFromPrefab(
  doc: PrefabDocument,
  transforms: Map<string, EntityWorldTransform>,
  out: CollectedShip,
): void {
  const hullWithController = findHullEntityWithController(doc.root);
  if (hullWithController) {
    bakeFromShipController(
      hullWithController.entity,
      hullWithController.controller,
      transforms,
      out,
    );
  } else {
    collect(doc.root, vec3(0, 0, 0), quatIdentity(), vec3(1, 1, 1), out);
  }
  collectCockpitControls(doc.root, transforms, out);
  collectCockpitStats(doc.root, transforms, out);
  collectEntertainmentSystems(doc.root, transforms, out);
  collectShipDoors(doc.root, transforms, out);
  collectBeds(doc.root, transforms, out);
}

function resolveTestSpawn(
  doc: PrefabDocument,
  transforms: Map<string, EntityWorldTransform>,
  out: CollectedShip,
): void {
  const testSpawnEntity = findEntityByName(doc.root, "Test Spawn");
  if (!testSpawnEntity) return;
  const point = resolveEntityShipPoint(testSpawnEntity.id, transforms);
  if (point) {
    out.testSpawn = {
      right: point.right,
      up: point.up,
      forward: point.forward,
    };
    return;
  }
  console.warn(
    `Ship prefab "${doc.id}" has a "Test Spawn" empty but its transform could not be resolved.`,
  );
}

function shipPrefabHasContent(out: CollectedShip): boolean {
  return (
    out.hasController ||
    out.hullUrl !== null ||
    out.doors.length > 0 ||
    out.seats.length > 0 ||
    out.beds.length > 0 ||
    out.rampInteracts.length > 0 ||
    Object.keys(out.spec).length > 0
  );
}

function warnShipLayoutIssues(doc: PrefabDocument, out: CollectedShip): void {
  if (!out.hullUrl) {
    console.warn(
      `Ship prefab "${doc.id}" has no hull GLB on the ship-controller / ship-hull entity; using the built-in hull.`,
    );
  }
  const pilot = primaryPilotSeat(out.seats);
  if (out.seats.length > 0 && !pilot) {
    console.warn(
      `Ship prefab "${doc.id}" has seats but none with role "pilot"; flight controls stay unavailable until one is marked pilot.`,
    );
  } else if (out.seats.length === 0) {
    console.warn(
      `Ship prefab "${doc.id}" has no ship-seat markers; using the built-in pilot anchors.`,
    );
  }
  const pilotCount = out.seats.filter((seat) => seat.role === "pilot").length;
  if (pilotCount > 1) {
    console.warn(
      `Ship prefab "${doc.id}" has ${pilotCount} pilot seats; the first pilot marker wins for flight.`,
    );
  }
}

function resolvePilotAnchors(out: CollectedShip): {
  pilotSeat: ShipLayout["pilotSeat"];
  pilotEye: ShipLayout["pilotEye"];
  seatStand: ShipLayout["seatStand"];
} {
  const fallback = DEFAULT_SHIP_LAYOUT;
  const pilot = primaryPilotSeat(out.seats);
  return {
    pilotSeat: pilot?.seat ?? fallback.pilotSeat,
    pilotEye: pilot?.eye ?? fallback.pilotEye,
    seatStand: pilot?.stand ?? fallback.seatStand,
  };
}

async function finalizeShipLayout(
  doc: PrefabDocument,
  out: CollectedShip,
): Promise<ShipLayout> {
  const { pilotSeat, pilotEye, seatStand } = resolvePilotAnchors(out);
  const spec = mergeShipSpec(out.spec);
  const colliders = bindColliderAnimations(
    await buildPrefabColliders(doc),
    out.doors,
    spec,
    doc.id,
  );
  await preloadMeshColliders(colliders);
  validateMeshColliders(colliders);
  if (out.hasController && colliders.length === 0) {
    console.warn(
      `Ship prefab "${doc.id}" uses ship-controller but has no deck colliders; the interior is not walkable yet.`,
    );
  }
  return {
    spec,
    hullUrl: out.hullUrl,
    hullNodeOverrides: out.hullNodeOverrides ?? undefined,
    restHeightMeters: out.restHeight,
    doors: out.doors,
    seats: out.seats,
    beds: out.beds,
    cockpitControls: out.cockpitControls,
    cockpitStats: out.cockpitStats,
    entertainmentSystems: out.entertainmentSystems,
    pilotSeat,
    pilotEye,
    seatStand,
    rampInteracts: out.rampInteracts,
    colliders,
    cameraBounds: out.cameraBounds,
    deckSpawn: out.deckSpawn ?? undefined,
    testSpawn: out.testSpawn ?? undefined,
    sounds: buildPrefabSounds(doc),
  };
}

/**
 * Builds the ship layout for a ship prefab. Returns null only when the
 * prefab has no ship components at all. An in-progress prefab (e.g. hull
 * only, no deck colliders yet) still yields a layout so previews show the
 * authored ship; deck walking simply stays unavailable until colliders exist.
 * Missing primary pilot seat falls back to the built-in Starhopper anchors.
 */
export async function buildShipLayoutFromPrefab(
  doc: PrefabDocument,
): Promise<ShipLayout | null> {
  const transforms = new Map<string, EntityWorldTransform>();
  buildEntityTransformMap(
    doc.root,
    vec3(0, 0, 0),
    quatIdentity(),
    vec3(1, 1, 1),
    transforms,
  );

  const out = createEmptyCollectedShip();
  populateCollectedShipFromPrefab(doc, transforms, out);
  resolveTestSpawn(doc, transforms, out);

  if (!shipPrefabHasContent(out)) {
    console.warn(
      `Ship prefab "${doc.id}" has no ship components; using the built-in ship.`,
    );
    return null;
  }

  warnShipLayoutIssues(doc, out);
  return finalizeShipLayout(doc, out);
}
