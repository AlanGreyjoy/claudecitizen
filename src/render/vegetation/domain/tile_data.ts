import type { VegetationAssetCatalog } from './asset_catalog';
import type { Planet, TileInfo, VegetationSettings, Vec3 } from '../../../types';
import { scale, sub } from '../../../math/vec3';
import { directionFromCubeFace } from '../../../world/cube_sphere';
import { classifyBiome, vegetationDensitiesForBiome } from '../../../world/climate';
import { sampleRenderablePlanetSurface } from '../../../world/planet_surface';
import {
  sampleRenderableSurfaceHeightDetails,
  sampleVisibleSurfaceFrame,
} from '../../../world/renderable_surface';
import {
  FACE_INDEX,
  getGrassSampleCount,
  getTreeSampleCount,
  grassSampleMultiplier,
  treeSampleMultiplier,
} from './constants';
import { clamp01, hash01, lerp, scaledSampleCount } from './hash';
import { composeInstanceMatrix } from './instance_matrix';
import {
  canPlaceWithGap,
  createPlacementGrid,
  registerPlacement,
} from './placement_grid';
import { createAnchorFromTile, type SurfaceAnchor } from './surface_anchor';
import type { StoredVegetationInstance, StoredVegetationTile } from './storage';

type AllowPlacementFn = (surface: import('../../../types').PlanetSurfaceSample, i: number) => boolean;
type MakeScaleFn = (surface: import('../../../types').PlanetSurfaceSample, i: number) => number;
type GetNormalOffsetFn = (
  surface: import('../../../types').PlanetSurfaceSample,
  i: number,
  variantIndex: number,
) => number;
type MakeBasisNormalFn = (
  surface: import('../../../types').PlanetSurfaceSample,
  direction: Vec3,
  i: number,
) => Vec3;
type MakeVariantIndexFn = (
  surface: import('../../../types').PlanetSurfaceSample,
  i: number,
) => number;

type PlanetSurfaceSample = import('../../../types').PlanetSurfaceSample;

// Full climate sampling (temperature/moisture/lake noise) per placed instance
// dominates tile build cost at lush densities. Climate varies slowly across a
// tile, so sample it on a coarse grid and only resolve exact height + normal
// per instance from the (cached) renderable surface grid.
const CLIMATE_GRID_CELLS = 6;

function createTileSurfaceSampler(
  tileInfo: TileInfo,
  planet: Planet,
  seed: number,
): (u: number, v: number, direction: Vec3) => PlanetSurfaceSample {
  const climateCells: (PlanetSurfaceSample | null)[] = new Array(
    CLIMATE_GRID_CELLS * CLIMATE_GRID_CELLS,
  ).fill(null);
  const { u0, u1, v0, v1 } = tileInfo.bounds;

  return (u, v, direction) => {
    const gridU = Math.min(
      CLIMATE_GRID_CELLS - 1,
      Math.max(0, Math.floor(((u - u0) / (u1 - u0)) * CLIMATE_GRID_CELLS)),
    );
    const gridV = Math.min(
      CLIMATE_GRID_CELLS - 1,
      Math.max(0, Math.floor(((v - v0) / (v1 - v0)) * CLIMATE_GRID_CELLS)),
    );
    const cellIndex = gridV * CLIMATE_GRID_CELLS + gridU;

    let climate = climateCells[cellIndex];
    if (!climate) {
      const cellU = u0 + ((gridU + 0.5) / CLIMATE_GRID_CELLS) * (u1 - u0);
      const cellV = v0 + ((gridV + 0.5) / CLIMATE_GRID_CELLS) * (v1 - v0);
      const cellDirection = directionFromCubeFace(tileInfo.face, cellU, cellV);
      climate = sampleRenderablePlanetSurface(
        planet,
        seed,
        scale(cellDirection, planet.radiusMeters),
      );
      climateCells[cellIndex] = climate;
    }

    // Height/details only for accept/reject. Normals are filled in after
    // placement is accepted (corners stay cache-warm from this sample).
    const heightSample = sampleRenderableSurfaceHeightDetails(
      planet,
      seed,
      scale(direction, planet.radiusMeters),
    );
    const normalizedHeight =
      heightSample.heightMeters / planet.terrainAmplitudeMeters;
    // The coarse cell's biome can differ from the instance's real biome near
    // shorelines, lakes, and peaks (a cell centered on plains extends into
    // ocean). Re-classify with the exact per-instance height so vegetation
    // never lands on beaches or under water; temperature/moisture/lake level
    // still come from the cheap coarse sample.
    const biome = classifyBiome({
      heightMeters: heightSample.heightMeters,
      lakeWaterLevelMeters: climate.lakeWaterLevelMeters,
      moisture: climate.moisture,
      mountainRegion:
        heightSample.heightDetails.mountainRegion ?? climate.mountainRegion,
      normalizedHeight,
      riverWaterLevelMeters: climate.riverWaterLevelMeters,
      temperature: climate.temperature,
    });
    const densities = vegetationDensitiesForBiome(biome, climate.moisture);
    return {
      ...climate,
      biome,
      fertility: densities.fertility,
      grassDensity: densities.grassDensity,
      heightMeters: heightSample.heightMeters,
      mountainRegion:
        heightSample.heightDetails.mountainRegion ?? climate.mountainRegion,
      normal: direction,
      normalizedHeight,
      surfaceRadiusMeters: planet.radiusMeters + heightSample.heightMeters,
      treeDensity: densities.treeDensity,
    };
  };
}

