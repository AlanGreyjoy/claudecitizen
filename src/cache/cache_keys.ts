import { terrainFingerprint } from '../world/terrain_fingerprint';
import type { CubeFace, Planet, VegetationSettings } from '../types';

export const TERRAIN_CACHE_VERSION = 'v3';
// v3: hash01 gained a proper finalizer, changing all vegetation placement.
export const VEGETATION_CACHE_VERSION = 'v3';

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
