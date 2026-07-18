import * as THREE from 'three';
import type { Planet, VegetationSettings, Vec3 } from '../../types';
import { cartesianFromLatLonAlt } from '../../world/coordinates';
import { samplePlanetSurface } from '../../world/planet_surface';
import {
  canPlaceWithGap,
  createPlacementGrid,
  registerPlacement,
} from '../../render/vegetation/domain/placement_grid';
import { clamp01, hash01, lerp } from '../../render/vegetation/domain/hash';
import { composeInstanceMatrix } from '../../render/vegetation/domain/instance_matrix';
import type { StoredVegetationInstance } from '../../render/vegetation/domain/storage';
import {
  disposeInstancedAssets,
  loadInstancedAssetCatalog,
  type InstancedAsset,
  type InstancedAssetCatalog,
} from '../../render/vegetation/render/instanced_assets';
import { grassScaleCoverageMultiplier } from '../../render/vegetation/settings';

/** Match heightfield patch in planet_authoring.ts. */
export const PREVIEW_HALF_EXTENT_RADIANS = 0.012;
export const PREVIEW_PATCH_EXTENT_METERS = 2_400;
export const PREVIEW_HEIGHT_SCALE = 0.08;

/**
 * Bounded sample budgets so Preview never freezes the editor tab.
 * Density is linear: sampleCount = base * density (clamped to max).
 * Grass base is tuned so density=1 reads as a full carpet across the patch;
 * density=0.1 matches the old sparse density=1 look.
 */
const PREVIEW_GRASS_BASE_SAMPLES = 22_000;
const PREVIEW_TREE_BASE_SAMPLES = 400;
/** High enough for density=1 carpet at small authored scales (0.1–0.5). */
const PREVIEW_MAX_GRASS = 120_000;
const PREVIEW_MAX_TREES = 4_000;
/**
 * Plant size multiplier for the compressed heightfield + orbit camera.
 * Play uses real meters; here ~1 m grass is invisible across a 2.4 km patch.
 */
const PREVIEW_GRASS_VISUAL_SCALE = 30;
const PREVIEW_TREE_VISUAL_SCALE = 12;
/**
 * Fraction of the heightfield UV span used for planting (centered).
 * 1 = fill the whole preview square.
 */
export const PREVIEW_PLANT_RADIUS_FRACTION = 1;

const UP: Vec3 = { x: 0, y: 1, z: 0 };

export interface PlanetPreviewPatch {
  halfExtentRadians: number;
  heightScale: number;
  hint: { latRadians: number; lonRadians: number };
  patchExtentMeters: number;
}

export interface PreviewVegetationHandle {
  group: THREE.Group;
  grassCount: number;
  treeCount: number;
  dispose: () => void;
}

/** hash01 can return negatives when the final XOR leaves a signed int. */
function unitHash(seed: number, ...values: number[]): number {
  const h = hash01(seed, ...values);
  return h - Math.floor(h);
}

function previewSampleCount(base: number, max: number, density: number): number {
  if (!(density > 0)) return 0;
  return Math.min(max, Math.max(0, Math.round(base * density)));
}

