import type { Planet, VegetationSettings, Vec3 } from '../../../types';
import { add, scale, sub } from '../../../math/vec3';
import { cartesianFromLatLonAlt } from '../../../world/coordinates';
import { resolveLandingSite } from '../../../world/landing_sites';
import {
  renderableSurfacePointFromDirection,
  sampleRenderablePlanetSurface,
} from '../../../world/planet_surface';
import type { VegetationAssetCatalog } from './asset_catalog';
import {
  getLandingGrassCount,
  getLandingTreeCount,
} from './constants';
import { clamp01, hash01, lerp, scaledSampleCount } from './hash';
import { composeInstanceMatrix } from './instance_matrix';
import {
  canPlaceWithGap,
  createPlacementGrid,
  registerPlacement,
} from './placement_grid';
import { createAnchorFromDirection } from './surface_anchor';
import type { StoredVegetationInstance, StoredVegetationTile } from './storage';

function normalizeVec3(x: number, y: number, z: number): Vec3 {
  const len = Math.hypot(x, y, z);
  if (len < 1e-9) return { x: 0, y: 1, z: 0 };
  return { x: x / len, y: y / len, z: z / len };
}

function radialWorldPoint(
  anchorNormal: Vec3,
  anchorTangent: Vec3,
  anchorBitangent: Vec3,
  planetRadiusMeters: number,
  offsetX: number,
  offsetZ: number,
): Vec3 {
  const scaledNormal = scale(anchorNormal, planetRadiusMeters);
  const tangentOffset = scale(anchorTangent, offsetX);
  const bitangentOffset = scale(anchorBitangent, offsetZ);
  const combined = add(add(scaledNormal, tangentOffset), bitangentOffset);
  return scale(normalizeVec3(combined.x, combined.y, combined.z), planetRadiusMeters);
}

