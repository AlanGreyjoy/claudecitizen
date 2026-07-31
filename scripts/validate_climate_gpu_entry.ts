/**
 * Browser-side half of the GPU climate validator. Bundled by
 * scripts/validate_climate_gpu.mjs and inlined into a page Electron loads.
 *
 * Unlike scripts/webgpu_noise_spike_entry.ts — which hand-wrote its own WGSL to
 * answer "is this feasible?" — this drives the *production* module at
 * src/render/vegetation/gpu/climate-noise-gpu.ts and the production CPU path,
 * so a regression in either shows up here.
 *
 * Two questions:
 *   1. Do CPU f64 and GPU f32 agree on the three climate fields?
 *   2. Does the f32 delta ever flip `classifyBiome`? PLAN.md listed that as the
 *      named risk of GPU climate: a sample sitting exactly on a biome threshold
 *      could classify differently and change one plant's type. This turns the
 *      worry into a rate, and the runner gates on it.
 */
import { createClimateNoiseGpu } from '../src/render/vegetation/gpu/climate-noise-gpu';
import {
  CLIMATE_NOISE_FIELDS,
  evaluateClimateNoise,
  sampleSurfaceClimate,
  type ClimateNoiseSample,
} from '../src/world/climate';
import type { Biome, Planet, Vec3 } from '../src/types';

const FIELD_NAMES = ['temperature', 'moisture', 'forest'] as const;

/** Earth-ish; only radiusMeters and terrainAmplitudeMeters affect climate. */
const PLANET: Planet = {
  atmosphereHeightMeters: 100_000,
  radiusMeters: 6_371_000,
  terrainAmplitudeMeters: 8_000,
};

/** Fibonacci sphere: deterministic unit vectors, the shape climate sees. */
function makeDirections(count: number): Float32Array<ArrayBuffer> {
  const points = new Float32Array(count * 4);
  const golden = Math.PI * (3 - Math.sqrt(5));
  for (let i = 0; i < count; i += 1) {
    const y = 1 - (i / Math.max(1, count - 1)) * 2;
    const radius = Math.sqrt(Math.max(0, 1 - y * y));
    const theta = golden * i;
    points[i * 4] = Math.cos(theta) * radius;
    points[i * 4 + 1] = y;
    points[i * 4 + 2] = Math.sin(theta) * radius;
  }
  return points;
}

/**
 * Height sweep across the sample set. Fixed heights would park every sample far
 * from the elevation thresholds `classifyBiome` keys on, which is exactly where
 * an f32 delta cannot flip anything — and would report a reassuring zero.
 */
function normalizedHeightFor(index: number, count: number): number {
  return -0.15 + (index / Math.max(1, count - 1)) * 1.15;
}

export interface FieldAgreement {
  name: string;
  maxAbs: number;
  meanAbs: number;
  maxRel: number;
}

export interface BiomeFlip {
  cpu: Biome;
  gpu: Biome;
  temperatureDelta: number;
  moistureDelta: number;
}

export interface ValidateResult {
  ok: boolean;
  error?: string;
  adapter?: string;
  samples?: number;
  agreement?: FieldAgreement[];
  biome?: {
    compared: number;
    flipped: number;
    flipRate: number;
    examples: BiomeFlip[];
  };
  timing?: { cpuMs: number; gpuMs: number; speedup: number };
}

interface ClassifiedSample {
  biome: Biome;
  temperature: number;
  moisture: number;
}

/**
 * Classifies one direction through the real `sampleSurfaceClimate`, with only
 * the noise injected — so this exercises the biome and hydrology logic the
 * engine actually uses, not a transcription of it.
 */
function classifyAt(
  index: number,
  count: number,
  directions: Float32Array,
  noise: ClimateNoiseSample,
  seed: number,
): ClassifiedSample {
  const normalizedHeight = normalizedHeightFor(index, count);
  const position: Vec3 = {
    x: directions[index * 4] * PLANET.radiusMeters,
    y: directions[index * 4 + 1] * PLANET.radiusMeters,
    z: directions[index * 4 + 2] * PLANET.radiusMeters,
  };
  const surface = sampleSurfaceClimate(
    PLANET,
    seed,
    position,
    normalizedHeight * PLANET.terrainAmplitudeMeters,
    undefined,
    noise,
  );
  return {
    biome: surface.biome,
    moisture: surface.moisture,
    temperature: surface.temperature,
  };
}

