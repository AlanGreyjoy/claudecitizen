import * as THREE from 'three';
import type {
  Planet,
  PlanetSpawnCatalog,
  PlanetSpawnEntry,
  Vec3,
} from '../../types';
import { cartesianFromLatLonAlt } from '../../world/coordinates';
import { samplePlanetSurface } from '../../world/planet_surface';
import {
  acceptsSurface,
  applyTerrainInset,
  entryLotteryWeight,
} from '../../world/surface_spawns/placement';
import {
  canPlaceWithGap,
  createPlacementGrid,
  registerPlacement,
  type PlacementGrid,
} from '../../world/surface_spawns/placement_grid';
import { clamp01, hash01, lerp, scaledSampleCount } from '../../world/surface_spawns/hash';
import { loadSurfaceSpawnAsset } from '../../render/surface_spawns/asset_cache';
import { composeSurfaceSpawnMatrix } from '../../render/surface_spawns/instance_matrix';
import type { InstancedAsset } from '../../render/vegetation/render/instanced_assets';
import {
  PREVIEW_PLANT_RADIUS_FRACTION,
  type PlanetPreviewPatch,
} from './planet_preview_vegetation';

/**
 * Bounded sample budgets so Preview never freezes the editor tab.
 * Sized for full-patch coverage alongside vegetation.
 */
const PREVIEW_SPAWN_BASE_SAMPLES = 560;
const PREVIEW_MAX_SPAWNS = 1_400;
/**
 * Prop size multiplier for the compressed heightfield + orbit camera.
 * Play uses real meters; meter-scale rocks vanish across a 2.4 km patch.
 */
const PREVIEW_SPAWN_VISUAL_SCALE = 8;

const UP: Vec3 = { x: 0, y: 1, z: 0 };

export interface PreviewSpawnHandle {
  group: THREE.Group;
  spawnCount: number;
  dispose: () => void;
}

interface PreviewSpawnInstance {
  assetUrl: string;
  matrix: Float32Array;
}

/** hash01 can return negatives when the final XOR leaves a signed int. */
function unitHash(seed: number, ...values: number[]): number {
  const h = hash01(seed, ...values);
  return h - Math.floor(h);
}

function pickWeightedEntry(
  seed: number,
  sampleIndex: number,
  candidates: readonly PlanetSpawnEntry[],
  weights: readonly number[],
): PlanetSpawnEntry | null {
  let total = 0;
  for (let i = 0; i < weights.length; i += 1) total += weights[i]!;
  if (total <= 0 || candidates.length === 0) return null;
  const roll = unitHash(seed, 9101, sampleIndex) * total;
  let cursor = 0;
  for (let i = 0; i < candidates.length; i += 1) {
    cursor += weights[i]!;
    if (roll < cursor) return candidates[i]!;
  }
  return candidates[candidates.length - 1]!;
}

export function collectPreviewSpawns(
  planet: Planet,
  seed: number,
  patch: PlanetPreviewPatch,
  catalog: PlanetSpawnCatalog,
): PreviewSpawnInstance[] {
  const entries = catalog.entries;
  if (entries.length === 0) return [];

  const catalogDensity = Math.max(0, catalog.density);
  if (catalogDensity <= 0) return [];

  const baseSamples = Math.max(
    PREVIEW_SPAWN_BASE_SAMPLES,
    Math.min(PREVIEW_MAX_SPAWNS, Math.round(catalog.samplesPerTile * 2.5)),
  );
  const densityScale = Math.pow(catalogDensity, 1.15);
  const sampleCount = Math.min(
    PREVIEW_MAX_SPAWNS,
    scaledSampleCount(baseSamples, densityScale),
  );
  if (sampleCount <= 0) return [];

  const grids = new Map<string, PlacementGrid | null>();
  const acceptScratch: PlanetSpawnEntry[] = [];
  const weightScratch: number[] = [];
  const instances: PreviewSpawnInstance[] = [];
  const seedU = seed >>> 0;

  for (let i = 0; i < sampleCount; i += 1) {
    if (instances.length >= PREVIEW_MAX_SPAWNS) break;

    const u =
      0.5 +
      (unitHash(seedU, 9201, i, 1) - 0.5) * PREVIEW_PLANT_RADIUS_FRACTION;
    const v =
      0.5 +
      (unitHash(seedU, 9201, i, 2) - 0.5) * PREVIEW_PLANT_RADIUS_FRACTION;
    const lat =
      patch.hint.latRadians + (v - 0.5) * 2 * patch.halfLatExtentRadians;
    const lon =
      patch.hint.lonRadians + (u - 0.5) * 2 * patch.halfLonExtentRadians;
    const localX = (u - 0.5) * patch.patchExtentMeters;
    const localZ = (v - 0.5) * patch.patchExtentMeters;

    const probe = cartesianFromLatLonAlt(lat, lon, 0, planet.radiusMeters);
    const surface = samplePlanetSurface(planet, seed, probe);
    if (surface.waterBody != null) continue;

    acceptScratch.length = 0;
    weightScratch.length = 0;
    for (const entry of entries) {
      if (!acceptsSurface(entry, surface.biome, surface.normalizedHeight)) {
        continue;
      }
      const w = entryLotteryWeight(entry);
      if (w <= 0) continue;
      acceptScratch.push(entry);
      weightScratch.push(w);
    }
    if (acceptScratch.length === 0) continue;

    const catalogAccept =
      unitHash(seedU, 9205, i) <
      Math.min(1, 0.9 * Math.sqrt(Math.max(0.01, catalogDensity)));
    if (!catalogAccept) continue;

    const chosen = pickWeightedEntry(seedU, i, acceptScratch, weightScratch);
    if (!chosen) continue;

    const entryAccept =
      unitHash(seedU + chosen.seedOffset, 9207, i) <
      Math.min(1, 0.9 * Math.sqrt(Math.max(0.01, chosen.density)));
    if (!entryAccept) continue;

    const scaleValue =
      lerp(
        chosen.minScale,
        chosen.maxScale,
        clamp01(unitHash(seedU + chosen.seedOffset, 9209, i)),
      ) * PREVIEW_SPAWN_VISUAL_SCALE;

    const position: Vec3 = {
      x: localX,
      y: surface.heightMeters * patch.heightScale,
      z: localZ,
    };

    let grid: PlacementGrid | null | undefined = grids.get(chosen.id);
    if (grid === undefined) {
      // Gap is authored in play meters; preview horizontal axes match that scale.
      grid = createPlacementGrid(chosen.gapMeters);
      grids.set(chosen.id, grid);
    }
    if (!canPlaceWithGap(grid, position)) continue;
    registerPlacement(grid, position);

    // Preview uses world up; bury after gap so spacing stays surface-based.
    applyTerrainInset(position, UP, chosen.terrainInsetMeters ?? 0, scaleValue);

    const yaw = unitHash(seedU + chosen.seedOffset, 9211, i) * Math.PI * 2;
    instances.push({
      assetUrl: chosen.assetUrl,
      matrix: composeSurfaceSpawnMatrix(position, UP, yaw, scaleValue),
    });
  }

  return instances;
}

