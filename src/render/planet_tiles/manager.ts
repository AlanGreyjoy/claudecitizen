import * as THREE from 'three';
import type { Planet, PlanetSurfaceSample, TileInfo, Vec3 } from '../../types';
import { distance } from '../../math/vec3';
import {
  sampleRenderablePlanetSurface,
} from '../../world/planet_surface';
import { createTileMeshCache } from './cache/mesh_cache';
import { createTerrainMaterial } from './render/terrain_material';
import {
  MAX_CACHED_TILES,
  MAX_LEVEL,
  MIN_LEVEL,
  PLANET_RENDER_SCALE,
  TILE_BUILD_BUDGET_PER_FRAME,
} from './domain/constants';
import { setFootSurfaceSampleLevel } from '../../world/foot_surface_level';
import { planApproachPrefetch } from './domain/approach_prefetch';
import { collectTilesNearPosition } from './domain/spawn_tiles';
import {
  finestSelectedTileLevel,
  hasSelectedTileAncestor,
} from './domain/tile_coverage';
import { tileKey } from './domain/tile_info';
import {
  visitSelectedTiles,
  type TileSelectionView,
} from './domain/selection';
import type { ResolvedTile, TileManagerUpdateResult } from './domain/types';

const APPROACH_PREFETCH_INTERVAL_FRAMES = 12;
/** Total speculative starts across every look-ahead focus in one pass. */
const APPROACH_PREFETCH_TILE_CAP = 24;

export interface PlanetTileUpdateOptions {
  velocity?: Vec3 | null;
  view?: TileSelectionView | null;
}

export interface PlanetTileManager {
  dispose: () => void;
  prefetchAround: (
    position: Vec3,
    radiusMeters: number,
    options?: { minLevel?: number; maxLevel?: number },
  ) => string[];
  renderScale: number;
  setVisible: (visible: boolean) => void;
  update: (
    bodyPosition: Vec3,
    surface?: PlanetSurfaceSample,
    options?: PlanetTileUpdateOptions,
  ) => TileManagerUpdateResult;
  /** Reposition the planet mesh without selecting/building tiles (quantum travel fast-path). */
  shiftFocus: (bodyPosition: Vec3) => void;
  waitUntilReady: (keys: readonly string[], timeoutMs: number) => Promise<number>;
}

