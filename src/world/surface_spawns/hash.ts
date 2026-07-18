export function hash01(seed: number, ...values: number[]): number {
  let state = seed >>> 0;
  for (const value of values) {
    state ^= value + 0x9e3779b9 + ((state << 6) >>> 0) + (state >>> 2);
    state = Math.imul(state ^ (state >>> 16), 0x45d9f3b);
    state >>>= 0;
  }
  state ^= state >>> 16;
  state = Math.imul(state, 0x85ebca6b) >>> 0;
  state ^= state >>> 13;
  state = Math.imul(state, 0xc2b2ae35) >>> 0;
  state ^= state >>> 16;
  return state / 0xffffffff;
}

export function clamp01(value: number): number {
  return Math.max(0, Math.min(1, value));
}

export function lerp(start: number, end: number, t: number): number {
  return start + (end - start) * t;
}

export function scaledSampleCount(
  baseCount: number,
  densityMultiplier: number,
): number {
  return Math.max(0, Math.round(baseCount * densityMultiplier));
}
