export function createTileBuildWorker(): Worker | null {
  if (typeof window === 'undefined' || typeof Worker === 'undefined') return null;

  try {
    return new Worker(new URL('./tile_worker', import.meta.url), {
      type: 'module',
    });
  } catch (error) {
    console.warn('ClaudeCitizen terrain worker unavailable, falling back to sync tile builds.', error);
    return null;
  }
}

/** Parallel tile builds — leave a core for the main thread / other workers. */
export function terrainWorkerPoolSize(): number {
  if (typeof navigator === 'undefined') return 2;
  const cores = navigator.hardwareConcurrency || 4;
  return Math.max(2, Math.min(4, cores - 1));
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
