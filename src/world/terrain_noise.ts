import { createNoise3D, type NoiseFunction3D } from 'simplex-noise';

const noiseCache = new Map<number, NoiseFunction3D>();

export function clamp01(value: number): number {
  return Math.max(0, Math.min(1, value));
}

export function clamp(value: number, min: number, max: number): number {
  return Math.max(min, Math.min(max, value));
}

export function getNoise3D(seed: number): NoiseFunction3D {
  if (!noiseCache.has(seed)) {
    let s = seed;
    const random = (): number => {
      s = Math.sin(s) * 10000;
      return s - Math.floor(s);
    };
    noiseCache.set(seed, createNoise3D(random));
  }
  return noiseCache.get(seed)!;
}

export function fbm3d(
  noise3D: NoiseFunction3D,
  x: number,
  y: number,
  z: number,
  octaves: number,
  persistence: number,
  lacunarity: number,
  scale: number,
): number {
  let total = 0;
  let frequency = scale;
  let amplitude = 1;
  let maxValue = 0;
  for (let i = 0; i < octaves; i++) {
    total += noise3D(x * frequency, y * frequency, z * frequency) * amplitude;
    maxValue += amplitude;
    amplitude *= persistence;
    frequency *= lacunarity;
  }
  return total / maxValue;
}

export function ridgedNoise3d(
  noise3D: NoiseFunction3D,
  x: number,
  y: number,
  z: number,
  octaves: number,
  persistence: number,
  lacunarity: number,
  scale: number,
): number {
  let total = 0;
  let frequency = scale;
  let amplitude = 1;
  let maxValue = 0;
  for (let i = 0; i < octaves; i++) {
    let n = noise3D(x * frequency, y * frequency, z * frequency);
    n = 1 - Math.abs(n);
    n *= n;
    total += n * amplitude;
    maxValue += amplitude;
    amplitude *= persistence;
    frequency *= lacunarity;
  }
  return (total / maxValue) * 2 - 1;
}