function buildInstanceEntries(
  anchor: SurfaceAnchor,
  tileInfo: TileInfo,
  planet: Planet,
  seed: number,
  sampleCount: number,
  allowPlacement: AllowPlacementFn,
  makeScale: MakeScaleFn,
  getNormalOffset: GetNormalOffsetFn | null = null,
  makeBasisNormal: MakeBasisNormalFn | null = null,
  makeVariantIndex: MakeVariantIndexFn | null = null,
  minimumGapMeters = 0,
): StoredVegetationInstance[] {
  const entries: StoredVegetationInstance[] = [];
  const faceIndex = FACE_INDEX[tileInfo.face] ?? 0;
  const placementGrid = createPlacementGrid(minimumGapMeters);
  const sampleSurface = createTileSurfaceSampler(tileInfo, planet, seed);

  for (let i = 0; i < sampleCount; i += 1) {
    const uJitter = hash01(
      seed,
      faceIndex,
      tileInfo.level,
      tileInfo.x,
      tileInfo.y,
      i,
      11,
    );
    const vJitter = hash01(
      seed,
      faceIndex,
      tileInfo.level,
      tileInfo.x,
      tileInfo.y,
      i,
      29,
    );
    const u =
      tileInfo.bounds.u0 + (tileInfo.bounds.u1 - tileInfo.bounds.u0) * uJitter;
    const v =
      tileInfo.bounds.v0 + (tileInfo.bounds.v1 - tileInfo.bounds.v0) * vJitter;
    const direction = directionFromCubeFace(tileInfo.face, u, v);
    const surface = sampleSurface(u, v, direction);

    if (!allowPlacement(surface, i)) continue;

    // Reuse the surface sample above instead of re-sampling the planet: the
    // second full sample (noise + climate + lakes) doubled tile build cost.
    const worldPosition: Vec3 = {
      x: direction.x * surface.surfaceRadiusMeters,
      y: direction.y * surface.surfaceRadiusMeters,
      z: direction.z * surface.surfaceRadiusMeters,
    };
    // Reject path used a radial placeholder normal. Resolve the triangle
    // normal only for accepted grass (trees usually pass makeBasisNormal).
    const basisNormal =
      makeBasisNormal?.(surface, direction, i) ??
      sampleVisibleSurfaceFrame(
        planet,
        seed,
        scale(direction, planet.radiusMeters),
      ).normal;
    const normal = normalizeVec3(basisNormal.x, basisNormal.y, basisNormal.z);
    let localPosition = sub(worldPosition, anchor.position);
    if (!canPlaceWithGap(placementGrid, localPosition)) continue;
    registerPlacement(placementGrid, localPosition);

    const yaw =
      hash01(seed, faceIndex, tileInfo.level, tileInfo.x, tileInfo.y, i, 47) *
      Math.PI *
      2;
    const scaleValue = makeScale(surface, i);
    const variantIndex = makeVariantIndex?.(surface, i) ?? 0;
    if (getNormalOffset) {
      const offset = getNormalOffset(surface, i, variantIndex) * scaleValue;
      localPosition = {
        x: localPosition.x + normal.x * offset,
        y: localPosition.y + normal.y * offset,
        z: localPosition.z + normal.z * offset,
      };
    }

    entries.push({
      matrix: composeInstanceMatrix(localPosition, normal, yaw, scaleValue),
      variantIndex,
    });
  }

  return entries;
}

