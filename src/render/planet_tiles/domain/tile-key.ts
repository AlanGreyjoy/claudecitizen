import type { CubeFace } from '../../../types';

export function clamp01(value: number): number {
  return Math.max(0, Math.min(1, value));
}

export function clamp(value: number, min: number, max: number): number {
  return Math.max(min, Math.min(max, value));
}

export function tileKey(face: CubeFace, level: number, x: number, y: number): string {
  return `${face}:${level}:${x}:${y}`;
}

export function tileBounds(level: number, x: number, y: number) {
  const tileCount = 2 ** level;
  const step = 2 / tileCount;
  const u0 = -1 + x * step;
  const v0 = -1 + y * step;
  return {
    u0,
    u1: u0 + step,
    v0,
    v1: v0 + step,
  };
}
