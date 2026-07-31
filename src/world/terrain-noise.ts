import {
  buildPermutationTable,
  createNoise3D,
  type NoiseFunction3D,
} from 'simplex-noise';

const noiseCache = new Map<number, NoiseFunction3D>();

/** Entries in a permutation table, and in each gradient component array. */
export const NOISE_TABLE_SIZE = 512;

/**
 * `grad3` from simplex-noise, which is module-private there. `createNoise3D`
 * indexes it with `(perm[i] % 12) * 3`; `buildNoiseTable` reproduces that.
 */
const GRAD3 = [
  1, 1, 0, -1, 1, 0, 1, -1, 0, -1, -1, 0,
  1, 0, 1, -1, 0, 1, 1, 0, -1, -1, 0, -1,
  0, 1, 1, 0, -1, 1, 0, 1, -1, 0, -1, -1,
];

export interface BandLimitedNoise3dInput {
  lacunarity: number;
  maxFrequency: number;
  noise3D: NoiseFunction3D;
  octaves: number;
  persistence: number;
  scale: number;
  x: number;
  y: number;
  z: number;
}

export function clamp01(value: number): number {
  return Math.max(0, Math.min(1, value));
}

export function clamp(value: number, min: number, max: number): number {
  return Math.max(min, Math.min(max, value));
}

function createMulberry32(seed: number): () => number {
  let state = seed >>> 0;
  return () => {
    state = (state + 0x6d2b79f5) | 0;
    let value = state;
    value = Math.imul(value ^ (value >>> 15), value | 1);
    value ^= value + Math.imul(value ^ (value >>> 7), value | 61);
    return ((value ^ (value >>> 14)) >>> 0) / 4_294_967_296;
  };
}

export function getNoise3D(seed: number): NoiseFunction3D {
  // Single lookup: this runs several times per surface sample, so the extra
  // `has` probe was doubling the map traffic of every terrain vertex.
  let noise = noiseCache.get(seed);
  if (noise === undefined) {
    noise = createNoise3D(createMulberry32(seed));
    noiseCache.set(seed, noise);
  }
  return noise;
}

export interface NoiseTable {
  /** Permutation table, exactly the one `getNoise3D(seed)` closed over. */
  perm: Uint8Array;
  /** Per-entry gradient as xyz0, `NOISE_TABLE_SIZE` vec4s. */
  grad: Float32Array;
}

/**
 * The permutation and gradient tables behind `getNoise3D(seed)`, as plain data.
 *
 * Exists so a non-JS evaluator — the WGSL climate kernel in
 * `render/vegetation/gpu/` — can be handed the *same* tables rather than
 * re-deriving them from a copied RNG. A second copy of the generator is exactly
 * the drift that would change every planet's biome layout without any visible
 * error, so this is the only sanctioned way to get at them.
 *
 * `grad` is padded to vec4 because WGSL's storage-buffer layout rules give
 * `array<vec3<f32>>` a 16-byte stride anyway.
 */
export function buildNoiseTable(seed: number): NoiseTable {
  const perm = buildPermutationTable(createMulberry32(seed));
  const grad = new Float32Array(NOISE_TABLE_SIZE * 4);
  for (let index = 0; index < NOISE_TABLE_SIZE; index += 1) {
    const gradientOffset = (perm[index] % 12) * 3;
    grad[index * 4] = GRAD3[gradientOffset];
    grad[index * 4 + 1] = GRAD3[gradientOffset + 1];
    grad[index * 4 + 2] = GRAD3[gradientOffset + 2];
  }
  return { grad, perm };
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

export function fbm3dBandLimited(input: BandLimitedNoise3dInput): number {
  const {
    lacunarity,
    maxFrequency,
    noise3D,
    octaves,
    persistence,
    scale: initialScale,
    x,
    y,
    z,
  } = input;
  let total = 0;
  let frequency = initialScale;
  let amplitude = 1;
  let maximumAmplitude = 0;
  for (let i = 0; i < octaves; i += 1) {
    if (frequency <= maxFrequency) {
      total += noise3D(x * frequency, y * frequency, z * frequency) * amplitude;
    }
    maximumAmplitude += amplitude;
    amplitude *= persistence;
    frequency *= lacunarity;
  }
  return maximumAmplitude > 0 ? total / maximumAmplitude : 0;
}

export function ridgedNoise3dBandLimited(input: BandLimitedNoise3dInput): number {
  const {
    lacunarity,
    maxFrequency,
    noise3D,
    octaves,
    persistence,
    scale: initialScale,
    x,
    y,
    z,
  } = input;
  let total = 0;
  let frequency = initialScale;
  let amplitude = 1;
  let maximumAmplitude = 0;
  for (let i = 0; i < octaves; i += 1) {
    if (frequency <= maxFrequency) {
      let noise = noise3D(x * frequency, y * frequency, z * frequency);
      noise = 1 - Math.abs(noise);
      noise *= noise;
      total += noise * amplitude;
    } else {
      // A neutral 0.5 contribution maps to zero after the final [-1, 1]
      // remap. Replacing that residual as an octave becomes resolvable avoids
      // changing the weight of every already-resolved ridge octave.
      total += amplitude * 0.5;
    }
    maximumAmplitude += amplitude;
    amplitude *= persistence;
    frequency *= lacunarity;
  }
  return maximumAmplitude > 0 ? (total / maximumAmplitude) * 2 - 1 : 0;
}

export function maximumNoiseFrequencyForSpacing(
  planetRadiusMeters: number,
  sampleSpacingMeters: number,
): number {
  return planetRadiusMeters / Math.max(sampleSpacingMeters * 2, 1);
}
