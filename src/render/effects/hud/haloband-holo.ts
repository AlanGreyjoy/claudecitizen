/**
 * Lightweight WebGPU hologram for the HaloBand screen. This intentionally
 * stays outside Three.js: it owns one full-screen triangle, one uniform
 * buffer, and no scene graph. The render loop only runs while the device is
 * open.
 */

const HOLO_SHADER = /* wgsl */ `
struct HoloUniforms {
  resolution: vec2f,
  time: f32,
  aspect: f32,
};

@group(0) @binding(0) var<uniform> uniforms: HoloUniforms;

fn hash(p: vec2f) -> f32 {
  return fract(sin(dot(p, vec2f(127.1, 311.7))) * 43758.5453);
}

fn vnoise(p: vec2f) -> f32 {
  let i = floor(p);
  let f = fract(p);
  let u = f * f * (3.0 - 2.0 * f);
  return mix(
    mix(hash(i), hash(i + vec2f(1.0, 0.0)), u.x),
    mix(hash(i + vec2f(0.0, 1.0)), hash(i + vec2f(1.0, 1.0)), u.x),
    u.y
  );
}

@vertex
fn vertexMain(@builtin(vertex_index) index: u32) -> @builtin(position) vec4f {
  let positions = array<vec2f, 3>(
    vec2f(-1.0, -1.0),
    vec2f(3.0, -1.0),
    vec2f(-1.0, 3.0),
  );
  return vec4f(positions[index], 0.0, 1.0);
}

@fragment
fn fragmentMain(@builtin(position) position: vec4f) -> @location(0) vec4f {
  let uv = position.xy / uniforms.resolution;

  let base = vec3f(0.018, 0.052, 0.092);
  let holo = vec3f(0.36, 0.78, 1.0);
  var color = base + holo * 0.035;

  // Moving scanlines.
  var scan = 0.5 + 0.5 * sin((uv.y + uniforms.time * 0.04) * 260.0);
  scan = pow(scan, 6.0);
  color += holo * scan * 0.05;

  // Slow vertical refresh sweep.
  let sweepPosition = fract(uniforms.time * 0.12);
  let sweep = exp(-pow((uv.y - sweepPosition) * 24.0, 2.0));
  color += holo * sweep * 0.06;

  // Faint holographic grid.
  let gridCell = abs(
    fract(uv * vec2f(uniforms.aspect, 1.0) * 26.0) - vec2f(0.5)
  );
  let grid = 1.0 - smoothstep(0.46, 0.5, max(gridCell.x, gridCell.y));
  color += holo * grid * 0.015;

  // Film grain.
  let grain = vnoise(
    uv * vec2f(uniforms.resolution.x / uniforms.resolution.y, 1.0) * 220.0
      + vec2f(uniforms.time * 8.0)
  );
  color += vec3f((grain - 0.5) * 0.018);

  // Subtle flicker.
  let flicker =
    0.94 + 0.06 * sin(uniforms.time * 31.0) * sin(uniforms.time * 5.3);
  color *= flicker;

  // Bright pulse that fades over the first ~0.6 seconds after opening.
  let boot = exp(-uniforms.time * 4.0);
  color += holo * boot * 0.5;

  return vec4f(color, 1.0);
}
`;

const HOLO_LABEL = 'HaloBand hologram';

interface HalobandGpuState {
  context: GPUCanvasContext;
  device: GPUDevice;
  pipeline: GPURenderPipeline;
  bindGroup: GPUBindGroup;
  uniformBuffer: GPUBuffer;
}

export interface HalobandHoloController {
  start(): void;
  stop(): void;
  dispose(): void;
}

const EMPTY_CONTROLLER: HalobandHoloController = {
  start: () => undefined,
  stop: () => undefined,
  dispose: () => undefined,
};

