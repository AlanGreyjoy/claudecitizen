import { cross, normalize, scale, vec3 } from '../math/vec3';
import type { Vec3 } from '../types';

export function cartesianFromLatLonAlt(
  latRadians: number,
  lonRadians: number,
  altitudeMeters: number,
  radiusMeters: number,
): Vec3 {
  const surfaceRadius = radiusMeters + altitudeMeters;
  const cosLat = Math.cos(latRadians);
  return vec3(
    surfaceRadius * cosLat * Math.cos(lonRadians),
    surfaceRadius * Math.sin(latRadians),
    surfaceRadius * cosLat * Math.sin(lonRadians),
  );
}

export function radialUp(position: Vec3): Vec3 {
  return normalize(position);
}

export function eastVector(position: Vec3): Vec3 {
  const up = radialUp(position);
  const worldNorth = vec3(0, 1, 0);
  const east = cross(worldNorth, up);
  if (Math.hypot(east.x, east.y, east.z) < 1e-9) return vec3(1, 0, 0);
  return normalize(east);
}

export function altitudeForPosition(position: Vec3, radiusMeters: number): number {
  return Math.hypot(position.x, position.y, position.z) - radiusMeters;
}

export function latLonForPosition(position: Vec3): { latRadians: number; lonRadians: number } {
  const unit = radialUp(position);
  return {
    latRadians: Math.asin(unit.y),
    lonRadians: Math.atan2(unit.z, unit.x),
  };
}

export function surfacePointFromPosition(position: Vec3, surfaceRadius: number): Vec3 {
  return scale(radialUp(position), surfaceRadius);
}

export function rebasePosition(position: Vec3, origin: Vec3): Vec3 {
  return vec3(position.x - origin.x, position.y - origin.y, position.z - origin.z);
}
