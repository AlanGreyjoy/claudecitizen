import type { VegetationAssetCatalog } from './asset_catalog';
import type { Planet, TileInfo, VegetationSettings, Vec3 } from '../../../types';
import { scale, sub } from '../../../math/vec3';
import { directionFromCubeFace } from '../../../world/cube_sphere';
import {
  renderableSurfacePointFromDirection,
  sampleRenderablePlanetSurface,
} from '../../../world/planet_surface';
import {
  FACE_INDEX,
  getGrassSampleCount,
  getTreeSampleCount,
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
    const surface = sampleRenderablePlanetSurface(
      planet,
      seed,
      scale(direction, planet.radiusMeters),
    );

    if (!allowPlacement(surface, i)) continue;

    const point = renderableSurfacePointFromDirection(
      direction,
      planet,
      seed,
      0,
    );
    const worldPosition: Vec3 = { x: point.x, y: point.y, z: point.z };
    const basisNormal =
      makeBasisNormal?.(surface, direction, i) ?? surface.normal ?? direction;
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
  const grassSampleCount = scaledSampleCount(
    getGrassSampleCount(),
    grassSettings.density,
  );
  const treeSampleCount = scaledSampleCount(
    getTreeSampleCount(),
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
          Math.min(1, surface.grassDensity * 1.35),
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