function normalizeVec3(x: number, y: number, z: number): Vec3 {
  const len = Math.hypot(x, y, z);
  if (len < 1e-9) return { x: 0, y: 1, z: 0 };
  return { x: x / len, y: y / len, z: z / len };
}

export function collectTileVegetationData(
  tileInfo: TileInfo,
  planet: Planet,
  seed: number,
  assets: VegetationAssetCatalog,
  vegetationSettings: VegetationSettings,
): StoredVegetationTile {
  const anchor = createAnchorFromTile(tileInfo, planet, seed);
  const grassSettings = vegetationSettings.grass;
  const treeSettings = vegetationSettings.tree;
  // Density is authored as a feel multiplier: use a mild super-linear curve so
  // 2×–4× reads as clearly denser, not "barely more attempts."
  const grassDensityScale =
    grassSettings.density <= 0
      ? 0
      : Math.pow(grassSettings.density, 1.35);
  const grassSampleCount = scaledSampleCount(
    getGrassSampleCount() * grassSampleMultiplier(tileInfo.level),
    grassDensityScale,
  );
  const treeSampleCount = scaledSampleCount(
    getTreeSampleCount() * treeSampleMultiplier(tileInfo.level),
    treeSettings.density,
  );

  let grass: StoredVegetationInstance[] = [];
  if (assets.grass.length > 0 && grassSampleCount > 0) {
    grass = buildInstanceEntries(
      anchor,
      tileInfo,
      planet,
      seed,
      grassSampleCount,
      (surface, i) =>
        (surface.biome === 'plains' || surface.biome === 'forest') &&
        hash01(seed, tileInfo.level, tileInfo.x, tileInfo.y, i, 71) <
          Math.min(
            1,
            surface.grassDensity * 1.35 * Math.max(1, Math.sqrt(grassSettings.density)),
          ),
      (surface, i) =>
        lerp(
          grassSettings.minScale,
          grassSettings.maxScale,
          clamp01(
            surface.grassDensity * 0.35 +
              hash01(seed, tileInfo.x, tileInfo.y, i, 83) * 0.8,
          ),
        ),
      (_surface, _i, variantIndex) =>
        assets.grass[variantIndex]?.baseOffsetY ?? 0,
      null,
      (_surface, _i) =>
        Math.floor(
          hash01(seed, tileInfo.level, tileInfo.x, tileInfo.y, _i, 313) *
            assets.grass.length,
        ),
      grassSettings.gapMeters,
    );
  }

  let trees: StoredVegetationInstance[] = [];
  if (assets.trees.length > 0 && treeSampleCount > 0) {
    trees = buildInstanceEntries(
      anchor,
      tileInfo,
      planet,
      seed,
      treeSampleCount,
      (surface, i) =>
        (surface.biome === 'plains' || surface.biome === 'forest') &&
        surface.treeDensity > 0 &&
        hash01(seed, tileInfo.level, tileInfo.x, tileInfo.y, i, 101) <
          Math.min(1, surface.treeDensity * 1.18),
      (surface, i) =>
        lerp(
          treeSettings.minScale,
          treeSettings.maxScale,
          clamp01(
            surface.treeDensity * 0.55 +
              hash01(seed, tileInfo.x, tileInfo.y, i, 131) * 0.75,
          ),
        ),
      (_surface, _i, variantIndex) => assets.trees[variantIndex]?.baseOffsetY ?? 0,
      (_surface, direction) => direction,
      (_surface, _i) =>
        Math.floor(
          hash01(seed, tileInfo.level, tileInfo.x, tileInfo.y, _i, 199) *
            assets.trees.length,
        ),
      treeSettings.gapMeters,
    );
  }

  return {
    anchor: {
      x: anchor.position.x,
      y: anchor.position.y,
      z: anchor.position.z,
    },
    grass,
    trees,
  };
}
