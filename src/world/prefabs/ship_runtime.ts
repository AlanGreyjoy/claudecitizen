import {
  mulQuat,
  quatIdentity,
  rotateVec3ByQuat,
  type Quat,
} from "../../math/quat";
import { normalize, vec3 } from "../../math/vec3";
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
  type ShipRampMount,
  type ShipSeatSpec,
  type ShipSpec,
  type ShipWalkZone,
  type ShipWalkZoneOriented,
} from "../../player/ship_layout";
import { orientedZoneBounds } from "../../player/ship_zone_oriented";
import type { PrefabComponent, PrefabDocument, PrefabEntity, PrefabNodeOverride } from "./schema";
import type { Vec3 } from "../../types";
import {
  type ColliderAnimationBinding,
  type GameplayCollider,
  preloadMeshColliders,
  validateMeshColliders,
} from "../../physics/colliders";
import { buildPrefabColliders } from "../../physics/prefab_colliders";
import { buildPrefabSounds } from "./sound_runtime";

/**
 * Derives the ship gameplay layout (walk zones, doors, seats, ramp
 * anchors, hull url) from a ship prefab's components.
 *
 * Prefab/scene axes map to ship-local gameplay axes as right = -x, up = y,
 * forward = z (matching the render group orientation from
 * updateShipPlacement). Walk zones honor entity rotation when tilted; other
 * mounts stay axis-aligned in ship space.
 */

const DEFAULT_ZONE_HEIGHT = 3.1;
const DEFAULT_DOOR_RADIUS = 1.6;
const DEFAULT_DOOR_AIM_RADIUS = 0.35;
const DEFAULT_RAMP_OUTSIDE_RADIUS = 3.0;
const DEFAULT_RAMP_DECK_RADIUS = 1.7;
const DEFAULT_CHAIR_RADIUS = 1.45;
const DEFAULT_BED_RADIUS = 1.6;
const DEFAULT_BED_AIM_RADIUS = 0.35;
const DEFAULT_STAIR_STEPS = 4;
const DEFAULT_COCKPIT_GAZE_RADIUS = 0.2;
const DEFAULT_COCKPIT_MAX_DISTANCE = 2.5;
const DEFAULT_ES_GAZE_RADIUS = 0.35;
const DEFAULT_ES_MAX_DISTANCE = 2;
const DEFAULT_ES_SCREEN_WIDTH = 0.55;
const DEFAULT_ES_SCREEN_HEIGHT = 0.32;
const DEFAULT_COCKPIT_STAT_MAX_DISTANCE = 3.5;
/** Mount clamp keeps a fresh mount above the dismount line. */
const RAMP_MOUNT_CLAMP_METERS = 0.6;