function collectLayerInstances(
  planet: Planet,
  seed: number,
  patch: PlanetPreviewPatch,
  sampleCount: number,
  salt: number,
  assetCount: number,
  gapMeters: number,
  visualScale: number,
  baseOffsets: readonly number[],
  accept: (surface: ReturnType<typeof samplePlanetSurface>, i: number) => boolean,
  makeScale: (surface: ReturnType<typeof samplePlanetSurface>, i: number) => number,
): StoredVegetationInstance[] {
  if (sampleCount <= 0 || assetCount <= 0) return [];
  const instances: StoredVegetationInstance[] = [];
  const grid = createPlacementGrid(gapMeters);

  for (let i = 0; i < sampleCount; i += 1) {
    // Sample across the full heightfield UV span (or a centered fraction).
    const u =
      0.5 +
      (unitHash(seed, salt, i, 1) - 0.5) * PREVIEW_PLANT_RADIUS_FRACTION;
    const v =
      0.5 +
      (unitHash(seed, salt, i, 2) - 0.5) * PREVIEW_PLANT_RADIUS_FRACTION;
    const lat =
      patch.hint.latRadians + (v - 0.5) * 2 * patch.halfExtentRadians;
    const lon =
      patch.hint.lonRadians + (u - 0.5) * 2 * patch.halfExtentRadians;
    const localX = (u - 0.5) * patch.patchExtentMeters;
    const localZ = (v - 0.5) * patch.patchExtentMeters;

    const probe = cartesianFromLatLonAlt(lat, lon, 0, planet.radiusMeters);
    const surface = samplePlanetSurface(planet, seed, probe);
    if (!accept(surface, i)) continue;

    const scaleValue = makeScale(surface, i) * visualScale;
    const variantIndex = Math.min(
      assetCount - 1,
      Math.floor(unitHash(seed, salt, i, 3) * assetCount),
    );
    // Pivot lift stays in preview space (height already compressed).
    const offsetY = (baseOffsets[variantIndex] ?? 0) * scaleValue;
    const position: Vec3 = {
      x: localX,
      y: surface.heightMeters * patch.heightScale + offsetY,
      z: localZ,
    };
    if (!canPlaceWithGap(grid, position)) continue;
    registerPlacement(grid, position);

    instances.push({
      matrix: composeInstanceMatrix(
        position,
        UP,
        unitHash(seed, salt, i, 4) * Math.PI * 2,
        scaleValue,
      ),
      variantIndex,
    });
  }
  return instances;
}

export function collectPreviewVegetation(
  planet: Planet,
  seed: number,
  patch: PlanetPreviewPatch,
  vegetation: VegetationSettings,
  catalog: InstancedAssetCatalog,
): { grass: StoredVegetationInstance[]; trees: StoredVegetationInstance[] } {
  const grassSettings = vegetation.grass;
  const treeSettings = vegetation.tree;
  // Linear density: 0 = none, 1 = carpet reference, 2 = 2×. Scale compensation
  // keeps coverage when min/max scale shrink (small blades need more instances).
  const grassCoverage = grassScaleCoverageMultiplier(
    grassSettings.minScale,
    grassSettings.maxScale,
  );
  const grassSampleCount = previewSampleCount(
    PREVIEW_GRASS_BASE_SAMPLES,
    PREVIEW_MAX_GRASS,
    grassSettings.density * grassCoverage,
  );
  const treeSampleCount = previewSampleCount(
    PREVIEW_TREE_BASE_SAMPLES,
    PREVIEW_MAX_TREES,
    treeSettings.density,
  );

  const grass = collectLayerInstances(
    planet,
    seed,
    patch,
    grassSampleCount,
    8201,
    catalog.grass.length,
    grassSettings.gapMeters,
    PREVIEW_GRASS_VISUAL_SCALE,
    catalog.grass.map((asset) => asset.baseOffsetY),
    (surface, i) => {
      if (!(surface.biome === 'plains' || surface.biome === 'forest')) {
        return false;
      }
      if (surface.grassDensity <= 0) return false;
      return unitHash(seed, 8205, i) <= Math.min(1, surface.grassDensity * 1.4);
    },
    (surface, i) =>
      lerp(
        grassSettings.minScale,
        grassSettings.maxScale,
        clamp01(surface.grassDensity * 0.35 + unitHash(seed, 8203, i) * 0.8),
      ),
  );

  const trees = collectLayerInstances(
    planet,
    seed,
    patch,
    treeSampleCount,
    8301,
    catalog.trees.length,
    treeSettings.gapMeters,
    PREVIEW_TREE_VISUAL_SCALE,
    catalog.trees.map((asset) => asset.baseOffsetY),
    (surface, i) => {
      if (!(surface.biome === 'plains' || surface.biome === 'forest')) {
        return false;
      }
      if (surface.treeDensity <= 0) return false;
      return unitHash(seed, 8305, i) <= Math.min(1, surface.treeDensity * 1.8);
    },
    (surface, i) =>
      lerp(
        treeSettings.minScale,
        treeSettings.maxScale,
        clamp01(surface.treeDensity * 0.45 + unitHash(seed, 8303, i) * 0.7),
      ),
  );

  return { grass, trees };
}