/** CPU results are packed 3-wide, GPU results 4-wide (vec4 storage stride). */
function noiseAt(values: Float32Array, index: number, stride: number): ClimateNoiseSample {
  const base = index * stride;
  return {
    forest: values[base + 2],
    moisture: values[base + 1],
    temperature: values[base],
  };
}

export async function run(
  sampleCount: number,
  seed: number,
  flipExamples = 8,
): Promise<ValidateResult> {
  if (!navigator.gpu) return { ok: false, error: 'navigator.gpu undefined' };
  const adapter = await navigator.gpu.requestAdapter({
    powerPreference: 'high-performance',
  });
  if (!adapter) return { ok: false, error: 'requestAdapter() returned null' };
  const info = adapter.info ?? ({} as Record<string, string>);

  const kernel = await createClimateNoiseGpu(seed);
  if (!kernel) return { ok: false, error: 'createClimateNoiseGpu() returned null' };

  const directions = makeDirections(sampleCount);

  const cpuStart = performance.now();
  const cpu = new Float32Array(sampleCount * 3);
  for (let i = 0; i < sampleCount; i += 1) {
    const sample = evaluateClimateNoise(
      seed,
      directions[i * 4],
      directions[i * 4 + 1],
      directions[i * 4 + 2],
    );
    cpu[i * 3] = sample.temperature;
    cpu[i * 3 + 1] = sample.moisture;
    cpu[i * 3 + 2] = sample.forest;
  }
  const cpuMs = performance.now() - cpuStart;

  const gpuStart = performance.now();
  const gpu = await kernel.evaluate(directions, sampleCount);
  const gpuMs = performance.now() - gpuStart;
  kernel.dispose();

  const agreement: FieldAgreement[] = FIELD_NAMES.map((name, field) => {
    let maxAbs = 0;
    let maxRel = 0;
    let sumAbs = 0;
    for (let i = 0; i < sampleCount; i += 1) {
      const abs = Math.abs(cpu[i * 3 + field] - gpu[i * 4 + field]);
      sumAbs += abs;
      if (abs > maxAbs) maxAbs = abs;
      const rel = abs / Math.max(1e-6, Math.abs(cpu[i * 3 + field]));
      if (rel > maxRel) maxRel = rel;
    }
    return { maxAbs, maxRel, meanAbs: sumAbs / sampleCount, name };
  });

  let flipped = 0;
  const examples: BiomeFlip[] = [];
  for (let i = 0; i < sampleCount; i += 1) {
    const cpuSample = classifyAt(i, sampleCount, directions, noiseAt(cpu, i, 3), seed);
    const gpuSample = classifyAt(i, sampleCount, directions, noiseAt(gpu, i, 4), seed);
    if (cpuSample.biome === gpuSample.biome) continue;
    flipped += 1;
    if (examples.length < flipExamples) {
      examples.push({
        cpu: cpuSample.biome,
        gpu: gpuSample.biome,
        moistureDelta: Math.abs(cpuSample.moisture - gpuSample.moisture),
        temperatureDelta: Math.abs(cpuSample.temperature - gpuSample.temperature),
      });
    }
  }

  return {
    adapter: `${info.vendor ?? '?'}/${info.architecture ?? '?'}`,
    agreement,
    biome: {
      compared: sampleCount,
      examples,
      flipped,
      flipRate: flipped / sampleCount,
    },
    ok: true,
    samples: sampleCount,
    timing: { cpuMs, gpuMs, speedup: cpuMs / gpuMs },
  };
}

// Referenced so the field-name table cannot silently drift from the specs the
// kernel and CPU path share.
if (FIELD_NAMES.length !== CLIMATE_NOISE_FIELDS.length) {
  throw new Error('climate field name table is out of sync with CLIMATE_NOISE_FIELDS');
}
