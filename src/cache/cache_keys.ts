import { terrainFingerprint } from '../world/terrain_fingerprint';
import { TERRAIN_TEXTURE_REPEAT_METERS } from '../render/planet_tiles/domain/texture_layers';
import type { CubeFace, Planet, VegetationSettings } from '../types';

// v5: terrain region masks, rivers, and biome-gated rock/snow blending change
// baked colors and splat weights without necessarily changing heights.
export const TERRAIN_CACHE_VERSION = `v5r${TERRAIN_TEXTURE_REPEAT_METERS}`;
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
