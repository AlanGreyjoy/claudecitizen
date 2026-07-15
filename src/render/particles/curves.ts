import type {
  PrefabColor,
  PrefabCurve,
  PrefabGradient,
  PrefabMinMax,
} from "../../world/prefabs/schema";

export function sampleMinMax(value: PrefabMinMax, rand01: number): number {
  if (value.mode === "constant") return value.value;
  return value.min + (value.max - value.min) * rand01;
}

export function sampleCurve(curve: PrefabCurve, t: number): number {
  if (curve.length === 0) return 1;
  if (curve.length === 1) return curve[0].value;
  const x = Math.min(1, Math.max(0, t));
  let i = 0;
  while (i < curve.length - 1 && curve[i + 1].t < x) i += 1;
  const a = curve[i];
  const b = curve[Math.min(curve.length - 1, i + 1)];
  if (b.t <= a.t) return b.value;
  const u = (x - a.t) / (b.t - a.t);
  return a.value + (b.value - a.value) * u;
}

function hexToRgb(color: PrefabColor): { r: number; g: number; b: number } {
  const n = Number.parseInt(color.slice(1), 16);
  return {
    r: ((n >> 16) & 255) / 255,
    g: ((n >> 8) & 255) / 255,
    b: (n & 255) / 255,
  };
}

export interface SampledColor {
  r: number;
  g: number;
  b: number;
  a: number;
}

export function sampleGradient(gradient: PrefabGradient, t: number): SampledColor {
  if (gradient.length === 0) return { r: 1, g: 1, b: 1, a: 1 };
  if (gradient.length === 1) {
    const rgb = hexToRgb(gradient[0].color);
    return { ...rgb, a: gradient[0].alpha ?? 1 };
  }
  const x = Math.min(1, Math.max(0, t));
  let i = 0;
  while (i < gradient.length - 1 && gradient[i + 1].t < x) i += 1;
  const a = gradient[i];
  const b = gradient[Math.min(gradient.length - 1, i + 1)];
  const aRgb = hexToRgb(a.color);
  const bRgb = hexToRgb(b.color);
  const aA = a.alpha ?? 1;
  const bA = b.alpha ?? 1;
  if (b.t <= a.t) return { ...bRgb, a: bA };
  const u = (x - a.t) / (b.t - a.t);
  return {
    r: aRgb.r + (bRgb.r - aRgb.r) * u,
    g: aRgb.g + (bRgb.g - aRgb.g) * u,
    b: aRgb.b + (bRgb.b - aRgb.b) * u,
    a: aA + (bA - aA) * u,
  };
}

export function hash01(seed: number): number {
  const x = Math.sin(seed * 12.9898 + 78.233) * 43758.5453;
  return x - Math.floor(x);
}
