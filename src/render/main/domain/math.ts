import * as THREE from 'three';
import type { Vec3 } from '../../../types';

export function v3(v: Vec3): THREE.Vector3 {
  return new THREE.Vector3(v.x, v.y, v.z);
}

export function clamp01(value: number): number {
  return Math.max(0, Math.min(1, value));
}
