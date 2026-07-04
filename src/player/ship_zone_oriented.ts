import { dot, vec3 } from '../math/vec3';
import type { ShipWalkZoneOriented } from './ship_layout';

const CONTAIN_EPS = 0.08;

function clamp(value: number, min: number, max: number): number {
  return Math.max(min, Math.min(max, value));
}

/** Ship-local point from zone-local coordinates (floor center origin). */
export function shipPointFromLocal(
  zone: ShipWalkZoneOriented,
  lx: number,
  ly: number,
  lz: number,
): { right: number; up: number; forward: number } {
  const { origin, axisRight, axisUp, axisForward } = zone;
  return {
    right: origin.right + lx * axisRight.x + ly * axisUp.x + lz * axisForward.x,
    up: origin.up + lx * axisRight.y + ly * axisUp.y + lz * axisForward.y,
    forward: origin.forward + lx * axisRight.z + ly * axisUp.z + lz * axisForward.z,
  };
}

/** Zone-local coordinates from a ship-local point (inverse of an orthonormal rotation). */
export function localPointFromShip(
  zone: ShipWalkZoneOriented,
  right: number,
  up: number,
  forward: number,
): { lx: number; ly: number; lz: number } {
  const delta = vec3(
    right - zone.origin.right,
    up - zone.origin.up,
    forward - zone.origin.forward,
  );
  return {
    lx: dot(delta, zone.axisRight),
    ly: dot(delta, zone.axisUp),
    lz: dot(delta, zone.axisForward),
  };
}

/** Floor height on the zone's bottom face at the given deck footprint. */
export function orientedFloorUpAt(
  zone: ShipWalkZoneOriented,
  right: number,
  forward: number,
): number {
  const dr = right - zone.origin.right;
  const df = forward - zone.origin.forward;
  const { axisUp } = zone;
  if (Math.abs(axisUp.y) < 1e-5) return zone.origin.up;
  const du = -(dr * axisUp.x + df * axisUp.z) / axisUp.y;
  return zone.origin.up + du;
}

/** Whether a ship-local point lies inside the oriented walk volume. */
export function orientedZoneContains(
  zone: ShipWalkZoneOriented,
  right: number,
  forward: number,
  up?: number,
): boolean {
  const floorUp = up ?? orientedFloorUpAt(zone, right, forward);
  const local = localPointFromShip(zone, right, floorUp, forward);
  return (
    Math.abs(local.lx) <= zone.halfWidth + CONTAIN_EPS &&
    Math.abs(local.lz) <= zone.halfDepth + CONTAIN_EPS &&
    local.ly >= -CONTAIN_EPS &&
    local.ly <= zone.height + CONTAIN_EPS
  );
}

/** Axis-aligned ship-local bounds enclosing all eight OBB corners. */
export function orientedZoneBounds(
  zone: ShipWalkZoneOriented,
): {
  minRight: number;
  maxRight: number;
  minForward: number;
  maxForward: number;
  floorUp: number;
  ceilingUp: number;
} {
  let minRight = Infinity;
  let maxRight = -Infinity;
  let minForward = Infinity;
  let maxForward = -Infinity;
  let floorUp = Infinity;
  let ceilingUp = -Infinity;
  const { halfWidth, halfDepth, height } = zone;
  for (const lx of [-halfWidth, halfWidth]) {
    for (const ly of [0, height]) {
      for (const lz of [-halfDepth, halfDepth]) {
        const point = shipPointFromLocal(zone, lx, ly, lz);
        minRight = Math.min(minRight, point.right);
        maxRight = Math.max(maxRight, point.right);
        minForward = Math.min(minForward, point.forward);
        maxForward = Math.max(maxForward, point.forward);
        floorUp = Math.min(floorUp, point.up);
        ceilingUp = Math.max(ceilingUp, point.up);
      }
    }
  }
  return {
    minRight: clamp(minRight, -1e6, 1e6),
    maxRight: clamp(maxRight, -1e6, 1e6),
    minForward: clamp(minForward, -1e6, 1e6),
    maxForward: clamp(maxForward, -1e6, 1e6),
    floorUp: clamp(floorUp, -1e6, 1e6),
    ceilingUp: clamp(ceilingUp, -1e6, 1e6),
  };
}
