import { terrainFingerprint } from '../world/terrain-fingerprint';
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
// v17: the renderable-surface blend and the river proximity test were rewritten
// to scalar form. Algebraically identical, but the summation order moved, so
// stored heights can differ in the last ULP from v16 tiles.
// v18: packed color and normal attributes went from 3 to 4 components. WebGPU
// defines no unorm8x3 / snorm16x3 vertex format and requires a stride that is a
// multiple of 4, so cached v17 buffers are the wrong length for the new layout.
// v19: stored tiles carry the band-limited height raster next to the vertex
// buffers, so a disk hit warms the page table instead of leaving the main
// thread to re-evaluate the field. v18 records have no raster and would render
// with a permanently cold page for that tile.
// v20: the shared-grid renderer displaces one geometry from the height atlas,
// so records drop the triangulated mesh entirely and store only the raster and
// its grid colours. A v19 record has the wrong shape, not merely extra fields.
export const TERRAIN_CACHE_VERSION = 'mulberry-uniform-lod-paged-l17-v20';
// v22: placement rides on the rewritten height sampler (see terrain v17), whose
// last-ULP shifts can flip an accept/reject exactly at a density threshold.
export const VEGETATION_CACHE_VERSION = 'v22';
/** Bump when surface-spawn placement algorithm or stored spawn-tile schema changes. */
export const SURFACE_SPAWN_CACHE_VERSION = 'v9-scalar-height-sampler';

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
