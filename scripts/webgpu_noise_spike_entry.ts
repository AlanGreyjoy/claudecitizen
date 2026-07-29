/**
 * Browser-side half of the WebGPU noise spike. Bundled by
 * scripts/webgpu_noise_spike.mjs and inlined into a page that Electron loads.
 *
 * Question it answers: can a WGSL compute port of our simplex/fbm kernel
 * reproduce the CPU result closely enough to trust, and is it faster once the
 * readback is paid for?
 *
 * The workload mirrors sampleSurfaceClimate() in src/world/climate.ts, which
 * per sample runs exactly three fbm3d calls (3 + 4 + 3 = 10 simplex-3D
 * evaluations). tile-data.ts names that sampling as the dominant tile build
 * cost and coarse-grids it to 6x6 to afford it.
 */
import { buildPermutationTable } from 'simplex-noise';
import { fbm3d, getNoise3D } from '../src/world/terrain-noise';

// Matches climate.ts: getNoise3D(seed + 1234 | 5678 | FOREST_NOISE_SEED_OFFSET).
// FOREST_NOISE_SEED_OFFSET is module-private, so the spike pins its own value;
// the number only has to be consistent between the CPU and GPU sides here.
const FOREST_OFFSET = 91_734;

interface FieldSpec {
  readonly name: string;
  readonly seedOffset: number;
  readonly octaves: number;
  readonly persistence: number;
  readonly lacunarity: number;
  readonly scale: number;
}

/** The three fbm3d calls at climate.ts:181, :187, :194. */
const FIELDS: readonly FieldSpec[] = [
  { name: 'temperature', seedOffset: 1234, octaves: 3, persistence: 0.5, lacunarity: 2.0, scale: 2.0 },
  { name: 'moisture', seedOffset: 5678, octaves: 4, persistence: 0.5, lacunarity: 2.0, scale: 1.5 },
  { name: 'forest', seedOffset: FOREST_OFFSET, octaves: 3, persistence: 0.5, lacunarity: 2.0, scale: 3.0 },
];

const PERM_SIZE = 512;

/** Copy of the private createMulberry32 in src/world/terrain-noise.ts. */
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

// grad3 is module-private in simplex-noise; this is the same table its
// createNoise3D() indexes with (v % 12) * 3.
const GRAD3 = new Float64Array([
  1, 1, 0, -1, 1, 0, 1, -1, 0, -1, -1, 0,
  1, 0, 1, -1, 0, 1, 1, 0, -1, -1, 0, -1,
  0, 1, 1, 0, -1, 1, 0, 1, -1, 0, -1, -1,
]);

interface NoiseTable {
  perm: Uint8Array;
  gradX: Float64Array;
  gradY: Float64Array;
  gradZ: Float64Array;
}

function buildTable(seed: number): NoiseTable {
  const perm = buildPermutationTable(createMulberry32(seed));
  const gradX = new Float64Array(PERM_SIZE);
  const gradY = new Float64Array(PERM_SIZE);
  const gradZ = new Float64Array(PERM_SIZE);
  for (let i = 0; i < PERM_SIZE; i += 1) {
    const g = (perm[i] % 12) * 3;
    gradX[i] = GRAD3[g];
    gradY[i] = GRAD3[g + 1];
    gradZ[i] = GRAD3[g + 2];
  }
  return { perm, gradX, gradY, gradZ };
}

/**
 * Reimplementation of simplex-noise's createNoise3D closure, driven by an
 * explicit table. Only used to prove the table we hand the GPU reproduces the
 * engine's own getNoise3D bit-for-bit before any GPU result is trusted.
 */
