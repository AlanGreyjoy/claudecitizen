/**
 * Water builds ran through a single worker, one tile at a time. A measured wet
 * tile costs ~4.8 ms, so a coastline coming into view — tens of wet tiles at
 * once — filled in over roughly a third of a second of visible popping.
 *
 * Two workers halve that. The pool stays small deliberately: water is bursty and
 * idle almost all the time now that the terrain raster rules dry tiles out
 * before they are queued, so it is not worth taking a core away from the terrain
 * pool (`terrainWorkerPoolSize`) to cover a burst that lasts a few hundred
 * milliseconds. Machines with few cores keep a single worker rather than
 * contending with terrain streaming.
 */
export function surfaceWaterWorkerPoolSize(): number {
  if (typeof navigator === 'undefined') return 1;
  const cores = navigator.hardwareConcurrency || 4;
  return cores >= 6 ? 2 : 1;
}

export function createSurfaceWaterBuildWorkers(
  count = surfaceWaterWorkerPoolSize(),
): Worker[] {
  const workers: Worker[] = [];
  for (let index = 0; index < count; index += 1) {
    const worker = createSurfaceWaterBuildWorker();
    if (!worker) break;
    workers.push(worker);
  }
  return workers;
}

export function createSurfaceWaterBuildWorker(): Worker | null {
  if (typeof window === 'undefined' || typeof Worker === 'undefined') return null;

  try {
    return new Worker(new URL('./water-worker', import.meta.url), {
      type: 'module',
    });
  } catch (error) {
    console.warn(
      'ClaudeCitizen water worker unavailable, falling back to budgeted sync builds.',
      error,
    );
    return null;
  }
}
