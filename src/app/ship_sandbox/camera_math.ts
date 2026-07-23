import * as THREE from 'three';
import { cross, normalize, rotateAroundAxis, scale, add } from '../../math/vec3';
import type { Vec3 } from '../../types';
import { resolveSeatLookForward } from '../../flight/flight_aim';
import { SHIP_FORWARD, WORLD_UP } from './types';

export function clamp(value: number, min: number, max: number): number {
  return Math.max(min, Math.min(max, value));
}

export function smoothVector(
  current: THREE.Vector3,
  target: THREE.Vector3,
  dt: number,
  halfLife: number,
): void {
  if (dt <= 0) return;
  const smoothness = Math.LN2 / halfLife;
  const blend = 1 - Math.exp(-smoothness * dt);
  current.lerp(target, blend);
}

export function resolveSandboxOrbit(
  yawRadians: number,
  pitchRadians: number,
  pitchLimit: number,
) {
  const right0 = normalize(cross(SHIP_FORWARD, WORLD_UP));
  const deckYaw = -yawRadians;
  const planarForward = normalize(
    add(
      scale(SHIP_FORWARD, Math.cos(deckYaw)),
      scale(right0, Math.sin(deckYaw)),
    ),
  );
  const right = normalize(cross(planarForward, WORLD_UP));
  const clampedPitch = clamp(pitchRadians, -pitchLimit, pitchLimit);
  return {
    forward: normalize(rotateAroundAxis(planarForward, right, clampedPitch)),
    pitchRadians: clampedPitch,
    right,
    up: WORLD_UP,
  };
}

export function resolveShipSeatLook(
  shipForward: Vec3,
  shipUp: Vec3,
  yawRadians: number,
  pitchRadians: number,
  pitchLimit: number,
) {
  return resolveSeatLookForward(
    shipForward,
    shipUp,
    yawRadians,
    pitchRadians,
    pitchLimit,
  );
}
