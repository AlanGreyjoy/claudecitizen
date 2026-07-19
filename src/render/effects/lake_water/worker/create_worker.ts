export function createSurfaceWaterBuildWorker(): Worker | null {
  if (typeof window === 'undefined' || typeof Worker === 'undefined') return null;

  try {
    return new Worker(new URL('./water_worker', import.meta.url), {
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