function addSpawnMeshes(
  group: THREE.Group,
  assetsByUrl: Map<string, InstancedAsset>,
  instances: PreviewSpawnInstance[],
): void {
  const byUrl = new Map<string, PreviewSpawnInstance[]>();
  for (const instance of instances) {
    const list = byUrl.get(instance.assetUrl);
    if (list) list.push(instance);
    else byUrl.set(instance.assetUrl, [instance]);
  }

  for (const [url, list] of byUrl) {
    const asset = assetsByUrl.get(url);
    if (!asset || asset.parts.length === 0 || list.length === 0) continue;
    const count = list.length;
    for (const part of asset.parts) {
      const mesh = new THREE.InstancedMesh(part.geometry, part.material, count);
      mesh.castShadow = true;
      mesh.receiveShadow = true;
      mesh.frustumCulled = false;
      mesh.count = count;
      const matrix = new THREE.Matrix4();
      for (let i = 0; i < count; i += 1) {
        matrix.fromArray(list[i]!.matrix);
        // Lift pivot along surface normal (preview uses world up).
        if (asset.baseOffsetY !== 0) {
          const scaleY = Math.hypot(
            matrix.elements[4],
            matrix.elements[5],
            matrix.elements[6],
          );
          const lift = asset.baseOffsetY * scaleY;
          matrix.elements[13] += lift;
        }
        mesh.setMatrixAt(i, matrix);
      }
      mesh.instanceMatrix.needsUpdate = true;
      group.add(mesh);
    }
  }
}

/**
 * Load catalog GLBs and build a disposable preview group in the same local
 * space as the Planet Authoring heightfield / vegetation patch.
 */
export function buildPreviewSpawns(
  planet: Planet,
  seed: number,
  patch: PlanetPreviewPatch,
  catalog: PlanetSpawnCatalog,
  onReady: (handle: PreviewSpawnHandle) => void,
  onError?: (message: string) => void,
): { cancel: () => void } {
  let cancelled = false;
  const urls = [
    ...new Set(
      catalog.entries
        .filter((entry) => entry.enabled && entry.assetUrl.startsWith('/'))
        .map((entry) => entry.assetUrl),
    ),
  ];

  if (urls.length === 0) {
    queueMicrotask(() => {
      if (cancelled) return;
      const group = new THREE.Group();
      group.name = 'planet-preview-spawns';
      onReady({
        group,
        spawnCount: 0,
        dispose: () => {
          group.removeFromParent();
          while (group.children.length > 0) group.remove(group.children[0]!);
        },
      });
    });
    return {
      cancel: () => {
        cancelled = true;
      },
    };
  }

  void Promise.all(urls.map((url) => loadSurfaceSpawnAsset(url))).then(
    (assets) => {
      if (cancelled) return;
      const assetsByUrl = new Map<string, InstancedAsset>();
      for (let i = 0; i < urls.length; i += 1) {
        const asset = assets[i];
        if (asset) assetsByUrl.set(urls[i]!, asset);
        else onError?.(`Failed to load spawn asset ${urls[i]}`);
      }

      const instances = collectPreviewSpawns(planet, seed, patch, catalog);
      const group = new THREE.Group();
      group.name = 'planet-preview-spawns';
      addSpawnMeshes(group, assetsByUrl, instances);

      onReady({
        group,
        spawnCount: instances.length,
        dispose: () => {
          // Cached GLB geometries are shared — only detach meshes.
          group.removeFromParent();
          while (group.children.length > 0) {
            group.remove(group.children[0]!);
          }
        },
      });
    },
  );

  return {
    cancel: () => {
      cancelled = true;
    },
  };
}