interface CollectedShip {
  hullUrl: string | null;
  hullNodeOverrides: PrefabNodeOverride[] | null;
  restHeight: number | null;
  spec: Partial<ShipSpec>;
  walkZones: ShipWalkZone[];
  doors: ShipDoorSpec[];
  seats: ShipSeatSpec[];
  beds: ShipBedSpec[];
  cockpitControls: CockpitControlSpec[];
  cockpitStats: CockpitStatSpec[];
  entertainmentSystems: EntertainmentSystemSpec[];
  rampInteracts: ShipRampInteract[];
  rampMount: ShipRampMount | null;
  cameraBounds: ShipCameraBounds[];
  rampDismountForward: number | null;
  rampDismountGround: { right: number; forward: number } | null;
  deckSpawn: { right: number; forward: number } | null;
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

function bakeFromShipController(
  hull: PrefabEntity,
  controller: Extract<PrefabComponent, { type: "ship-controller" }>,
  transforms: Map<string, EntityWorldTransform>,
  out: CollectedShip,
): void {
  out.hasController = true;
  out.hullUrl = hull.asset?.url ?? null;
  out.hullNodeOverrides = hull.nodeOverrides ? [...hull.nodeOverrides] : null;
  if (controller.restHeight !== undefined) out.restHeight = controller.restHeight;
  if (controller.stats?.maxSpeedMps !== undefined)
    out.spec.maxSpeedMps = controller.stats.maxSpeedMps;
  if (controller.stats?.maxHp !== undefined) out.spec.maxHp = controller.stats.maxHp;
  if (controller.stats?.maxShields !== undefined)
    out.spec.maxShields = controller.stats.maxShields;
  if (controller.stats?.shieldRegenPerSec !== undefined)
    out.spec.shieldRegenPerSec = controller.stats.shieldRegenPerSec;
  if (controller.stats?.massKg !== undefined) out.spec.massKg = controller.stats.massKg;
  if (controller.stats?.maxAngularRateRadps !== undefined)
    out.spec.maxAngularRateRadps = controller.stats.maxAngularRateRadps;
  if (controller.stats?.forwardThrustN !== undefined)
    out.spec.forwardThrustN = controller.stats.forwardThrustN;
  if (controller.stats?.backwardThrustN !== undefined)
    out.spec.backwardThrustN = controller.stats.backwardThrustN;
  if (controller.stats?.verticalThrustN !== undefined)
    out.spec.verticalThrustN = controller.stats.verticalThrustN;
  if (controller.stats?.lateralThrustN !== undefined)
    out.spec.lateralThrustN = controller.stats.lateralThrustN;
  if (controller.stats?.pitchTorqueNm !== undefined)
    out.spec.pitchTorqueNm = controller.stats.pitchTorqueNm;
  if (controller.stats?.yawTorqueNm !== undefined)
    out.spec.yawTorqueNm = controller.stats.yawTorqueNm;
  if (controller.stats?.rollTorqueNm !== undefined)
    out.spec.rollTorqueNm = controller.stats.rollTorqueNm;
  if (controller.stats?.thrustFovForwardDeg !== undefined)
    out.spec.thrustFovForwardDeg = controller.stats.thrustFovForwardDeg;
  if (controller.stats?.thrustFovBackwardDeg !== undefined)
    out.spec.thrustFovBackwardDeg = controller.stats.thrustFovBackwardDeg;
  if (controller.stats?.thrustFovBlendPerSec !== undefined)
    out.spec.thrustFovBlendPerSec = controller.stats.thrustFovBlendPerSec;
  if (controller.stats?.boostShakeAmplitudeM !== undefined)
    out.spec.boostShakeAmplitudeM = controller.stats.boostShakeAmplitudeM;
  if (controller.stats?.boostShakeHz !== undefined)
    out.spec.boostShakeHz = controller.stats.boostShakeHz;
  if (controller.stats?.boostBlendPerSec !== undefined)
    out.spec.boostBlendPerSec = controller.stats.boostBlendPerSec;
  if (controller.stats?.boostSoundUrl) {
    out.spec.boostSoundUrl = controller.stats.boostSoundUrl;
  }
  if (controller.stats?.boostSoundVolume !== undefined) {
    out.spec.boostSoundVolume = controller.stats.boostSoundVolume;
  }
  if (controller.stats?.thrustSoundUrl) {
    out.spec.thrustSoundUrl = controller.stats.thrustSoundUrl;
  }
  if (controller.stats?.thrustSoundVolume !== undefined) {
    out.spec.thrustSoundVolume = controller.stats.thrustSoundVolume;
  }

  if (controller.gear?.nodes?.length) {
    out.spec.gearHinges = controller.gear.nodes.map(
      (node): ShipGearHingeSpec => ({
        name: node.name,
        ...(node.under ? { under: node.under } : {}),
        deployRadians: node.deployRadians,
        ...(node.axis ? { axis: node.axis } : {}),
      }),
    );
  }
  if (controller.gear?.deploySoundUrl) {
    out.spec.gearDeploySoundUrl = controller.gear.deploySoundUrl;
  }
  if (controller.gear?.retractSoundUrl) {
    out.spec.gearRetractSoundUrl = controller.gear.retractSoundUrl;
  }
  if (controller.ramp?.hinge) {
    out.spec.rampHinge = {
      name: controller.ramp.hinge.node,
      lowerRadians: controller.ramp.hinge.lowerRadians,
      ...(controller.ramp.hinge.axis ? { axis: controller.ramp.hinge.axis } : {}),
    };
    if (controller.ramp.openSoundUrl) {
      out.spec.rampOpenSoundUrl = controller.ramp.openSoundUrl;
    }
    if (controller.ramp.closeSoundUrl) {
      out.spec.rampCloseSoundUrl = controller.ramp.closeSoundUrl;
    }
    if (controller.ramp.outsideInteractId) {
      const point = resolveEntityShipPoint(
        controller.ramp.outsideInteractId,
        transforms,
      );
      if (point) {
        out.rampInteracts.push({
          placement: "outside",
          right: point.right,
          forward: point.forward,
          radius: controller.ramp.outsideRadius ?? DEFAULT_RAMP_OUTSIDE_RADIUS,
        });
      } else {
        console.warn(
          `Ship controller ramp.outsideInteractId "${controller.ramp.outsideInteractId}" not found.`,
        );
      }
    }
    if (controller.ramp.deckInteractId) {
      const point = resolveEntityShipPoint(
        controller.ramp.deckInteractId,
        transforms,
      );
      if (point) {
        out.rampInteracts.push({
          placement: "deck",
          right: point.right,
          forward: point.forward,
          radius: controller.ramp.deckRadius ?? DEFAULT_RAMP_DECK_RADIUS,
        });
      } else {
        console.warn(
          `Ship controller ramp.deckInteractId "${controller.ramp.deckInteractId}" not found.`,
        );
      }
    }
    if (controller.ramp.dismountForward !== undefined) {
      out.rampDismountForward = controller.ramp.dismountForward;
    }
    if (controller.ramp.dismountGround) {
      out.rampDismountGround = {
        right: -controller.ramp.dismountGround.x,
        forward: controller.ramp.dismountGround.z,
      };
    }
  }

  for (const door of controller.doors ?? []) {
    const interact = resolveEntityShipPoint(door.interactEntityId, transforms);
    if (!interact) {
      console.warn(
        `Ship controller door "${door.id}" interactEntityId "${door.interactEntityId}" not found.`,
      );
      continue;
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

  for (const seat of controller.seats ?? []) {
    const point = resolveEntityShipPoint(seat.entityId, transforms);
    if (!point) {
      console.warn(
        `Ship controller seat entityId "${seat.entityId}" not found.`,
      );
      continue;
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

  if (controller.deckSpawnEntityId) {
    const point = resolveEntityShipPoint(controller.deckSpawnEntityId, transforms);
    if (point) {
      out.deckSpawn = { right: point.right, forward: point.forward };
    }
  }

  for (const ladder of controller.ladders ?? []) {
    pushWalkZone(out, {
      id: ladder.id,
      minRight: -ladder.max.x,
      maxRight: -ladder.min.x,
      minForward: ladder.min.z,
      maxForward: ladder.max.z,
      floorUp: ladder.riseUp,
      slopeMinUp: 0,
      ladder: true,
      ceilingUp: ladder.riseUp + DEFAULT_ZONE_HEIGHT,
    });
  }

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

function mergeShipSpec(partial: Partial<ShipSpec>): ShipSpec {
  const massKg = partial.massKg ?? DEFAULT_SHIP_SPEC.massKg;
  const forwardThrustN =
    partial.forwardThrustN ??
    (partial.throttleAccelMps2 !== undefined
      ? partial.throttleAccelMps2 * massKg
      : DEFAULT_SHIP_SPEC.forwardThrustN);
  const throttleAccelMps2 =
    partial.throttleAccelMps2 ?? forwardThrustN / Math.max(massKg, 1);
  return {
    maxSpeedMps: partial.maxSpeedMps ?? DEFAULT_SHIP_SPEC.maxSpeedMps,
    throttleAccelMps2,
    massKg,
    maxAngularRateRadps:
      partial.maxAngularRateRadps ?? DEFAULT_SHIP_SPEC.maxAngularRateRadps,
    forwardThrustN,
    backwardThrustN: partial.backwardThrustN ?? DEFAULT_SHIP_SPEC.backwardThrustN,
    verticalThrustN: partial.verticalThrustN ?? DEFAULT_SHIP_SPEC.verticalThrustN,
    lateralThrustN: partial.lateralThrustN ?? DEFAULT_SHIP_SPEC.lateralThrustN,
    pitchTorqueNm: partial.pitchTorqueNm ?? DEFAULT_SHIP_SPEC.pitchTorqueNm,
    yawTorqueNm: partial.yawTorqueNm ?? DEFAULT_SHIP_SPEC.yawTorqueNm,
    rollTorqueNm: partial.rollTorqueNm ?? DEFAULT_SHIP_SPEC.rollTorqueNm,
    thrustFovForwardDeg:
      partial.thrustFovForwardDeg ?? DEFAULT_SHIP_SPEC.thrustFovForwardDeg,
    thrustFovBackwardDeg:
      partial.thrustFovBackwardDeg ?? DEFAULT_SHIP_SPEC.thrustFovBackwardDeg,
    thrustFovBlendPerSec:
      partial.thrustFovBlendPerSec ?? DEFAULT_SHIP_SPEC.thrustFovBlendPerSec,
    boostShakeAmplitudeM:
      partial.boostShakeAmplitudeM ?? DEFAULT_SHIP_SPEC.boostShakeAmplitudeM,
    boostShakeHz: partial.boostShakeHz ?? DEFAULT_SHIP_SPEC.boostShakeHz,
    boostBlendPerSec:
      partial.boostBlendPerSec ?? DEFAULT_SHIP_SPEC.boostBlendPerSec,
    boostSoundVolume:
      partial.boostSoundVolume ?? DEFAULT_SHIP_SPEC.boostSoundVolume,
    thrustSoundVolume:
      partial.thrustSoundVolume ?? DEFAULT_SHIP_SPEC.thrustSoundVolume,
    maxHp: partial.maxHp ?? DEFAULT_SHIP_SPEC.maxHp,
    maxShields: partial.maxShields ?? DEFAULT_SHIP_SPEC.maxShields,
    shieldRegenPerSec:
      partial.shieldRegenPerSec ?? DEFAULT_SHIP_SPEC.shieldRegenPerSec,
    gearHinges:
      partial.gearHinges && partial.gearHinges.length > 0
        ? partial.gearHinges
        : DEFAULT_STARHOPPER_GEAR_HINGES,
    rampHinge: partial.rampHinge ?? DEFAULT_STARHOPPER_RAMP_HINGE,
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

function pushWalkZone(
  out: CollectedShip,
  zone: Omit<ShipWalkZone, "id"> & { id: string },
): void {
  out.walkZones.push(zone);
}

function isQuatIdentity(rotation: Quat, eps = 1e-5): boolean {
  return (
    Math.abs(rotation.w - 1) < eps &&
    Math.abs(rotation.x) < eps &&
    Math.abs(rotation.y) < eps &&
    Math.abs(rotation.z) < eps
  );
}

function sceneToShipPoint(point: Vec3): {
  right: number;
  up: number;
  forward: number;
} {
  return { right: -point.x, up: point.y, forward: point.z };
}

function sceneToShipVec(vector: Vec3): Vec3 {
  return vec3(-vector.x, vector.y, vector.z);
}

function bakeOrientedWalkZone(
  component: Extract<PrefabComponent, { type: "ship-walk-zone" }>,
  position: Vec3,
  rotation: Quat,
  scale: Vec3,
): Omit<ShipWalkZone, "id"> {
  const halfWidth = ((component.max.x - component.min.x) / 2) * scale.x;
  const halfDepth = ((component.max.z - component.min.z) / 2) * scale.z;
  const zoneHeight = (component.height ?? DEFAULT_ZONE_HEIGHT) * scale.y;
  const localCenter = vec3(
    ((component.min.x + component.max.x) / 2) * scale.x,
    0,
    ((component.min.z + component.max.z) / 2) * scale.z,
  );
  const rotatedCenter = rotateVec3ByQuat(localCenter, rotation);
  const floorCenterScene = vec3(
    position.x + rotatedCenter.x,
    position.y + rotatedCenter.y,
    position.z + rotatedCenter.z,
  );
  const oriented: ShipWalkZoneOriented = {
    origin: sceneToShipPoint(floorCenterScene),
    axisRight: normalize(
      sceneToShipVec(rotateVec3ByQuat(vec3(1, 0, 0), rotation)),
    ),
    axisUp: normalize(
      sceneToShipVec(rotateVec3ByQuat(vec3(0, 1, 0), rotation)),
    ),
    axisForward: normalize(
      sceneToShipVec(rotateVec3ByQuat(vec3(0, 0, 1), rotation)),
    ),
    halfWidth,
    halfDepth,
    height: zoneHeight,
  };
  const bounds = orientedZoneBounds(oriented);
  return {
    minRight: bounds.minRight,
    maxRight: bounds.maxRight,
    minForward: bounds.minForward,
    maxForward: bounds.maxForward,
    floorUp: bounds.floorUp,
    ceilingUp: bounds.ceilingUp,
    oriented,
    ...(component.gate !== undefined ? { gate: component.gate } : {}),
    ...(component.passage ? { passage: true } : {}),
  };
}

function bakeAxisAlignedWalkZone(
  component: Extract<PrefabComponent, { type: "ship-walk-zone" }>,
  position: Vec3,
  scale: Vec3,
): Omit<ShipWalkZone, "id"> {
  const minX = position.x + component.min.x * scale.x;
  const maxX = position.x + component.max.x * scale.x;
  return {
    minRight: -maxX,
    maxRight: -minX,
    minForward: position.z + component.min.z * scale.z,
    maxForward: position.z + component.max.z * scale.z,
    floorUp: position.y,
    ...(component.slopeMinUp !== undefined
      ? { slopeMinUp: position.y + component.slopeMinUp * scale.y }
      : {}),
    ceilingUp: position.y + (component.height ?? DEFAULT_ZONE_HEIGHT) * scale.y,
    ...(component.gate !== undefined ? { gate: component.gate } : {}),
    ...(component.passage ? { passage: true } : {}),
  };
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

  const right = -position.x;
  const forward = position.z;

  for (const component of entity.components ?? []) {
    switch (component.type) {
      case "ship-stats":
        if (component.maxSpeedMps !== undefined)
          out.spec.maxSpeedMps ??= component.maxSpeedMps;
        if (component.maxHp !== undefined) out.spec.maxHp ??= component.maxHp;
        if (component.maxShields !== undefined)
          out.spec.maxShields ??= component.maxShields;
        if (component.shieldRegenPerSec !== undefined)
          out.spec.shieldRegenPerSec ??= component.shieldRegenPerSec;
        break;
      case "ship-gear":
        out.spec.gearHinges = component.nodes.map(
          (node): ShipGearHingeSpec => ({
            name: node.name,
            ...(node.under ? { under: node.under } : {}),
            deployRadians: node.deployRadians,
            ...(node.axis ? { axis: node.axis } : {}),
          }),
        );
        break;
      case "ship-ramp":
        out.spec.rampHinge = {
          name: component.node,
          lowerRadians: component.lowerRadians,
          ...(component.axis ? { axis: component.axis } : {}),
        };
        break;
      case "ship-hull":
        if (entity.asset) out.hullUrl ??= entity.asset.url;
        if (component.restHeight !== undefined)
          out.restHeight ??= component.restHeight;
        break;
      case "ship-walk-zone": {
        const baked =
          isQuatIdentity(rotation) || component.slopeMinUp !== undefined
            ? bakeAxisAlignedWalkZone(component, position, scale)
            : bakeOrientedWalkZone(component, position, rotation, scale);
        pushWalkZone(out, { id: component.zoneId, ...baked });
        break;
      }
      case "ship-stairs": {
        const minX = position.x + component.min.x * scale.x;
        const maxX = position.x + component.max.x * scale.x;
        const minForward = position.z + component.min.z * scale.z;
        const maxForward = position.z + component.max.z * scale.z;
        const rise = component.riseUp * scale.y;
        pushWalkZone(out, {
          id: component.zoneId,
          minRight: -maxX,
          maxRight: -minX,
          minForward,
          maxForward,
          floorUp: position.y + rise,
          slopeMinUp: position.y,
          ...(component.variant !== "ladder"
            ? { stepCount: component.stepCount ?? DEFAULT_STAIR_STEPS }
            : { ladder: true }),
          ceilingUp:
            position.y +
            rise +
            (component.height ?? DEFAULT_ZONE_HEIGHT) * scale.y,
          ...(component.gate !== undefined ? { gate: component.gate } : {}),
          ...(component.passage ? { passage: true } : {}),
        });
        break;
      }
      case "ship-door":
        upsertShipDoor(out, {
          id: component.id,
          label: component.label,
          motion: component.motion,
          axis: component.axis,
          nodes: component.nodes.map((node) => ({ ...node })),
          interact: { right, up: position.y, forward },
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
        break;
      case "pilot-seat": {
        const eye = component.eye ?? { x: 0, y: 0.87, z: 0.25 };
        const stand = component.stand ?? { x: 0, z: -1.55 };
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
        break;
      }
      case "ramp-interact":
        out.rampInteracts.push({
          placement: component.placement,
          right,
          forward,
          radius:
            component.radius ??
            (component.placement === "outside"
              ? DEFAULT_RAMP_OUTSIDE_RADIUS
              : DEFAULT_RAMP_DECK_RADIUS),
        });
        break;
      case "ramp-mount": {
        const minX = position.x + component.min.x * scale.x;
        const maxX = position.x + component.max.x * scale.x;
        const minForward = position.z + component.min.z * scale.z;
        const maxForward = position.z + component.max.z * scale.z;
        out.rampMount = {
          minRight: -maxX,
          maxRight: -minX,
          minForward,
          maxForward,
          clampForward: Math.min(
            maxForward,
            minForward + RAMP_MOUNT_CLAMP_METERS,
          ),
        };
        break;
      }
      case "cockpit-control": {
        // Also collected via collectCockpitControls for ship-controller path.
        const point = sceneToShipPoint(position);
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
        break;
      }
      case "cockpit-stat": {
        // Also collected via collectCockpitStats for ship-controller path.
        const point = sceneToShipPoint(position);
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
        break;
      }
      default:
        break;
    }
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

/**
 * Builds the ship layout for a ship prefab. Returns null only when the
 * prefab has no ship components at all. An in-progress prefab (e.g. hull
 * only, no walk zones yet) still yields a layout so previews show the
 * authored ship; deck walking simply stays unavailable until zones exist.
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

  const out: CollectedShip = {
    hullUrl: null,
    hullNodeOverrides: null,
    restHeight: null,
    spec: {},
    walkZones: [],
    doors: [],
    seats: [],
    beds: [],
    cockpitControls: [],
    cockpitStats: [],
    entertainmentSystems: [],
    rampInteracts: [],
    rampMount: null,
    cameraBounds: [],
    rampDismountForward: null,
    rampDismountGround: null,
    deckSpawn: null,
    hasController: false,
  };

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

  const hasShipContent =
    out.hasController ||
    out.hullUrl !== null ||
    out.walkZones.length > 0 ||
    out.doors.length > 0 ||
    out.seats.length > 0 ||
    out.beds.length > 0 ||
    out.rampInteracts.length > 0 ||
    out.rampMount !== null ||
    Object.keys(out.spec).length > 0;
  if (!hasShipContent) {
    console.warn(
      `Ship prefab "${doc.id}" has no ship components; using the built-in ship.`,
    );
    return null;
  }
  if (!out.hasController && out.walkZones.length === 0) {
    console.warn(
      `Ship prefab "${doc.id}" has no ship-walk-zone or ship-stairs components; the deck is not walkable yet.`,
    );
  } else if (out.hasController && out.walkZones.length === 0) {
    // Collider-deck ships rely on hull colliders instead of walk zones.
  }
  if (!out.hullUrl) {
    console.warn(
      `Ship prefab "${doc.id}" has no hull GLB on the ship-controller / ship-hull entity; using the built-in hull.`,
    );
  }

  const fallback = DEFAULT_SHIP_LAYOUT;
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

  const pilotSeat = pilot?.seat ?? fallback.pilotSeat;
  const pilotEye = pilot?.eye ?? fallback.pilotEye;
  const seatStand = pilot?.stand ?? fallback.seatStand;

  const rampDismountForward =
    out.rampDismountForward ?? -Infinity;
  const rampDismountGround =
    out.rampDismountGround ?? { right: 0, forward: 0 };

  const spec = mergeShipSpec(out.spec);
  const colliders = bindColliderAnimations(
    await buildPrefabColliders(doc),
    out.doors,
    spec,
    doc.id,
  );
  await preloadMeshColliders(colliders);
  validateMeshColliders(colliders);
  if (out.hasController && out.walkZones.length === 0 && colliders.length === 0) {
    console.warn(
      `Ship prefab "${doc.id}" uses ship-controller but has no deck colliders; the interior is not walkable yet.`,
    );
  }

  return {
    spec,
    hullUrl: out.hullUrl,
    hullNodeOverrides: out.hullNodeOverrides ?? undefined,
    restHeightMeters: out.restHeight,
    walkZones: out.walkZones,
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
    rampMount: out.rampMount,
    colliders,
    rampDismountForward,
    rampDismountGround,
    cameraBounds: out.cameraBounds,
    deckSpawn: out.deckSpawn ?? undefined,
    sounds: buildPrefabSounds(doc),
  };
}