export function collectLandingGroveData(
  planet: Planet,
  seed: number,
  assets: VegetationAssetCatalog,
  vegetationSettings: VegetationSettings,
): StoredVegetationTile | null {
  const landingSite = resolveLandingSite(planet, seed);
  const anchorProbe = cartesianFromLatLonAlt(
    landingSite.latRadians,
    landingSite.lonRadians,
    0,
    planet.radiusMeters,
  );
  const anchorDirection = normalizeVec3(
    anchorProbe.x,
    anchorProbe.y,
    anchorProbe.z,
  );
  const anchor = createAnchorFromDirection(anchorDirection, planet, seed);

  if (!(anchor.surface.biome === 'plains' || anchor.surface.biome === 'forest')) {
    return {
      anchor: {
        x: anchor.position.x,
        y: anchor.position.y,
        z: anchor.position.z,
      },
      grass: [],
      trees: [],
    };
  }

  const grassSettings = vegetationSettings.grass;
  const treeSettings = vegetationSettings.tree;
  const grassSampleCount = scaledSampleCount(
    getLandingGrassCount(),
    grassSettings.density,
  );
  const treeSampleCount = scaledSampleCount(
    getLandingTreeCount(),
    treeSettings.density,
  );

  const grass: StoredVegetationInstance[] = [];
  if (assets.grass.length > 0 && grassSampleCount > 0) {
    const grassPlacementGrid = createPlacementGrid(grassSettings.gapMeters);
    for (let i = 0; i < grassSampleCount; i += 1) {
      const angle = hash01(seed, 7001, i) * Math.PI * 2;
      const radiusMeters = 25 + hash01(seed, 7002, i) * 330;
      const offsetX = Math.cos(angle) * radiusMeters;
      const offsetZ = Math.sin(angle) * radiusMeters;
      const worldPoint = radialWorldPoint(
        anchor.normal,
        anchor.tangent,
        anchor.bitangent,
        planet.radiusMeters,
        offsetX,
        offsetZ,
      );
      const surface = sampleRenderablePlanetSurface(planet, seed, worldPoint);
      if (!(surface.biome === 'plains' || surface.biome === 'forest')) continue;
      if (hash01(seed, 7005, i) > Math.min(1, surface.grassDensity * 1.4))
        continue;

      const placementDirection: Vec3 = {
        x: worldPoint.x,
        y: worldPoint.y,
        z: worldPoint.z,
      };
      const normal = normalizeVec3(
        surface.normal?.x ?? worldPoint.x,
        surface.normal?.y ?? worldPoint.y,
        surface.normal?.z ?? worldPoint.z,
      );
      const grassPoint = renderableSurfacePointFromDirection(
        placementDirection,
        planet,
        seed,
        0,
      );
      let localPosition = sub(
        { x: grassPoint.x, y: grassPoint.y, z: grassPoint.z },
        anchor.position,
      );
      if (!canPlaceWithGap(grassPlacementGrid, localPosition)) continue;
      registerPlacement(grassPlacementGrid, localPosition);
      const assetIndex = Math.floor(hash01(seed, 7006, i) * assets.grass.length);
      const scaleValue = lerp(
        grassSettings.minScale,
        grassSettings.maxScale,
        clamp01(surface.grassDensity * 0.35 + hash01(seed, 7003, i) * 0.8),
      );
      const offset = (assets.grass[assetIndex]?.baseOffsetY ?? 0) * scaleValue;
      localPosition = {
        x: localPosition.x + normal.x * offset,
        y: localPosition.y + normal.y * offset,
        z: localPosition.z + normal.z * offset,
      };
      grass.push({
        matrix: composeInstanceMatrix(
          localPosition,
          normal,
          hash01(seed, 7004, i) * Math.PI * 2,
          scaleValue,
        ),
        variantIndex: assetIndex,
      });
    }
  }

  const trees: StoredVegetationInstance[] = [];
  if (assets.trees.length > 0 && treeSampleCount > 0) {
    const treePlacementGrid = createPlacementGrid(treeSettings.gapMeters);
    for (let i = 0; i < treeSampleCount; i += 1) {
      const angle = hash01(seed, 7101, i) * Math.PI * 2;
      const radiusMeters = 24 + hash01(seed, 7102, i) * 235;
      const offsetX = Math.cos(angle) * radiusMeters;
      const offsetZ = Math.sin(angle) * radiusMeters;
      const worldPoint = radialWorldPoint(
        anchor.normal,
        anchor.tangent,
        anchor.bitangent,
        planet.radiusMeters,
        offsetX,
        offsetZ,
      );
      const surface = sampleRenderablePlanetSurface(planet, seed, worldPoint);
      if (!(surface.biome === 'plains' || surface.biome === 'forest')) continue;
      if (surface.treeDensity <= 0) continue;
      if (hash01(seed, 7105, i) > Math.min(1, surface.treeDensity * 1.1))
        continue;

      const placementDirection: Vec3 = {
        x: worldPoint.x,
        y: worldPoint.y,
        z: worldPoint.z,
      };
      const normal = normalizeVec3(worldPoint.x, worldPoint.y, worldPoint.z);
      const treePoint = renderableSurfacePointFromDirection(
        placementDirection,
        planet,
        seed,
        0,
      );
      let localPosition = sub(
        { x: treePoint.x, y: treePoint.y, z: treePoint.z },
        anchor.position,
      );
      if (!canPlaceWithGap(treePlacementGrid, localPosition)) continue;
      registerPlacement(treePlacementGrid, localPosition);
      const scaleValue = lerp(
        treeSettings.minScale,
        treeSettings.maxScale,
        clamp01(surface.treeDensity * 0.55 + hash01(seed, 7103, i) * 0.75),
      );
      const pineIndex = Math.floor(hash01(seed, 7201, i) * assets.trees.length);
      const baseOffsetY = assets.trees[pineIndex]?.baseOffsetY ?? 0;
      localPosition = {
        x: localPosition.x + normal.x * baseOffsetY * scaleValue,
        y: localPosition.y + normal.y * baseOffsetY * scaleValue,
        z: localPosition.z + normal.z * baseOffsetY * scaleValue,
      };
      trees.push({
        matrix: composeInstanceMatrix(
          localPosition,
          normal,
          hash01(seed, 7104, i) * Math.PI * 2,
          scaleValue,
        ),
        variantIndex: pineIndex,
      });
    }
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