function simplex3(table: NoiseTable, x: number, y: number, z: number): number {
  const F3 = 1.0 / 3.0;
  const G3 = 1.0 / 6.0;
  const { perm, gradX, gradY, gradZ } = table;

  const s = (x + y + z) * F3;
  const i = Math.floor(x + s) | 0;
  const j = Math.floor(y + s) | 0;
  const k = Math.floor(z + s) | 0;
  const t = (i + j + k) * G3;
  const x0 = x - (i - t);
  const y0 = y - (j - t);
  const z0 = z - (k - t);

  let i1: number, j1: number, k1: number, i2: number, j2: number, k2: number;
  if (x0 >= y0) {
    if (y0 >= z0) { i1 = 1; j1 = 0; k1 = 0; i2 = 1; j2 = 1; k2 = 0; }
    else if (x0 >= z0) { i1 = 1; j1 = 0; k1 = 0; i2 = 1; j2 = 0; k2 = 1; }
    else { i1 = 0; j1 = 0; k1 = 1; i2 = 1; j2 = 0; k2 = 1; }
  } else {
    if (y0 < z0) { i1 = 0; j1 = 0; k1 = 1; i2 = 0; j2 = 1; k2 = 1; }
    else if (x0 < z0) { i1 = 0; j1 = 1; k1 = 0; i2 = 0; j2 = 1; k2 = 1; }
    else { i1 = 0; j1 = 1; k1 = 0; i2 = 1; j2 = 1; k2 = 0; }
  }

  const x1 = x0 - i1 + G3, y1 = y0 - j1 + G3, z1 = z0 - k1 + G3;
  const x2 = x0 - i2 + 2 * G3, y2 = y0 - j2 + 2 * G3, z2 = z0 - k2 + 2 * G3;
  const x3 = x0 - 1 + 3 * G3, y3 = y0 - 1 + 3 * G3, z3 = z0 - 1 + 3 * G3;

  const ii = i & 255, jj = j & 255, kk = k & 255;
  let n = 0;

  let t0 = 0.6 - x0 * x0 - y0 * y0 - z0 * z0;
  if (t0 >= 0) {
    const gi = ii + perm[jj + perm[kk]];
    t0 *= t0;
    n += t0 * t0 * (gradX[gi] * x0 + gradY[gi] * y0 + gradZ[gi] * z0);
  }
  let t1 = 0.6 - x1 * x1 - y1 * y1 - z1 * z1;
  if (t1 >= 0) {
    const gi = ii + i1 + perm[jj + j1 + perm[kk + k1]];
    t1 *= t1;
    n += t1 * t1 * (gradX[gi] * x1 + gradY[gi] * y1 + gradZ[gi] * z1);
  }
  let t2 = 0.6 - x2 * x2 - y2 * y2 - z2 * z2;
  if (t2 >= 0) {
    const gi = ii + i2 + perm[jj + j2 + perm[kk + k2]];
    t2 *= t2;
    n += t2 * t2 * (gradX[gi] * x2 + gradY[gi] * y2 + gradZ[gi] * z2);
  }
  let t3 = 0.6 - x3 * x3 - y3 * y3 - z3 * z3;
  if (t3 >= 0) {
    const gi = ii + 1 + perm[jj + 1 + perm[kk + 1]];
    t3 *= t3;
    n += t3 * t3 * (gradX[gi] * x3 + gradY[gi] * y3 + gradZ[gi] * z3);
  }
  return 32.0 * n;
}

/** Fibonacci sphere: deterministic unit vectors, the shape climate sees. */
function makeSamplePoints(count: number): Float32Array {
  const points = new Float32Array(count * 4);
  const golden = Math.PI * (3 - Math.sqrt(5));
  for (let i = 0; i < count; i += 1) {
    const y = 1 - (i / Math.max(1, count - 1)) * 2;
    const radius = Math.sqrt(Math.max(0, 1 - y * y));
    const theta = golden * i;
    points[i * 4] = Math.cos(theta) * radius;
    points[i * 4 + 1] = y;
    points[i * 4 + 2] = Math.sin(theta) * radius;
    points[i * 4 + 3] = 0;
  }
  return points;
}

