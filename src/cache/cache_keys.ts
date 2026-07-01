import type { CubeFace, Planet, VegetationSettings } from '../types';

export const TERRAIN_CACHE_VERSION = 'v3';
export const VEGETATION_CACHE_VERSION = 'v1';

export function planetCacheId(planet: Planet): string {
  return `${planet.radiusMeters}|${planet.terrainAmplitudeMeters}`;
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
    planetCacheId(planet),
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
    planetCacheId(planet),
    seed,
    settingsHash,
    face,
    level,
    x,
    y,
  ].join(':');
}
