/**
 * Static facts about the machine, captured once at boot.
 *
 * Copied onto every telemetry record by the backend, which makes each row
 * self-explaining: "30 fps" means nothing until you know it is an integrated GPU
 * with four cores at 4K. These are also the fields worth grouping by — a
 * regression that only shows on one GPU vendor is invisible in an average.
 */

export interface TelemetryContext {
  buildId: string;
  buildMode: string;
  gpuVendor: string;
  gpuArchitecture: string;
  gpuDevice: string;
  gpuDescription: string;
  hardwareConcurrency: number;
  /** Chromium exposes this in coarse buckets; absent elsewhere. */
  deviceMemoryGb: number | null;
  viewportWidth: number;
  viewportHeight: number;
  devicePixelRatio: number;
  userAgent: string;
  language: string;
}

const UNKNOWN = 'unknown';

/**
 * WebGPU is a hard requirement for this engine, so an adapter is always
 * present in practice. This still tolerates its absence: telemetry runs before
 * and during the startup gate, and a machine that fails the gate is one of the
 * more interesting things to have a record of.
 */
async function readAdapterInfo(): Promise<GPUAdapterInfo | null> {
  try {
    if (typeof navigator === 'undefined' || !navigator.gpu) return null;
    const adapter = await navigator.gpu.requestAdapter({
      powerPreference: 'high-performance',
    });
    return adapter?.info ?? null;
  } catch {
    return null;
  }
}

export async function captureTelemetryContext(): Promise<TelemetryContext> {
  const info = await readAdapterInfo();
  const memory = (navigator as { deviceMemory?: number }).deviceMemory;
  return {
    buildId: __ASTERON_BUILD_ID__,
    buildMode: import.meta.env.MODE,
    deviceMemoryGb: typeof memory === 'number' ? memory : null,
    devicePixelRatio: window.devicePixelRatio,
    gpuArchitecture: info?.architecture || UNKNOWN,
    gpuDescription: info?.description || UNKNOWN,
    gpuDevice: info?.device || UNKNOWN,
    gpuVendor: info?.vendor || UNKNOWN,
    hardwareConcurrency: navigator.hardwareConcurrency ?? 0,
    language: navigator.language,
    userAgent: navigator.userAgent,
    viewportHeight: window.innerHeight,
    viewportWidth: window.innerWidth,
  };
}
