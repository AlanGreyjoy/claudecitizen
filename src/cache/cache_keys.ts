import { terrainFingerprint } from '../world/terrain_fingerprint';
import type { CubeFace, Planet, VegetationSettings } from '../types';

// Low-poly tiles use a non-indexed triangle layout with baked facet colors.
// Keep this explicit because the height fingerprint does not capture buffer
// layout or palette-only changes.
export const TERRAIN_CACHE_VERSION = 'low-poly-v1';
// v5: river biome and region-gated classification affect spawn decisions.
export const VEGETATION_CACHE_VERSION = 'v5';

// Includes a fingerprint of the terrain generation itself so that editing the
// noise stack invalidates previously cached tiles: stale meshes are the classic
// cause of the character walking above/through the visible ground.
export function planetCacheId(planet: Planet, seed: number): string {
  return `${planet.radiusMeters}|${planet.terrainAmplitudeMeters}|${terrainFingerprint(planet, seed)}`;
}

export function terrainStorageKey(
  planet: Planet,
  seed: number,
  face: CubeFace,
  level: number,
  x: number,
  y: number,
): string {
  return [
    'terrain',
    TERRAIN_CACHE_VERSION,
    planetCacheId(planet, seed),
    seed,
    face,
    level,
    x,
    y,
  ].join(':');
}

export function hashVegetationSettings(settings: VegetationSettings): string {
  const { grass, tree } = settings;
  return [
    grass.density,
    grass.gapMeters,
    grass.minScale,
    grass.maxScale,
    tree.density,
    tree.gapMeters,
    tree.minScale,
    tree.maxScale,
  ]
    .map((value) => value.toFixed(3))
    .join(',');
}

export function vegetationStorageKey(
  planet: Planet,
  seed: number,
  settingsHash: string,
  face: CubeFace,
  level: number,
  x: number,
  y: number,
): string {
  return [
    'veg',
    VEGETATION_CACHE_VERSION,
    planetCacheId(planet, seed),
    seed,
    settingsHash,
    face,
    level,
    x,
    y,
  ].join(':');
}
