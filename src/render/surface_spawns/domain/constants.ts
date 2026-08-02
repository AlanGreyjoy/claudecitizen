/**
 * Radial draw cull for surface props.
 *
 * Spawns are foliage-scale geometry (the shipped catalog is ~1,700-triangle
 * bushes with double-sided leaf cards), but unlike the rest of the vegetation
 * stack they had no distance limit: every instance inside the 900 m tile keep
 * radius was drawn at full detail, ~6k props and ~10M triangles per frame.
 * Grass culls at 20 m and trees drop to a low LOD at 180 m — spawns get the
 * same treatment here.
 */
export const DEFAULT_SURFACE_SPAWN_DISTANCE_METERS = 150;
const SURFACE_SPAWN_DISTANCE_MIN_METERS = 25;
const SURFACE_SPAWN_DISTANCE_MAX_METERS = 600;

let surfaceSpawnDistanceMeters = DEFAULT_SURFACE_SPAWN_DISTANCE_METERS;

export function getSurfaceSpawnDistanceMeters(): number {
  return surfaceSpawnDistanceMeters;
}

export function configureSurfaceSpawnDistanceMeters(meters: number): void {
  if (!Number.isFinite(meters)) {
    surfaceSpawnDistanceMeters = DEFAULT_SURFACE_SPAWN_DISTANCE_METERS;
    return;
  }
  surfaceSpawnDistanceMeters = Math.max(
    SURFACE_SPAWN_DISTANCE_MIN_METERS,
    Math.min(SURFACE_SPAWN_DISTANCE_MAX_METERS, meters),
  );
}

/**
 * Walking distance that invalidates the radial cull set. Matches the tree LOD
 * refresh threshold — repacking is cheap now that unchanged tiles skip their
 * matrix compose, but it is not free.
 */
export const SURFACE_SPAWN_REFOCUS_METERS = 8;
