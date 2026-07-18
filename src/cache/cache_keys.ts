import { terrainFingerprint } from '../world/terrain_fingerprint';
import type {
  CubeFace,
  Planet,
  PlanetSpawnLayer,
  VegetationSettings,
} from '../types';
import { getActivePlanetConfig } from '../world/planets/runtime';

// Low-poly tiles use a non-indexed triangle layout with baked facet colors.
// Keep this explicit because the height fingerprint does not capture buffer
// layout or palette-only changes.
export const TERRAIN_CACHE_VERSION = 'mulberry-bandlimited-skirts-routed-l17-v6';
// v11: denser 1× underfoot carpet.
export const VEGETATION_CACHE_VERSION = 'v11';
/** Bump when surface-spawn placement algorithm or instance schema changes. */
export const SURFACE_SPAWN_CACHE_VERSION = 'v1';

function paletteHash(): string {
  const { oceanShallow, palette, planetId } = getActivePlanetConfig();
  const values = Object.values(palette).join('|');
  return `${planetId}|${oceanShallow}|${values}`;
}

// Includes a fingerprint of the terrain generation itself so that editing the
// noise stack invalidates previously cached tiles: stale meshes are the classic
// cause of the character walking above/through the visible ground.
export function planetCacheId(planet: Planet, seed: number): string {
  const { planetId } = getActivePlanetConfig();
  return `${planetId}|${planet.radiusMeters}|${planet.terrainAmplitudeMeters}|${terrainFingerprint(planet, seed)}|${paletteHash()}`;
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
  const { planetId } = getActivePlanetConfig();
  return [
    'veg',
    VEGETATION_CACHE_VERSION,
    planetId,
    planetCacheId(planet, seed),
    seed,
    settingsHash,
    face,
    level,
    x,
    y,
  ].join(':');
}

export function hashSurfaceSpawnLayers(layers: readonly PlanetSpawnLayer[]): string {
  return layers
    .map((layer) =>
      [
        layer.id,
        layer.enabled ? 1 : 0,
        layer.assetUrl,
        layer.density.toFixed(3),
        layer.gapMeters.toFixed(3),
        layer.minScale.toFixed(3),
        layer.maxScale.toFixed(3),
        layer.biomes.join(','),
        layer.minNormalizedHeight.toFixed(4),
        layer.maxNormalizedHeight.toFixed(4),
        layer.alignToNormal ? 1 : 0,
        layer.collider.shape,
        (layer.collider.halfExtents ?? [0, 0, 0]).map((v) => v.toFixed(3)).join('x'),
        (layer.collider.radius ?? 0).toFixed(3),
        (layer.collider.halfHeight ?? 0).toFixed(3),
        layer.seedOffset,
      ].join('|'),
    )
    .join(';');
}

export function surfaceSpawnStorageKey(
  planet: Planet,
  seed: number,
  layersHash: string,
  face: CubeFace,
  level: number,
  x: number,
  y: number,
): string {
  const { planetId } = getActivePlanetConfig();
  return [
    'spawn',
    SURFACE_SPAWN_CACHE_VERSION,
    planetId,
    planetCacheId(planet, seed),
    seed,
    layersHash,
    face,
    level,
    x,
    y,
  ].join(':');
}
