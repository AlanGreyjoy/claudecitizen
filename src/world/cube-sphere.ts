import { normalize, vec3 } from '../math/vec3';
import type { CubeFace, Vec3 } from '../types';

export const CUBE_FACES: CubeFace[] = ['px', 'nx', 'py', 'ny', 'pz', 'nz'];

export function dominantCubeFace(position: Vec3): CubeFace {
  const ax = Math.abs(position.x);
  const ay = Math.abs(position.y);
  const az = Math.abs(position.z);
  if (ax >= ay && ax >= az) return position.x >= 0 ? 'px' : 'nx';
  if (ay >= ax && ay >= az) return position.y >= 0 ? 'py' : 'ny';
  return position.z >= 0 ? 'pz' : 'nz';
}

export function directionFromCubeFace(face: CubeFace, u: number, v: number): Vec3 {
  if (face === 'px') return normalize(vec3(1, v, -u));
  if (face === 'nx') return normalize(vec3(-1, v, u));
  if (face === 'py') return normalize(vec3(u, 1, -v));
  if (face === 'ny') return normalize(vec3(u, -1, v));
  if (face === 'pz') return normalize(vec3(u, v, 1));
  return normalize(vec3(-u, v, -1));
}

export function faceUvFromDirection(direction: Vec3): { face: CubeFace; u: number; v: number } {
  const face = dominantCubeFace(direction);
  const ax = Math.abs(direction.x) || 1;
  const ay = Math.abs(direction.y) || 1;
  const az = Math.abs(direction.z) || 1;

  if (face === 'px') return { face, u: -direction.z / ax, v: direction.y / ax };
  if (face === 'nx') return { face, u: direction.z / ax, v: direction.y / ax };
  if (face === 'py') return { face, u: direction.x / ay, v: -direction.z / ay };
  if (face === 'ny') return { face, u: direction.x / ay, v: direction.z / ay };
  if (face === 'pz') return { face, u: direction.x / az, v: direction.y / az };
  return { face, u: -direction.x / az, v: direction.y / az };
}
