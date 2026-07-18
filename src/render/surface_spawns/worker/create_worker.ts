export function createSurfaceSpawnBuildWorker(): Worker | null {
  if (typeof window === 'undefined' || typeof Worker === 'undefined') return null;

  try {
    return new Worker(new URL('./spawn_worker', import.meta.url), {
      type: 'module',
    });
  } catch (error) {
    console.warn(
      'ClaudeCitizen surface spawn worker unavailable, falling back to budgeted sync builds.',
      error,
    );
    return null;
  }
}