export function createPlanetTileManager(
  scene: THREE.Scene,
  planet: Planet,
  seed: number,
): PlanetTileManager {
  const tileGroup = new THREE.Group();
  tileGroup.scale.setScalar(PLANET_RENDER_SCALE);
  scene.add(tileGroup);

  const material = createTerrainMaterial();

  const meshCache = createTileMeshCache({
    material,
    planet,
    seed,
    tileGroup,
  });

  const activeKeys = new Set<string>();
  let frameNumber = 0;
  let lastApproachPrefetchFrame = -APPROACH_PREFETCH_INTERVAL_FRAMES;
  let previousSplitKeys = new Set<string>();

  function runApproachPrefetch(
    bodyPosition: Vec3,
    altitudeMeters: number,
    velocity: Vec3 | null | undefined,
  ): void {
    if (!velocity) return;
    if (frameNumber - lastApproachPrefetchFrame < APPROACH_PREFETCH_INTERVAL_FRAMES) {
      return;
    }
    // Near the soft cap, selection needs every slot for underfoot LODs.
    if (meshCache.entryCount() > MAX_CACHED_TILES * 0.55) {
      return;
    }
    const plan = planApproachPrefetch(planet, bodyPosition, velocity, altitudeMeters);
    if (!plan) return;
    lastApproachPrefetchFrame = frameNumber;
    const candidates = new Map<string, { info: TileInfo; priority: number }>();
    for (const focus of plan.focuses) {
      for (const info of collectTilesNearPosition(planet, focus, {
        minLevel: plan.minLevel,
        maxLevel: plan.maxLevel,
        radiusMeters: plan.radiusMeters,
      })) {
        const key = tileKey(info.face, info.level, info.x, info.y);
        const priority = distance(info.centerPosition, focus) - info.level * 120;
        const previous = candidates.get(key);
        if (!previous || priority < previous.priority) {
          candidates.set(key, { info, priority });
        }
      }
    }
    const tiles = [...candidates.values()]
      .sort((a, b) => a.priority - b.priority)
      .slice(0, APPROACH_PREFETCH_TILE_CAP)
      .map((candidate) => candidate.info);
    meshCache.prefetchTiles(tiles);
  }

  function update(
    bodyPosition: Vec3,
    surface: PlanetSurfaceSample = sampleRenderablePlanetSurface(planet, seed, bodyPosition),
    options?: PlanetTileUpdateOptions,
  ): TileManagerUpdateResult {
    frameNumber += 1;
    meshCache.setFrameNumber(frameNumber);
    meshCache.setFocusPosition(bodyPosition);
    meshCache.resetFrameCounters();
    const buildBudget = { remaining: TILE_BUILD_BUDGET_PER_FRAME };
    const selectedKeys = new Set<string>();
    // Protect requested fine LODs even while a coarser parent is displayed.
    // Without this, pending underfoot tiles are the first capacity evictions
    // and the worker never finishes them.
    const keepKeys = new Set<string>();
    const requestedTiles: TileInfo[] = [];
    const renderedTiles: TileInfo[] = [];
    const resolvedCandidates = new Map<string, ResolvedTile>();
    const nextSplitKeys = new Set<string>();

    visitSelectedTiles(
      planet,
      bodyPosition,
      surface.altitudeMeters,
      (info) => {
        requestedTiles.push(info);
        keepKeys.add(tileKey(info.face, info.level, info.x, info.y));
        const resolved = meshCache.requestBestAvailableTile(info, buildBudget);
        if (!resolved.mesh) return;
        resolvedCandidates.set(resolved.key, resolved);
        keepKeys.add(resolved.key);
      },
      options?.view ?? null,
      { nextSplitKeys, previousSplitKeys },
    );
    previousSplitKeys = nextSplitKeys;

    const orderedCandidates = [...resolvedCandidates.values()].sort(
      (a, b) => a.info.level - b.info.level,
    );
    for (const resolved of orderedCandidates) {
      // A fallback ancestor and one of its ready descendants must never render
      // together. Terrain skirts are intentionally deep crack covers; exposing
      // the nested ancestor skirts turns a cold-cache refinement into walls.
      // Keep the coarsest complete cover until every request in that subtree
      // can resolve without the fallback ancestor.
      if (hasSelectedTileAncestor(resolved.info, selectedKeys)) continue;
      resolved.mesh!.material = material;
      resolved.mesh!.renderOrder = 0;
      resolved.mesh!.visible = true;
      renderedTiles.push(resolved.info);
      selectedKeys.add(resolved.key);
    }

    runApproachPrefetch(bodyPosition, surface.altitudeMeters, options?.velocity);

    const footLevel = finestSelectedTileLevel(renderedTiles, bodyPosition);
    if (footLevel > 0) {
      setFootSurfaceSampleLevel(footLevel);
    }

    meshCache.hideInactiveMeshes(selectedKeys, activeKeys);

    activeKeys.clear();
    for (const key of selectedKeys) activeKeys.add(key);
    meshCache.evictTileMeshes(keepKeys);

    tileGroup.position.set(
      -bodyPosition.x * PLANET_RENDER_SCALE,
      -bodyPosition.y * PLANET_RENDER_SCALE,
      -bodyPosition.z * PLANET_RENDER_SCALE,
    );

    const cacheStats = meshCache.stats();
    const frameStats = meshCache.snapshotFrameStats();
    return {
      // Downstream vegetation/water/spawn streaming follows the stable desired
      // quadtree rather than temporarily dropping to a terrain fallback root.
      selectedTiles: requestedTiles,
      stats: {
        activeTiles: selectedKeys.size,
        builtThisFrame: frameStats.builtThisFrame,
        cacheLimit: MAX_CACHED_TILES,
        cachedTiles: meshCache.countEntries('ready'),
        diskHits: cacheStats.diskHits,
        diskMisses: cacheStats.diskMisses,
        evictedThisFrame: frameStats.evictedThisFrame,
        peakCachedTiles: cacheStats.peakCachedTiles,
        pendingTiles: meshCache.countEntries('pending'),
        queuedThisFrame: frameStats.queuedThisFrame,
        totalBuilds: cacheStats.totalBuilds,
        totalEvictions: cacheStats.totalEvictions,
        workerBuildsEnabled: meshCache.isWorkerEnabled(),
        workerErrors: cacheStats.workerErrors,
      },
      surface,
    };
  }

  function shiftFocus(bodyPosition: Vec3): void {
    tileGroup.position.set(
      -bodyPosition.x * PLANET_RENDER_SCALE,
      -bodyPosition.y * PLANET_RENDER_SCALE,
      -bodyPosition.z * PLANET_RENDER_SCALE,
    );
  }

  function dispose(): void {
    meshCache.dispose();
    material.dispose();
    scene.remove(tileGroup);
  }

  function prefetchAround(
    position: Vec3,
    radiusMeters: number,
    options?: { minLevel?: number; maxLevel?: number },
  ): string[] {
    meshCache.setFocusPosition(position);
    const tiles = collectTilesNearPosition(planet, position, {
      minLevel: options?.minLevel ?? MIN_LEVEL,
      maxLevel: options?.maxLevel ?? MAX_LEVEL,
      radiusMeters,
    });
    return meshCache.prefetchTiles(tiles);
  }

  return {
    dispose,
    prefetchAround,
    renderScale: PLANET_RENDER_SCALE,
    setVisible(visible) {
      tileGroup.visible = visible;
    },
    update,
    shiftFocus,
    waitUntilReady: (keys, timeoutMs) => meshCache.waitUntilReady(keys, timeoutMs),
  };
}
