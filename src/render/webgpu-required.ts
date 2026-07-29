import type { WebGPURenderer } from 'three/webgpu';

/**
 * WebGPU is a hard requirement for this engine — there is no WebGL fallback.
 *
 * That is a deliberate product decision, not a limitation. The compute paths the
 * renderer is built around (see `prds/webgpu-migration/PLAN.md`) have no WebGL2
 * equivalent: WebGL2 has no compute shaders at all. Silently degrading to WebGL2
 * would ship a build that looks like it works while missing the thing that makes
 * terrain and vegetation authoring fast, and the resulting bug reports would be
 * indistinguishable from real regressions.
 *
 * `WebGPURenderer` degrades by default and it is *not* opt-out via constructor
 * parameters — see `disableWebGlFallback` below. Every surface that creates a
 * renderer must route through this module.
 */

/** Thrown when the machine cannot run the engine at all. */
export class WebGpuUnavailableError extends Error {
  /** Machine-readable cause, for a boot screen to branch on. */
  readonly reason: 'no-api' | 'no-adapter' | 'software-adapter' | 'device-init-failed';

  constructor(reason: WebGpuUnavailableError['reason'], detail: string) {
    super(detail);
    this.name = 'WebGpuUnavailableError';
    this.reason = reason;
  }
}

const GUIDANCE_LINUX =
  'On Linux, Chrome and Electron gate WebGPU behind Vulkan: enable chrome://flags#enable-vulkan ' +
  'and chrome://flags#enable-unsafe-webgpu, then relaunch.';

/**
 * Pre-flight check, before any renderer is constructed.
 *
 * Deliberately separate from renderer creation so a boot screen can call it on
 * its own and show a real message instead of catching a render-layer failure.
 */
export async function assertWebGpuAvailable(): Promise<GPUAdapter> {
  if (typeof navigator === 'undefined' || !navigator.gpu) {
    throw new WebGpuUnavailableError(
      'no-api',
      `This engine requires WebGPU, which this browser does not expose. ${GUIDANCE_LINUX}`,
    );
  }

  const adapter = await navigator.gpu.requestAdapter({ powerPreference: 'high-performance' });
  if (!adapter) {
    // The API exists but no adapter was handed out — on Linux this is almost
    // always the Vulkan flag rather than genuinely absent hardware.
    throw new WebGpuUnavailableError(
      'no-adapter',
      `This engine requires WebGPU. The browser exposes the API but returned no GPU adapter. ${GUIDANCE_LINUX}`,
    );
  }

  // Chrome already blocklists CPU adapters for WebGPU ("CPU adapters not fully
  // tested or conformant"), so this is a backstop rather than the main defence.
  // Only trip on an explicit software signal: `info` is permitted to be empty,
  // and an unknown architecture must not be treated as failure.
  const architecture = adapter.info?.architecture?.toLowerCase() ?? '';
  const vendor = adapter.info?.vendor?.toLowerCase() ?? '';
  if (architecture.includes('swiftshader') || architecture.includes('llvmpipe')) {
    throw new WebGpuUnavailableError(
      'software-adapter',
      `WebGPU resolved to a software renderer (${vendor || 'unknown'}/${architecture}), which is far too slow to run this engine. Check chrome://gpu — the WebGPU row should read "Hardware accelerated".`,
    );
  }

  return adapter;
}

interface FallbackInternals {
  _getFallback: ((error: Error) => unknown) | null;
}

/**
 * Strips `WebGPURenderer`'s automatic WebGL2 fallback.
 *
 * Has to happen after construction: the constructor assigns
 * `parameters.getFallback` itself whenever `forceWebGL` is falsy, overwriting
 * anything supplied by the caller, so there is no parameter that opts out.
 * `Renderer.init()` then branches on `this._getFallback !== null` — nulling it
 * makes init reject with the underlying device error instead of quietly
 * continuing on WebGL2.
 *
 * Reaches into a private field by necessity. If a three upgrade renames it the
 * assertion below fails loudly rather than silently restoring the fallback.
 */
export function disableWebGlFallback(renderer: WebGPURenderer): void {
  const internals = renderer as unknown as FallbackInternals;
  if (internals._getFallback === undefined) {
    throw new Error(
      'WebGPURenderer._getFallback is missing — three internals changed. ' +
        'Re-check the fallback-stripping in src/render/webgpu-required.ts before shipping, ' +
        'or the engine will silently run on WebGL2.',
    );
  }
  internals._getFallback = null;
}

/**
 * Pre-flight, strip the fallback, then initialize.
 *
 * Rejects with `WebGpuUnavailableError` on any path, so callers have one error
 * type to branch on. Kept separate from renderer construction because
 * `WebGPURenderer`'s constructor is synchronous and touches no GPU state, which
 * lets creation sites stay synchronous and expose this promise as `ready`.
 */
export async function initRequiredWebGpu(renderer: WebGPURenderer): Promise<void> {
  await assertWebGpuAvailable();
  disableWebGlFallback(renderer);
  try {
    await renderer.init();
  } catch (error) {
    throw new WebGpuUnavailableError(
      'device-init-failed',
      `WebGPU adapter was available but device initialization failed: ${
        error instanceof Error ? error.message : String(error)
      }`,
    );
  }
}
