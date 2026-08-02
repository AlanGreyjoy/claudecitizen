export function createVegetationBuildWorker(): Worker | null {
  if (typeof window === 'undefined' || typeof Worker === 'undefined') return null;

  try {
    return new Worker(new URL('./vegetation-worker', import.meta.url), {
      type: 'module',
    });
  } catch (error) {
    console.warn(
      'ClaudeCitizen vegetation worker unavailable, falling back to budgeted sync builds.',
      error,
    );
    return null;
  }
}

/**
 * Vegetation shares cores with the terrain tile pool.
 *
 * The previous `cores - 6` floor meant a single vegetation worker on any
 * machine with 7 or fewer cores, which is most of them — and a lone worker is
 * why lush tiles kept falling through to the main-thread build path. Terrain
 * tiles no longer evaluate their height field twice (the worker's raster is
 * reused rather than recomputed on the main thread), so terrain needs less of
 * the machine than this split assumed.
 */
export function vegetationWorkerPoolSize(): number {
  if (typeof navigator === 'undefined') return 1;
  const cores = navigator.hardwareConcurrency || 4;
  return Math.min(3, Math.max(1, Math.floor((cores - 2) / 3)));
}

export function createVegetationBuildWorkers(
  count = vegetationWorkerPoolSize(),
): Worker[] {
  const workers: Worker[] = [];
  for (let index = 0; index < count; index += 1) {
    const worker = createVegetationBuildWorker();
    if (!worker) break;
    workers.push(worker);
  }
  return workers;
}
