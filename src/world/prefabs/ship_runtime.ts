import { mulQuat, quatIdentity, rotateVec3ByQuat, type Quat } from '../../math/quat';
import { vec3 } from '../../math/vec3';
import {
  DEFAULT_SHIP_LAYOUT,
  type ShipDoorSpec,
  type ShipLayout,
  type ShipRampInteract,
  type ShipRampMount,
  type ShipWalkZone,
} from '../../player/ship_layout';
import type { PrefabDocument, PrefabEntity } from './schema';
import type { Vec3 } from '../../types';

/**
 * Derives the ship gameplay layout (walk zones, doors, pilot seat, ramp
 * anchors, hull url) from a ship prefab's components.
 *
 * Prefab/scene axes map to ship-local gameplay axes as right = -x, up = y,
 * forward = z (matching the render group orientation from
 * updateShipPlacement). Zones and mounts are axis-aligned in ship space;
 * entity rotation is ignored for them.
 */

const DEFAULT_ZONE_HEIGHT = 3.1;
const DEFAULT_DOOR_RADIUS = 1.6;
const DEFAULT_RAMP_OUTSIDE_RADIUS = 3.0;
const DEFAULT_RAMP_DECK_RADIUS = 1.7;
const DEFAULT_CHAIR_RADIUS = 1.45;
/** Chair prompt anchor sits just behind the seat so you interact standing. */
const CHAIR_INTERACT_BACKSET_METERS = 0.5;
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
  pilotSeat: { right: number; up: number; forward: number } | null;
  pilotEye: { right: number; up: number; forward: number } | null;
  seatStand: { right: number; forward: number } | null;
  chairRadius: number;
  rampInteracts: ShipRampInteract[];
  rampMount: ShipRampMount | null;
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
      case 'ship-hull':
        if (entity.asset) out.hullUrl ??= entity.asset.url;
        if (component.restHeight !== undefined) out.restHeight ??= component.restHeight;
        break;
      case 'ship-walk-zone': {
        // Extents scale with the entity so the runtime matches the editor
        // gizmo; scene x-range [minX, maxX] flips into ship right as
        // [-maxX, -minX].
        const minX = position.x + component.min.x * scale.x;
        const maxX = position.x + component.max.x * scale.x;
        out.walkZones.push({
          id: component.zoneId,
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
        });
        break;
      }
      case 'ship-door':
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
      case 'pilot-seat': {
        out.pilotSeat = { right, up: position.y, forward };
        const eye = component.eye ?? { x: 0, y: 0.87, z: 0.25 };
        out.pilotEye = {
          right: -(position.x + eye.x),
          up: position.y + eye.y,
          forward: position.z + eye.z,
        };
        const stand = component.stand ?? { x: 0, z: -1.55 };
        out.seatStand = {
          right: -(position.x + stand.x),
          forward: position.z + stand.z,
        };
        out.chairRadius = component.interactRadius ?? DEFAULT_CHAIR_RADIUS;
        break;
      }
      case 'ramp-interact':
        out.rampInteracts.push({
          placement: component.placement,
          right,
          forward,
          radius:
            component.radius ??
            (component.placement === 'outside'
              ? DEFAULT_RAMP_OUTSIDE_RADIUS
              : DEFAULT_RAMP_DECK_RADIUS),
        });
        break;
      case 'ramp-mount': {
        const minX = position.x + component.min.x * scale.x;
        const maxX = position.x + component.max.x * scale.x;
        const minForward = position.z + component.min.z * scale.z;
        const maxForward = position.z + component.max.z * scale.z;
        out.rampMount = {
          minRight: -maxX,
          maxRight: -minX,
          minForward,
          maxForward,
          clampForward: Math.min(maxForward, minForward + RAMP_MOUNT_CLAMP_METERS),
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

/**
 * Builds the ship layout for a ship prefab. Returns null only when the
 * prefab has no ship components at all. An in-progress prefab (e.g. hull
 * only, no walk zones yet) still yields a layout so previews show the
 * authored ship; deck walking simply stays unavailable until zones exist.
 * Missing seat anchors fall back to the built-in Starhopper values.
 */
export function buildShipLayoutFromPrefab(doc: PrefabDocument): ShipLayout | null {
  const out: CollectedShip = {
    hullUrl: null,
    restHeight: null,
    walkZones: [],
    doors: [],
    pilotSeat: null,
    pilotEye: null,
    seatStand: null,
    chairRadius: DEFAULT_CHAIR_RADIUS,
    rampInteracts: [],
    rampMount: null,
  };
  collect(doc.root, vec3(0, 0, 0), quatIdentity(), vec3(1, 1, 1), out);

  const hasShipContent =
    out.hullUrl !== null ||
    out.walkZones.length > 0 ||
    out.doors.length > 0 ||
    out.pilotSeat !== null ||
    out.rampInteracts.length > 0 ||
    out.rampMount !== null;
  if (!hasShipContent) {
    console.warn(`Ship prefab "${doc.id}" has no ship components; using the built-in ship.`);
    return null;
  }
  if (out.walkZones.length === 0) {
    console.warn(
      `Ship prefab "${doc.id}" has no ship-walk-zone components; the deck is not walkable yet.`,
    );
  }
  if (!out.hullUrl) {
    console.warn(
      `Ship prefab "${doc.id}" has no ship-hull component on a model entity; using the built-in hull.`,
    );
  }

  const fallback = DEFAULT_SHIP_LAYOUT;
  if (!out.pilotSeat) {
    console.warn(`Ship prefab "${doc.id}" has no pilot-seat; using the built-in seat anchors.`);
  }
  const pilotSeat = out.pilotSeat ?? fallback.pilotSeat;
  const pilotEye = out.pilotEye ?? fallback.pilotEye;
  const seatStand = out.seatStand ?? fallback.seatStand;

  // Ramp geometry derives from the first ramp-gated zone; ships without a
  // boarding ramp (or with it unauthored yet) simply lose ramp interactions.
  const rampZone = out.walkZones.find((zone) => zone.gate === 'ramp') ?? null;
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
    pilotSeat,
    pilotEye,
    seatStand,
    chairInteract: {
      right: pilotSeat.right,
      forward: pilotSeat.forward - CHAIR_INTERACT_BACKSET_METERS,
      radius: out.chairRadius,
    },
    rampInteracts: out.rampInteracts,
    rampMount: out.rampMount,
    rampDismountForward,
    rampDismountGround,
  };
}