function packByVariant(
  instances: StoredVegetationInstance[],
  assetCount: number,
): Float32Array[] {
  const counts = new Array<number>(assetCount).fill(0);
  for (const instance of instances) {
    const index = Math.max(0, Math.min(assetCount - 1, instance.variantIndex));
    counts[index] += 1;
  }
  const packed = counts.map((count) => new Float32Array(count * 16));
  const offsets = new Array<number>(assetCount).fill(0);
  for (const instance of instances) {
    const index = Math.max(0, Math.min(assetCount - 1, instance.variantIndex));
    packed[index]!.set(instance.matrix, offsets[index]!);
    offsets[index]! += 16;
  }
  return packed;
}

function addInstancedMeshes(
  group: THREE.Group,
  assets: InstancedAsset[],
  instances: StoredVegetationInstance[],
  castShadow: boolean,
): void {
  if (assets.length === 0 || instances.length === 0) return;
  const packed = packByVariant(instances, assets.length);
  for (let assetIndex = 0; assetIndex < assets.length; assetIndex += 1) {
    const asset = assets[assetIndex]!;
    const matrices = packed[assetIndex]!;
    const count = matrices.length / 16;
    if (count === 0 || asset.parts.length === 0) continue;
    for (const part of asset.parts) {
      const mesh = new THREE.InstancedMesh(part.geometry, part.material, count);
      mesh.castShadow = castShadow;
      mesh.receiveShadow = false;
      mesh.frustumCulled = false;
      mesh.count = count;
      const matrix = new THREE.Matrix4();
      for (let i = 0; i < count; i += 1) {
        matrix.fromArray(matrices, i * 16);
        mesh.setMatrixAt(i, matrix);
      }
      mesh.instanceMatrix.needsUpdate = true;
      group.add(mesh);
    }
  }
}

/**
 * Load authored grass/tree assets and build a disposable preview group in the
 * same local space as the Planet Authoring heightfield patch.
 */
export function buildPreviewVegetation(
  planet: Planet,
  seed: number,
  patch: PlanetPreviewPatch,
  vegetation: VegetationSettings,
  onReady: (handle: PreviewVegetationHandle) => void,
  onError?: (message: string) => void,
): { cancel: () => void } {
  let cancelled = false;
  const grassUrls = (vegetation.grass.assetUrls ?? []).filter(
    (url) => typeof url === 'string' && url.length > 0,
  );
  const treeUrls = (vegetation.tree.assetUrls ?? []).filter(
    (url) => typeof url === 'string' && url.length > 0,
  );

  loadInstancedAssetCatalog(
    {
      grassUrls,
      treeUrls,
      grassColor: vegetation.grass.color,
    },
    (catalog) => {
      if (cancelled) {
        disposeInstancedAssets(catalog.grass);
        disposeInstancedAssets(catalog.trees);
        return;
      }
      const { grass, trees } = collectPreviewVegetation(
        planet,
        seed,
        patch,
        vegetation,
        catalog,
      );
      const group = new THREE.Group();
      group.name = 'planet-preview-vegetation';
      addInstancedMeshes(group, catalog.grass, grass, false);
      addInstancedMeshes(group, catalog.trees, trees, true);

      onReady({
        group,
        grassCount: grass.length,
        treeCount: trees.length,
        dispose: () => {
          group.removeFromParent();
          while (group.children.length > 0) {
            group.remove(group.children[0]!);
          }
          disposeInstancedAssets(catalog.grass);
          disposeInstancedAssets(catalog.trees);
        },
      });
    },
    (path, label, error) => {
      const detail = error instanceof Error ? error.message : String(error);
      onError?.(`Failed to load ${label} asset ${path}: ${detail}`);
    },
  );

  return {
    cancel: () => {
      cancelled = true;
    },
  };
}
