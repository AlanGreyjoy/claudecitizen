import type { Vec3 } from '../../../types';
import { cross, normalize } from '../../../math/vec3';
import { buildSurfaceFrame } from './surface_frame';

export function composeInstanceMatrix(
  position: Vec3,
  normal: Vec3,
  yawRadians: number,
  uniformScale: number,
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

  const matrix = new Float32Array(16);
  matrix[0] = xAxis.x * uniformScale;
  matrix[1] = xAxis.y * uniformScale;
  matrix[2] = xAxis.z * uniformScale;
  matrix[3] = 0;
  matrix[4] = normal.x * uniformScale;
  matrix[5] = normal.y * uniformScale;
  matrix[6] = normal.z * uniformScale;
  matrix[7] = 0;
  matrix[8] = zAxis.x * uniformScale;
  matrix[9] = zAxis.y * uniformScale;
  matrix[10] = zAxis.z * uniformScale;
  matrix[11] = 0;
  matrix[12] = position.x;
  matrix[13] = position.y;
  matrix[14] = position.z;
  matrix[15] = 1;
  return matrix;
}