async function createGpuState(canvas: HTMLCanvasElement): Promise<HalobandGpuState> {
  if (!navigator.gpu) {
    throw new Error('WebGPU is unavailable for the HaloBand hologram.');
  }

  const context = canvas.getContext('webgpu');
  if (!context) {
    throw new Error('Could not acquire a WebGPU canvas context for the HaloBand.');
  }

  const adapter = await navigator.gpu.requestAdapter({
    powerPreference: 'high-performance',
  });
  if (!adapter) {
    throw new Error('Could not acquire a WebGPU adapter for the HaloBand.');
  }

  const device = await adapter.requestDevice();
  const format = navigator.gpu.getPreferredCanvasFormat();
  context.configure({
    device,
    format,
    alphaMode: 'premultiplied',
  });

  const module = device.createShaderModule({
    label: HOLO_LABEL,
    code: HOLO_SHADER,
  });
  const pipeline = await device.createRenderPipelineAsync({
    label: HOLO_LABEL,
    layout: 'auto',
    vertex: {
      module,
      entryPoint: 'vertexMain',
    },
    fragment: {
      module,
      entryPoint: 'fragmentMain',
      targets: [{ format }],
    },
    primitive: {
      topology: 'triangle-list',
    },
  });
  const uniformBuffer = device.createBuffer({
    label: `${HOLO_LABEL} uniforms`,
    size: 16,
    usage: GPUBufferUsage.COPY_DST | GPUBufferUsage.UNIFORM,
  });
  const bindGroup = device.createBindGroup({
    label: HOLO_LABEL,
    layout: pipeline.getBindGroupLayout(0),
    entries: [{ binding: 0, resource: { buffer: uniformBuffer } }],
  });

  return {
    context,
    device,
    pipeline,
    bindGroup,
    uniformBuffer,
  };
}

export function createHalobandHolo(canvas: HTMLCanvasElement): HalobandHoloController {
  if (!navigator.gpu) return EMPTY_CONTROLLER;

  let rafId = 0;
  let startTime = 0;
  let running = false;
  let disposed = false;
  let gpuState: HalobandGpuState | null = null;

  const dprCap = 2;
  function resize(): void {
    const dpr = Math.min(window.devicePixelRatio || 1, dprCap);
    const width = Math.max(1, Math.floor(canvas.clientWidth * dpr));
    const height = Math.max(1, Math.floor(canvas.clientHeight * dpr));
    if (canvas.width !== width || canvas.height !== height) {
      canvas.width = width;
      canvas.height = height;
    }
  }

  const resizeObserver = new ResizeObserver(resize);
  resizeObserver.observe(canvas);
  resize();

  const render = (): void => {
    if (!running || disposed || !gpuState) return;

    const now = performance.now();
    const time = (now - startTime) / 1000;
    const width = Math.max(canvas.width, 1);
    const height = Math.max(canvas.height, 1);
    gpuState.device.queue.writeBuffer(
      gpuState.uniformBuffer,
      0,
      new Float32Array([width, height, time, width / height]),
    );

    const encoder = gpuState.device.createCommandEncoder({
      label: HOLO_LABEL,
    });
    const pass = encoder.beginRenderPass({
      label: HOLO_LABEL,
      colorAttachments: [
        {
          view: gpuState.context.getCurrentTexture().createView(),
          clearValue: { r: 0.018, g: 0.052, b: 0.092, a: 1 },
          loadOp: 'clear',
          storeOp: 'store',
        },
      ],
    });
    pass.setPipeline(gpuState.pipeline);
    pass.setBindGroup(0, gpuState.bindGroup);
    pass.draw(3);
    pass.end();
    gpuState.device.queue.submit([encoder.finish()]);
    rafId = requestAnimationFrame(render);
  };

  const ready = createGpuState(canvas)
    .then((state) => {
      if (disposed) {
        state.uniformBuffer.destroy();
        state.context.unconfigure();
        state.device.destroy();
        return;
      }
      gpuState = state;
      void state.device.lost.then((info) => {
        if (disposed) return;
        running = false;
        if (rafId) cancelAnimationFrame(rafId);
        rafId = 0;
        console.warn(`HaloBand WebGPU device lost: ${info.message}`);
      });
      if (running) rafId = requestAnimationFrame(render);
    })
    .catch((error: unknown) => {
      if (!disposed) {
        console.warn('HaloBand WebGPU initialization failed:', error);
      }
    });

  return {
    start() {
      if (running || disposed) return;
      running = true;
      startTime = performance.now();
      resize();
      if (gpuState) rafId = requestAnimationFrame(render);
    },
    stop() {
      running = false;
      if (rafId) cancelAnimationFrame(rafId);
      rafId = 0;
    },
    dispose() {
      if (disposed) return;
      disposed = true;
      running = false;
      if (rafId) cancelAnimationFrame(rafId);
      rafId = 0;
      resizeObserver.disconnect();
      const state = gpuState;
      gpuState = null;
      if (state) {
        state.uniformBuffer.destroy();
        state.context.unconfigure();
        state.device.destroy();
      }
      void ready;
    },
  };
}
