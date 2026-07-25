import type { Vec3 } from '../../types';
import { cross, normalize } from '../../math/vec3';

const WORLD_UP: Vec3 = { x: 0, y: 1, z: 0 };
const WORLD_RIGHT: Vec3 = { x: 1, y: 0, z: 0 };

function buildSurfaceFrame(normal: Vec3): { tangent: Vec3; bitangent: Vec3 } {
  // Prefer a continuous east-like tangent on the planet; only fall back near
  // the poles where cross(WORLD_UP, normal) vanishes.
  let tangent = cross(WORLD_UP, normal);
  const tangentLenSq = tangent.x * tangent.x + tangent.y * tangent.y + tangent.z * tangent.z;
  if (tangentLenSq < 1e-10) {
    tangent = cross(WORLD_RIGHT, normal);
  }
  tangent = normalize(tangent);
  const bitangent = normalize(cross(normal, tangent));
  return { tangent, bitangent };
}

/** Column-major 4x4: X = tangent, Y = normal (up), Z = bitangent. */
export function composeSurfaceSpawnMatrix(
  position: Vec3,
  normal: Vec3,
  yawRadians: number,
  uniformScale: number,
  out: Float32Array = new Float32Array(16),
): Float32Array {
  const { tangent, bitangent } = buildSurfaceFrame(normal);
  const cos = Math.cos(yawRadians);
  const sin = Math.sin(yawRadians);
  const xAxis = normalize({
    x: tangent.x * cos + bitangent.x * sin,
    y: tangent.y * cos + bitangent.y * sin,
    z: tangent.z * cos + bitangent.z * sin,
  });
  const zAxis = normalize(cross(xAxis, normal));

  out[0] = xAxis.x * uniformScale;
  out[1] = xAxis.y * uniformScale;
  out[2] = xAxis.z * uniformScale;
  out[3] = 0;
  out[4] = normal.x * uniformScale;
  out[5] = normal.y * uniformScale;
  out[6] = normal.z * uniformScale;
  out[7] = 0;
  out[8] = zAxis.x * uniformScale;
  out[9] = zAxis.y * uniformScale;
  out[10] = zAxis.z * uniformScale;
  out[11] = 0;
  out[12] = position.x;
  out[13] = position.y;
  out[14] = position.z;
  out[15] = 1;
  return out;
}
