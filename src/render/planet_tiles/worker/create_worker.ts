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
