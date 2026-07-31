import { CLIMATE_NOISE_FIELDS } from '../../../world/climate';
import { NOISE_TABLE_SIZE, buildNoiseTable } from '../../../world/terrain-noise';

/**
 * Batched GPU evaluation of the three climate fbm fields.
 *
 * Ported from `scripts/webgpu_noise_spike_entry.ts`, which measured this kernel
 * on an RTX 3080 Ti: the permutation table reproduces `getNoise3D` exactly (max
 * delta 0), CPU f64 and GPU f32 agree to ~1e-6, and 1M samples take 0.19 ms of
 * kernel time against 531 ms on the CPU. Readback is ~99% of GPU wall time, so
 * batch as much as possible per `evaluate` call — one dispatch for a whole tile
 * beats one per instance by orders of magnitude.
 *
 * Hand-written WGSL rather than TSL on purpose: f32-vs-f64 agreement is the
 * whole question here, and codegen would obscure which operations round where.
 */

/** Floats per sample in both the input and output buffers (xyz0 / tmf0). */
const COMPONENTS_PER_SAMPLE = 4;
const WORKGROUP_SIZE = 64;
/** `Config` is 2 u32 + 3 f32, padded to a 32-byte uniform-array stride. */
const CONFIG_STRIDE_BYTES = 32;

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

@compute @workgroup_size(${WORKGROUP_SIZE})
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

export interface ClimateNoiseGpu {
  /**
   * Evaluates `count` unit directions, packed as xyz0 vec4s in `directions`.
   * Resolves to `count * 4` floats: temperature, moisture, forest, 0 — matching
   * `CLIMATE_NOISE_FIELDS` order. The returned view is owned by the caller.
   */
  evaluate: (
    directions: Float32Array<ArrayBuffer>,
    count: number,
  ) => Promise<Float32Array<ArrayBuffer>>;
  dispose: () => void;
}

// `<ArrayBuffer>` throughout, not the default `<ArrayBufferLike>`: WebGPU's
// writeBuffer rejects SharedArrayBuffer-backed views, and TS 5.7+ tracks that
// in the type. Annotating here beats casting at every call site.
function buildTableBuffers(seed: number): {
  perm: Uint32Array<ArrayBuffer>;
  grad: Float32Array<ArrayBuffer>;
} {
  const fieldCount = CLIMATE_NOISE_FIELDS.length;
  const perm = new Uint32Array(NOISE_TABLE_SIZE * fieldCount);
  const grad = new Float32Array(NOISE_TABLE_SIZE * fieldCount * COMPONENTS_PER_SAMPLE);
  for (let field = 0; field < fieldCount; field += 1) {
    const table = buildNoiseTable(seed + CLIMATE_NOISE_FIELDS[field].seedOffset);
    const base = field * NOISE_TABLE_SIZE;
    perm.set(table.perm, base);
    grad.set(table.grad, base * COMPONENTS_PER_SAMPLE);
  }
  return { grad, perm };
}

function buildConfigBuffer(count: number): Uint8Array<ArrayBuffer> {
  const bytes = new ArrayBuffer(CONFIG_STRIDE_BYTES * CLIMATE_NOISE_FIELDS.length);
  for (let field = 0; field < CLIMATE_NOISE_FIELDS.length; field += 1) {
    const spec = CLIMATE_NOISE_FIELDS[field];
    const counts = new Uint32Array(bytes, field * CONFIG_STRIDE_BYTES, 2);
    const floats = new Float32Array(bytes, field * CONFIG_STRIDE_BYTES + 8, 3);
    counts[0] = count;
    counts[1] = spec.octaves;
    floats[0] = spec.persistence;
    floats[1] = spec.lacunarity;
    floats[2] = spec.scale;
  }
  return new Uint8Array(bytes);
}

/**
 * Brings up a compute-only `GPUDevice` for the climate kernel.
 *
 * Returns `null` rather than throwing when WebGPU is unreachable. That is a
 * deliberate difference from `render/webgpu-required.ts`, which hard-fails: the
 * renderer has no CPU equivalent, but this kernel does — falling back to
 * `evaluateClimateNoise` reproduces today's behavior exactly, so a missing
 * device costs build time and nothing else.
 */
