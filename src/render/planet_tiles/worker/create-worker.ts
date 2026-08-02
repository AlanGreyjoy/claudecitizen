export function createTileBuildWorker(): Worker | null {
  if (typeof window === 'undefined' || typeof Worker === 'undefined') return null;

  try {
    return new Worker(new URL('./tile-worker', import.meta.url), {
      type: 'module',
    });
  } catch (error) {
    console.warn('ClaudeCitizen terrain worker unavailable, falling back to sync tile builds.', error);
    return null;
  }
}

/**
 * Parallel tile builds. The old hard ceiling of four left most of a modern
 * machine idle while the player stared at an unbuilt horizon; reserve four
 * cores (main thread, vegetation pool, spawn worker, headroom) and use the
 * rest. Flying is the case that wants every builder available at once.
 */
export function terrainWorkerPoolSize(): number {
  if (typeof navigator === 'undefined') return 2;
  const cores = navigator.hardwareConcurrency || 4;
  // Reserve the main thread and one core of headroom, then leave room for the
  // vegetation pool (see vegetationWorkerPoolSize) and the spawn worker.
  return Math.min(6, Math.max(2, cores - 3 - Math.min(3, Math.max(1, Math.floor((cores - 2) / 3)))));
}

export function createTileBuildWorkers(count = terrainWorkerPoolSize()): Worker[] {
  const workers: Worker[] = [];
  for (let i = 0; i < count; i += 1) {
    const worker = createTileBuildWorker();
    if (!worker) break;
    workers.push(worker);
  }
  return workers;
}
