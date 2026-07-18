import { terrainFingerprint } from '../world/terrain_fingerprint';
import type {
  CubeFace,
  Planet,
  PlanetSpawnCatalog,
  PlanetSpawnEntry,
  PlanetSpawnLayer,
  VegetationSettings,
} from '../types';
import { getActivePlanetConfig } from '../world/planets/runtime';

// Low-poly tiles use a non-indexed triangle layout with baked facet colors.
// Keep this explicit because the height fingerprint does not capture buffer
// layout or palette-only changes.
export const TERRAIN_CACHE_VERSION = 'mulberry-uniform-lod-stitched-routed-l17-v7';
// v15: quality sample budgets (grass/tree counts) are part of the storage key.
export const VEGETATION_CACHE_VERSION = 'v15';
/** Bump when surface-spawn placement algorithm or stored spawn-tile schema changes. */
export const SURFACE_SPAWN_CACHE_VERSION = 'v3-idb';

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
  const numbers = [
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
  const grassAssets = (grass.assetUrls ?? []).join('|');
  const treeAssets = (tree.assetUrls ?? []).join('|');
  return `${numbers};g:${grassAssets};t:${treeAssets}`;
}

/**
 * Quality presets change per-tile sample budgets without touching authored
 * settings. Include them in the disk key so performance/balanced/high cannot
 * share tiles (and so agents stop bumping VEGETATION_CACHE_VERSION for that).
 */
export function hashVegetationQualityBudgets(
  grassSampleCount: number,
  treeSampleCount: number,
): string {
  return `q${Math.round(grassSampleCount)}/${Math.round(treeSampleCount)}`;
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

function hashSurfaceSpawnEntry(entry: PlanetSpawnEntry | PlanetSpawnLayer): string {
  return [
    entry.id,
    entry.enabled ? 1 : 0,
    entry.assetUrl,
    entry.weight.toFixed(3),
    entry.density.toFixed(3),
    entry.gapMeters.toFixed(3),
    entry.minScale.toFixed(3),
    entry.maxScale.toFixed(3),
    entry.biomes.join(','),
    entry.minNormalizedHeight.toFixed(4),
    entry.maxNormalizedHeight.toFixed(4),
    entry.alignToNormal ? 1 : 0,
    (entry.terrainInsetMeters ?? 0).toFixed(3),
    entry.collider.shape,
    (entry.collider.halfExtents ?? [0, 0, 0]).map((v) => v.toFixed(3)).join('x'),
    (entry.collider.radius ?? 0).toFixed(3),
    (entry.collider.halfHeight ?? 0).toFixed(3),
    entry.seedOffset,
  ].join('|');
}

/** Hash entry list only (legacy / physics-adjacent callers). */
export function hashSurfaceSpawnLayers(
  layers: readonly PlanetSpawnEntry[] | readonly PlanetSpawnLayer[],
): string {
  return layers.map(hashSurfaceSpawnEntry).join(';');
}

/** Full catalog hash for cache invalidation (settings + entries). */
export function hashSurfaceSpawnCatalog(catalog: PlanetSpawnCatalog): string {
  return [
    `s${Math.round(catalog.samplesPerTile)}`,
    `d${catalog.density.toFixed(3)}`,
    hashSurfaceSpawnLayers(catalog.entries),
  ].join('#');
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
