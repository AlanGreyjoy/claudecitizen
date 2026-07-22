import { normalize } from '../math/vec3';
import type { Vec3 } from '../types';

export const MAX_BALLISTIC_SEGMENTS = 128;

export type WeaponSurfaceKind = 'terrain' | 'station' | 'ship' | 'other';

export interface BallisticSegment {
  direction: Vec3;
  end: Vec3;
  length: number;
  start: Vec3;
}

export interface BallisticPathRequest {
  bulletGravityMps2: number;
  forward: Vec3;
  maxRangeMeters: number;
  muzzleVelocityMps: number;
  origin: Vec3;
  worldUp: Vec3;
}

export interface WeaponGeometryHit {
  distance: number;
  normal: Vec3;
  point: Vec3;
  surfaceKind: WeaponSurfaceKind;
}

export type BallisticSegmentQuery = (
  origin: Vec3,
  direction: Vec3,
  maxDistance: number,
) => WeaponGeometryHit | null;

function createSegment(): BallisticSegment {
  return {
    direction: { x: 0, y: 0, z: 1 },
    end: { x: 0, y: 0, z: 0 },
    length: 0,
    start: { x: 0, y: 0, z: 0 },
  };
}

/** Reuses `target` so callers can retain one bounded segment buffer. */
export function buildBallisticPath(
  request: BallisticPathRequest,
  target: BallisticSegment[] = [],
): BallisticSegment[] {
  const maxRangeMeters = Math.max(0, request.maxRangeMeters);
  const muzzleVelocityMps = Math.max(0.001, request.muzzleVelocityMps);
  if (maxRangeMeters <= 0) {
    target.length = 0;
    return target;
  }

  const forward = normalize(request.forward);
  const worldUp = normalize(request.worldUp);
  const totalSeconds = maxRangeMeters / muzzleVelocityMps;
  const segmentCount = Math.min(
    MAX_BALLISTIC_SEGMENTS,
    Math.max(1, Math.ceil(maxRangeMeters / 8)),
  );
  let written = 0;
  let startX = request.origin.x;
  let startY = request.origin.y;
  let startZ = request.origin.z;
  for (let index = 1; index <= segmentCount; index += 1) {
    const timeSeconds = (totalSeconds * index) / segmentCount;
    const forwardDistance = muzzleVelocityMps * timeSeconds;
    const dropDistance = 0.5 * request.bulletGravityMps2 * timeSeconds * timeSeconds;
    const endX = request.origin.x + forward.x * forwardDistance - worldUp.x * dropDistance;
    const endY = request.origin.y + forward.y * forwardDistance - worldUp.y * dropDistance;
    const endZ = request.origin.z + forward.z * forwardDistance - worldUp.z * dropDistance;
    const deltaX = endX - startX;
    const deltaY = endY - startY;
    const deltaZ = endZ - startZ;
    const segmentLength = Math.hypot(deltaX, deltaY, deltaZ);
    if (segmentLength > 1e-6) {
      const segment = target[written] ?? createSegment();
      segment.direction.x = deltaX / segmentLength;
      segment.direction.y = deltaY / segmentLength;
      segment.direction.z = deltaZ / segmentLength;
      segment.end.x = endX;
      segment.end.y = endY;
      segment.end.z = endZ;
      segment.length = segmentLength;
      segment.start.x = startX;
      segment.start.y = startY;
      segment.start.z = startZ;
      if (written >= target.length) target.push(segment);
      written += 1;
    }
    startX = endX;
    startY = endY;
    startZ = endZ;
  }
  target.length = written;
  return target;
}

export function resolveBallisticHit(
  segments: readonly BallisticSegment[],
  query: BallisticSegmentQuery,
): WeaponGeometryHit | null {
  let pathDistance = 0;
  for (const segment of segments) {
    const hit = query(segment.start, segment.direction, segment.length);
    if (hit) return { ...hit, distance: pathDistance + Math.max(0, hit.distance) };
    pathDistance += segment.length;
  }
  return null;
}