export async function createClimateNoiseGpu(
  seed: number,
): Promise<ClimateNoiseGpu | null> {
  const gpu = (globalThis.navigator as Navigator | undefined)?.gpu;
  if (!gpu) return null;

  const adapter = await gpu.requestAdapter({ powerPreference: 'high-performance' });
  if (!adapter) return null;
  const device = await adapter.requestDevice();

  const tables = buildTableBuffers(seed);
  const storage = GPUBufferUsage.STORAGE | GPUBufferUsage.COPY_DST;
  const permBuffer = device.createBuffer({ size: tables.perm.byteLength, usage: storage });
  device.queue.writeBuffer(permBuffer, 0, tables.perm);
  const gradBuffer = device.createBuffer({ size: tables.grad.byteLength, usage: storage });
  device.queue.writeBuffer(gradBuffer, 0, tables.grad);
  const configBuffer = device.createBuffer({
    size: CONFIG_STRIDE_BYTES * CLIMATE_NOISE_FIELDS.length,
    usage: GPUBufferUsage.UNIFORM | GPUBufferUsage.COPY_DST,
  });

  const module = device.createShaderModule({ code: WGSL });
  const compilation = await module.getCompilationInfo();
  const errors = compilation.messages.filter((message) => message.type === 'error');
  if (errors.length > 0) {
    device.destroy();
    throw new Error(
      `climate noise WGSL failed to compile: ${errors
        .map((message) => `${message.lineNum}: ${message.message}`)
        .join(' | ')}`,
    );
  }

  const pipeline = device.createComputePipeline({
    layout: 'auto',
    compute: { module, entryPoint: 'main' },
  });

  // Per-batch buffers are recreated only when a tile needs more room than the
  // largest tile so far, so a steady-state build allocates nothing.
  let capacity = 0;
  let pointsBuffer: GPUBuffer | null = null;
  let outputBuffer: GPUBuffer | null = null;
  let readBuffer: GPUBuffer | null = null;
  let bindGroup: GPUBindGroup | null = null;
  let disposed = false;

  function ensureCapacity(count: number): void {
    if (count <= capacity && bindGroup) return;
    pointsBuffer?.destroy();
    outputBuffer?.destroy();
    readBuffer?.destroy();
    capacity = count;
    const bytes = count * COMPONENTS_PER_SAMPLE * Float32Array.BYTES_PER_ELEMENT;
    pointsBuffer = device.createBuffer({ size: bytes, usage: storage });
    outputBuffer = device.createBuffer({
      size: bytes,
      usage: GPUBufferUsage.STORAGE | GPUBufferUsage.COPY_SRC,
    });
    readBuffer = device.createBuffer({
      size: bytes,
      usage: GPUBufferUsage.COPY_DST | GPUBufferUsage.MAP_READ,
    });
    bindGroup = device.createBindGroup({
      layout: pipeline.getBindGroupLayout(0),
      entries: [
        { binding: 0, resource: { buffer: pointsBuffer } },
        { binding: 1, resource: { buffer: permBuffer } },
        { binding: 2, resource: { buffer: gradBuffer } },
        { binding: 3, resource: { buffer: outputBuffer } },
        { binding: 4, resource: { buffer: configBuffer } },
      ],
    });
  }

  return {
    async evaluate(directions, count) {
      if (disposed) throw new Error('climate noise GPU used after dispose()');
      if (count <= 0) return new Float32Array(0);
      ensureCapacity(count);
      if (!pointsBuffer || !outputBuffer || !readBuffer || !bindGroup) {
        throw new Error('climate noise GPU buffers missing');
      }

      const bytes = count * COMPONENTS_PER_SAMPLE * Float32Array.BYTES_PER_ELEMENT;
      device.queue.writeBuffer(pointsBuffer, 0, directions, 0, count * COMPONENTS_PER_SAMPLE);
      device.queue.writeBuffer(configBuffer, 0, buildConfigBuffer(count));

      const encoder = device.createCommandEncoder();
      const pass = encoder.beginComputePass();
      pass.setPipeline(pipeline);
      pass.setBindGroup(0, bindGroup);
      pass.dispatchWorkgroups(Math.ceil(count / WORKGROUP_SIZE));
      pass.end();
      encoder.copyBufferToBuffer(outputBuffer, 0, readBuffer, 0, bytes);
      device.queue.submit([encoder.finish()]);

      await readBuffer.mapAsync(GPUMapMode.READ, 0, bytes);
      // slice() before unmap: the mapped range is detached by unmap, and the
      // caller keeps this array for the whole placement pass.
      const results = new Float32Array(readBuffer.getMappedRange(0, bytes).slice(0));
      readBuffer.unmap();
      return results;
    },
    dispose() {
      if (disposed) return;
      disposed = true;
      pointsBuffer?.destroy();
      outputBuffer?.destroy();
      readBuffer?.destroy();
      permBuffer.destroy();
      gradBuffer.destroy();
      configBuffer.destroy();
      device.destroy();
    },
  };
}
