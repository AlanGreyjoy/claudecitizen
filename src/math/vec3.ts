import type { Vec3 } from '../types';

export function vec3(x = 0, y = 0, z = 0): Vec3 {
  return { x, y, z };
}

export function add(a: Vec3, b: Vec3): Vec3 {
  return vec3(a.x + b.x, a.y + b.y, a.z + b.z);
}

export function sub(a: Vec3, b: Vec3): Vec3 {
  return vec3(a.x - b.x, a.y - b.y, a.z - b.z);
}

export function scale(a: Vec3, scalar: number): Vec3 {
  return vec3(a.x * scalar, a.y * scalar, a.z * scalar);
}

export function dot(a: Vec3, b: Vec3): number {
  return a.x * b.x + a.y * b.y + a.z * b.z;
}

export function cross(a: Vec3, b: Vec3): Vec3 {
  return vec3(
    a.y * b.z - a.z * b.y,
    a.z * b.x - a.x * b.z,
    a.x * b.y - a.y * b.x,
  );
}

export function length(a: Vec3): number {
  return Math.hypot(a.x, a.y, a.z);
}

export function normalize(a: Vec3): Vec3 {
  const len = length(a);
  if (len < 1e-9) return vec3(0, 1, 0);
  return scale(a, 1 / len);
}

export function distance(a: Vec3, b: Vec3): number {
  return length(sub(a, b));
}

export function withLength(a: Vec3, desiredLength: number): Vec3 {
  return scale(normalize(a), desiredLength);
}

export function lerp(a: Vec3, b: Vec3, t: number): Vec3 {
  return vec3(
    a.x + (b.x - a.x) * t,
    a.y + (b.y - a.y) * t,
    a.z + (b.z - a.z) * t,
  );
}

export function rotateAroundAxis(v: Vec3, axis: Vec3, radians: number): Vec3 {
  const unitAxis = normalize(axis);
  const cos = Math.cos(radians);
  const sin = Math.sin(radians);
  const term1 = scale(v, cos);
  const term2 = scale(cross(unitAxis, v), sin);
  const term3 = scale(unitAxis, dot(unitAxis, v) * (1 - cos));
  return add(add(term1, term2), term3);
}
