import {
  mulQuat,
  quatIdentity,
  rotateVec3ByQuat,
  type Quat,
} from "../../math/quat";
import { normalize, vec3 } from "../../math/vec3";
import {
  DEFAULT_SHIP_LAYOUT,
  type ShipDoorSpec,
  type ShipLayout,
  type ShipRampInteract,
  type ShipRampMount,
  type ShipSeatSpec,
  type ShipWalkZone,
  type ShipWalkZoneOriented,
} from "../../player/ship_layout";
import { orientedZoneBounds } from "../../player/ship_zone_oriented";
import type { PrefabComponent, PrefabDocument, PrefabEntity } from "./schema";
import type { Vec3 } from "../../types";

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
const DEFAULT_RAMP_OUTSIDE_RADIUS = 3.0;
const DEFAULT_RAMP_DECK_RADIUS = 1.7;
const DEFAULT_CHAIR_RADIUS = 1.45;
const DEFAULT_STAIR_STEPS = 4;
/** Dismount line sits just above the ramp zone's tail edge. */
const RAMP_DISMOUNT_INSET_METERS = 0.05;
/** Mount clamp keeps a fresh mount above the dismount line. */
const RAMP_MOUNT_CLAMP_METERS = 0.6;
/** Ground step-off spot past the ramp tail edge. */
const RAMP_GROUND_OFFSET_METERS = 1.05;

interface CollectedShip {
  hullUrl: string | null;
  restHeight: number | null;
  walkZones: ShipWalkZone[];
  doors: ShipDoorSpec[];
  seats: ShipSeatSpec[];
  rampInteracts: ShipRampInteract[];
  rampMount: ShipRampMount | null;
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
        out.doors.push({
          id: component.id,
          label: component.label,
          motion: component.motion,
          axis: component.axis,
          nodes: component.nodes.map((node) => ({ ...node })),
          interact: { right, up: position.y, forward },
          radius: component.radius ?? DEFAULT_DOOR_RADIUS,
          defaultOpen: component.defaultOpen ?? false,
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

/**
 * Builds the ship layout for a ship prefab. Returns null only when the
 * prefab has no ship components at all. An in-progress prefab (e.g. hull
 * only, no walk zones yet) still yields a layout so previews show the
 * authored ship; deck walking simply stays unavailable until zones exist.
 * Missing primary pilot seat falls back to the built-in Starhopper anchors.
 */
export function buildShipLayoutFromPrefab(
  doc: PrefabDocument,
): ShipLayout | null {
  const out: CollectedShip = {
    hullUrl: null,
    restHeight: null,
    walkZones: [],
    doors: [],
    seats: [],
    rampInteracts: [],
    rampMount: null,
  };
  collect(doc.root, vec3(0, 0, 0), quatIdentity(), vec3(1, 1, 1), out);

  const hasShipContent =
    out.hullUrl !== null ||
    out.walkZones.length > 0 ||
    out.doors.length > 0 ||
    out.seats.length > 0 ||
    out.rampInteracts.length > 0 ||
    out.rampMount !== null;
  if (!hasShipContent) {
    console.warn(
      `Ship prefab "${doc.id}" has no ship components; using the built-in ship.`,
    );
    return null;
  }
  if (out.walkZones.length === 0) {
    console.warn(
      `Ship prefab "${doc.id}" has no ship-walk-zone or ship-stairs components; the deck is not walkable yet.`,
    );
  }
  if (!out.hullUrl) {
    console.warn(
      `Ship prefab "${doc.id}" has no ship-hull component on a model entity; using the built-in hull.`,
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

  const rampZone = out.walkZones.find((zone) => zone.gate === "ramp") ?? null;
  const rampDismountForward = rampZone
    ? rampZone.minForward + RAMP_DISMOUNT_INSET_METERS
    : fallback.rampDismountForward;
  const rampDismountGround = rampZone
    ? {
        right: (rampZone.minRight + rampZone.maxRight) / 2,
        forward: rampZone.minForward - RAMP_GROUND_OFFSET_METERS,
      }
    : fallback.rampDismountGround;

  return {
    hullUrl: out.hullUrl,
    restHeightMeters: out.restHeight,
    walkZones: out.walkZones,
    doors: out.doors,
    seats: out.seats,
    pilotSeat,
    pilotEye,
    seatStand,
    rampInteracts: out.rampInteracts,
    rampMount: out.rampMount,
    rampDismountForward,
    rampDismountGround,
  };
}