const WGSL = /* wgsl */ `
struct Config {
  count      : u32,
  octaves    : u32,
  persistence: f32,
  lacunarity : f32,
  scale      : f32,
  _pad0      : u32,
  _pad1      : u32,
  _pad2      : u32,
};

@group(0) @binding(0) var<storage, read>       points  : array<vec4<f32>>;
@group(0) @binding(1) var<storage, read>       perm    : array<u32>;
@group(0) @binding(2) var<storage, read>       grad    : array<vec4<f32>>;
@group(0) @binding(3) var<storage, read_write> outputs : array<vec4<f32>>;
@group(0) @binding(4) var<uniform>             cfgs    : array<Config, 3>;

const F3: f32 = 0.3333333333333333;
const G3: f32 = 0.16666666666666666;

fn permAt(base: u32, index: i32) -> i32 {
  return i32(perm[base + u32(index)]);
}

fn simplex3(base: u32, x: f32, y: f32, z: f32) -> f32 {
  let s = (x + y + z) * F3;
  let fi = floor(x + s);
  let fj = floor(y + s);
  let fk = floor(z + s);
  let t = (fi + fj + fk) * G3;
  let x0 = x - (fi - t);
  let y0 = y - (fj - t);
  let z0 = z - (fk - t);

  var i1: f32; var j1: f32; var k1: f32;
  var i2: f32; var j2: f32; var k2: f32;
  if (x0 >= y0) {
    if (y0 >= z0)      { i1=1.0; j1=0.0; k1=0.0; i2=1.0; j2=1.0; k2=0.0; }
    else if (x0 >= z0) { i1=1.0; j1=0.0; k1=0.0; i2=1.0; j2=0.0; k2=1.0; }
    else               { i1=0.0; j1=0.0; k1=1.0; i2=1.0; j2=0.0; k2=1.0; }
  } else {
    if (y0 < z0)       { i1=0.0; j1=0.0; k1=1.0; i2=0.0; j2=1.0; k2=1.0; }
    else if (x0 < z0)  { i1=0.0; j1=1.0; k1=0.0; i2=0.0; j2=1.0; k2=1.0; }
    else               { i1=0.0; j1=1.0; k1=0.0; i2=1.0; j2=1.0; k2=0.0; }
  }

  let x1 = x0 - i1 + G3;        let y1 = y0 - j1 + G3;        let z1 = z0 - k1 + G3;
  let x2 = x0 - i2 + 2.0 * G3;  let y2 = y0 - j2 + 2.0 * G3;  let z2 = z0 - k2 + 2.0 * G3;
  let x3 = x0 - 1.0 + 3.0 * G3; let y3 = y0 - 1.0 + 3.0 * G3; let z3 = z0 - 1.0 + 3.0 * G3;

  // i32(floor(v)) & 255 reproduces JS "fastFloor(v) | 0" then "& 255",
  // including two's-complement wrap for negative cells.
  let ii = i32(fi) & 255;
  let jj = i32(fj) & 255;
  let kk = i32(fk) & 255;

  var n: f32 = 0.0;

  var t0 = 0.6 - x0*x0 - y0*y0 - z0*z0;
  if (t0 >= 0.0) {
    let gi = ii + permAt(base, jj + permAt(base, kk));
    t0 = t0 * t0;
    let g = grad[base + u32(gi)];
    n = n + t0 * t0 * (g.x * x0 + g.y * y0 + g.z * z0);
  }
  var t1 = 0.6 - x1*x1 - y1*y1 - z1*z1;
  if (t1 >= 0.0) {
    let gi = ii + i32(i1) + permAt(base, jj + i32(j1) + permAt(base, kk + i32(k1)));
    t1 = t1 * t1;
    let g = grad[base + u32(gi)];
    n = n + t1 * t1 * (g.x * x1 + g.y * y1 + g.z * z1);
  }
  var t2 = 0.6 - x2*x2 - y2*y2 - z2*z2;
  if (t2 >= 0.0) {
    let gi = ii + i32(i2) + permAt(base, jj + i32(j2) + permAt(base, kk + i32(k2)));
    t2 = t2 * t2;
    let g = grad[base + u32(gi)];
    n = n + t2 * t2 * (g.x * x2 + g.y * y2 + g.z * z2);
  }
  var t3 = 0.6 - x3*x3 - y3*y3 - z3*z3;
  if (t3 >= 0.0) {
    let gi = ii + 1 + permAt(base, jj + 1 + permAt(base, kk + 1));
    t3 = t3 * t3;
    let g = grad[base + u32(gi)];
    n = n + t3 * t3 * (g.x * x3 + g.y * y3 + g.z * z3);
  }
  return 32.0 * n;
}

fn fbm3d(base: u32, cfg: Config, x: f32, y: f32, z: f32) -> f32 {
  var total: f32 = 0.0;
  var frequency: f32 = cfg.scale;
  var amplitude: f32 = 1.0;
  var maxValue: f32 = 0.0;
  for (var o: u32 = 0u; o < cfg.octaves; o = o + 1u) {
    total = total + simplex3(base, x * frequency, y * frequency, z * frequency) * amplitude;
    maxValue = maxValue + amplitude;
    amplitude = amplitude * cfg.persistence;
    frequency = frequency * cfg.lacunarity;
  }
  return total / maxValue;
}

@compute @workgroup_size(64)
fn main(@builtin(global_invocation_id) gid: vec3<u32>) {
  let index = gid.x;
  if (index >= cfgs[0].count) { return; }
  let p = points[index];
  outputs[index] = vec4<f32>(
    fbm3d(0u,    cfgs[0], p.x, p.y, p.z),
    fbm3d(512u,  cfgs[1], p.x, p.y, p.z),
    fbm3d(1024u, cfgs[2], p.x, p.y, p.z),
    0.0,
  );
}
`;

