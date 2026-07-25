import type { Vec3 } from '../../../types';
import { cross, normalize } from '../../../math/vec3';

const WORLD_UP: Vec3 = { x: 0, y: 1, z: 0 };
const WORLD_RIGHT: Vec3 = { x: 1, y: 0, z: 0 };

export function buildSurfaceFrame(normal: Vec3): { tangent: Vec3; bitangent: Vec3 } {
  const reference = Math.abs(normal.y) > 0.92 ? WORLD_RIGHT : WORLD_UP;
  const tangent = normalize(cross(reference, normal));
  const bitangent = normalize(cross(normal, tangent));
  return { tangent, bitangent };
}
