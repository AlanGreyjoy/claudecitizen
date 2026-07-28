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
 * Vegetation shares cores with the terrain tile pool, which already claims up
 * to four. Keep this small so a lush tile never starves terrain generation.
 */
export function vegetationWorkerPoolSize(): number {
  if (typeof navigator === 'undefined') return 1;
  const cores = navigator.hardwareConcurrency || 4;
  return Math.min(2, Math.max(1, cores - 6));
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