function median(values: number[]): number {
  const sorted = [...values].sort((a, b) => a - b);
  return sorted[Math.floor(sorted.length / 2)];
}

export interface SpikeResult {
  ok: boolean;
  error?: string;
  adapter?: string;
  samples?: number;
  tableCheck?: { maxDelta: number; pass: boolean };
  agreement?: { name: string; maxAbs: number; maxRel: number; meanAbs: number }[];
  timing?: {
    cpuMs: number;
    gpuKernelMs: number | null;
    gpuReadbackMs: number;
    gpuTotalMs: number;
    speedupTotal: number;
    speedupKernel: number | null;
  };
}

export async function run(sampleCount: number, seed: number, repeats: number): Promise<SpikeResult> {
  if (!navigator.gpu) return { ok: false, error: 'navigator.gpu undefined' };
  const adapter = await navigator.gpu.requestAdapter({ powerPreference: 'high-performance' });
  if (!adapter) return { ok: false, error: 'requestAdapter() returned null' };

  const info = adapter.info ?? ({} as Record<string, string>);
  const features = [...adapter.features];
  const canTimestamp = features.includes('timestamp-query');
  const device = await adapter.requestDevice({
    requiredFeatures: canTimestamp ? (['timestamp-query'] as GPUFeatureName[]) : [],
  });

  const tables = FIELDS.map((f) => buildTable(seed + f.seedOffset));
  const points = makeSamplePoints(sampleCount);

  // --- Stage 0: does our explicit table reproduce the engine's own noise? ---
  // If this fails, nothing downstream is meaningful: the GPU would be fed a
  // different permutation than the engine uses.
  let tableMaxDelta = 0;
  for (let fieldIndex = 0; fieldIndex < FIELDS.length; fieldIndex += 1) {
    const engineNoise = getNoise3D(seed + FIELDS[fieldIndex].seedOffset);
    for (let i = 0; i < Math.min(4096, sampleCount); i += 1) {
      const x = points[i * 4], y = points[i * 4 + 1], z = points[i * 4 + 2];
      const delta = Math.abs(engineNoise(x, y, z) - simplex3(tables[fieldIndex], x, y, z));
      if (delta > tableMaxDelta) tableMaxDelta = delta;
    }
  }

  // --- CPU reference: the real engine fbm3d, exactly as climate.ts calls it ---
  const cpu = new Float32Array(sampleCount * 3);
  const cpuRuns: number[] = [];
  const engineNoises = FIELDS.map((f) => getNoise3D(seed + f.seedOffset));
  for (let pass = 0; pass < repeats; pass += 1) {
    const started = performance.now();
    for (let i = 0; i < sampleCount; i += 1) {
      const x = points[i * 4], y = points[i * 4 + 1], z = points[i * 4 + 2];
      for (let f = 0; f < FIELDS.length; f += 1) {
        const spec = FIELDS[f];
        cpu[i * 3 + f] = fbm3d(
          engineNoises[f], x, y, z,
          spec.octaves, spec.persistence, spec.lacunarity, spec.scale,
        );
      }
    }
    cpuRuns.push(performance.now() - started);
  }

  // --- GPU buffers ---
  const permData = new Uint32Array(PERM_SIZE * FIELDS.length);
  const gradData = new Float32Array(PERM_SIZE * FIELDS.length * 4);
  for (let f = 0; f < FIELDS.length; f += 1) {
    const base = f * PERM_SIZE;
    for (let i = 0; i < PERM_SIZE; i += 1) {
      permData[base + i] = tables[f].perm[i];
      gradData[(base + i) * 4] = tables[f].gradX[i];
      gradData[(base + i) * 4 + 1] = tables[f].gradY[i];
      gradData[(base + i) * 4 + 2] = tables[f].gradZ[i];
    }
  }
  // Config is 8 x 4 bytes; array<Config,3> in a uniform buffer.
  const cfgData = new ArrayBuffer(32 * 3);
  for (let f = 0; f < FIELDS.length; f += 1) {
    const u = new Uint32Array(cfgData, f * 32, 2);
    const v = new Float32Array(cfgData, f * 32 + 8, 3);
    u[0] = sampleCount;
    u[1] = FIELDS[f].octaves;
    v[0] = FIELDS[f].persistence;
    v[1] = FIELDS[f].lacunarity;
    v[2] = FIELDS[f].scale;
  }

  const S = GPUBufferUsage.STORAGE;
  const mk = (data: ArrayBufferView, usage: number) => {
    const buffer = device.createBuffer({
      size: Math.ceil(data.byteLength / 4) * 4,
      usage: usage | GPUBufferUsage.COPY_DST,
    });
    device.queue.writeBuffer(buffer, 0, data as ArrayBuffer & ArrayBufferView);
    return buffer;
  };

  const pointsBuffer = mk(points, S);
  const permBuffer = mk(permData, S);
  const gradBuffer = mk(gradData, S);
  const cfgBuffer = mk(new Uint8Array(cfgData), GPUBufferUsage.UNIFORM);
  const outBytes = sampleCount * 4 * 4;
  const outBuffer = device.createBuffer({ size: outBytes, usage: S | GPUBufferUsage.COPY_SRC });
  const readBuffer = device.createBuffer({
    size: outBytes,
    usage: GPUBufferUsage.COPY_DST | GPUBufferUsage.MAP_READ,
  });

  const module = device.createShaderModule({ code: WGSL });
  const compilation = await module.getCompilationInfo();
  const errors = compilation.messages.filter((m) => m.type === 'error');
  if (errors.length > 0) {
    return { ok: false, error: 'WGSL: ' + errors.map((e) => `${e.lineNum}: ${e.message}`).join(' | ') };
  }

  const pipeline = device.createComputePipeline({
    layout: 'auto',
    compute: { module, entryPoint: 'main' },
  });
  const bindGroup = device.createBindGroup({
    layout: pipeline.getBindGroupLayout(0),
    entries: [
      { binding: 0, resource: { buffer: pointsBuffer } },
      { binding: 1, resource: { buffer: permBuffer } },
      { binding: 2, resource: { buffer: gradBuffer } },
      { binding: 3, resource: { buffer: outBuffer } },
      { binding: 4, resource: { buffer: cfgBuffer } },
    ],
  });

  const querySet = canTimestamp ? device.createQuerySet({ type: 'timestamp', count: 2 }) : null;
  const queryResolve = canTimestamp
    ? device.createBuffer({ size: 16, usage: GPUBufferUsage.QUERY_RESOLVE | GPUBufferUsage.COPY_SRC })
    : null;
  const queryRead = canTimestamp
    ? device.createBuffer({ size: 16, usage: GPUBufferUsage.COPY_DST | GPUBufferUsage.MAP_READ })
    : null;

  const groups = Math.ceil(sampleCount / 64);
  const kernelRuns: number[] = [];
  const readbackRuns: number[] = [];
  const totalRuns: number[] = [];
  let gpu = new Float32Array(0);

  // Warm up: first dispatch pays pipeline creation and allocation costs that
  // would otherwise be charged to the measurement.
  for (let pass = 0; pass < repeats + 1; pass += 1) {
    const totalStart = performance.now();
    const encoder = device.createCommandEncoder();
    const pass0 = encoder.beginComputePass(
      querySet ? { timestampWrites: { querySet, beginningOfPassWriteIndex: 0, endOfPassWriteIndex: 1 } } : undefined,
    );
    pass0.setPipeline(pipeline);
    pass0.setBindGroup(0, bindGroup);
    pass0.dispatchWorkgroups(groups);
    pass0.end();
    if (querySet && queryResolve && queryRead) {
      encoder.resolveQuerySet(querySet, 0, 2, queryResolve, 0);
      encoder.copyBufferToBuffer(queryResolve, 0, queryRead, 0, 16);
    }
    encoder.copyBufferToBuffer(outBuffer, 0, readBuffer, 0, outBytes);
    device.queue.submit([encoder.finish()]);

    const readStart = performance.now();
    await readBuffer.mapAsync(GPUMapMode.READ);
    const copy = new Float32Array(readBuffer.getMappedRange().slice(0));
    readBuffer.unmap();
    const readbackMs = performance.now() - readStart;
    const totalMs = performance.now() - totalStart;

    let kernelMs: number | null = null;
    if (queryRead) {
      await queryRead.mapAsync(GPUMapMode.READ);
      const stamps = new BigUint64Array(queryRead.getMappedRange().slice(0));
      queryRead.unmap();
      kernelMs = Number(stamps[1] - stamps[0]) / 1e6;
    }

    if (pass === 0) continue; // discard warm-up
    gpu = copy;
    if (kernelMs !== null) kernelRuns.push(kernelMs);
    readbackRuns.push(readbackMs);
    totalRuns.push(totalMs);
  }

  // --- Agreement ---
  const agreement = FIELDS.map((spec, f) => {
    let maxAbs = 0, maxRel = 0, sumAbs = 0;
    for (let i = 0; i < sampleCount; i += 1) {
      const a = cpu[i * 3 + f];
      const b = gpu[i * 4 + f];
      const abs = Math.abs(a - b);
      sumAbs += abs;
      if (abs > maxAbs) maxAbs = abs;
      const rel = abs / Math.max(1e-6, Math.abs(a));
      if (rel > maxRel) maxRel = rel;
    }
    return { name: spec.name, maxAbs, maxRel, meanAbs: sumAbs / sampleCount };
  });

  const cpuMs = median(cpuRuns);
  const gpuTotalMs = median(totalRuns);
  const gpuKernelMs = kernelRuns.length > 0 ? median(kernelRuns) : null;

  device.destroy();

  return {
    ok: true,
    adapter: `${info.vendor ?? '?'}/${info.architecture ?? '?'}${canTimestamp ? '' : ' (no timestamp-query)'}`,
    samples: sampleCount,
    tableCheck: { maxDelta: tableMaxDelta, pass: tableMaxDelta === 0 },
    agreement,
    timing: {
      cpuMs,
      gpuKernelMs,
      gpuReadbackMs: median(readbackRuns),
      gpuTotalMs,
      speedupTotal: cpuMs / gpuTotalMs,
      speedupKernel: gpuKernelMs !== null ? cpuMs / gpuKernelMs : null,
    },
  };
}
