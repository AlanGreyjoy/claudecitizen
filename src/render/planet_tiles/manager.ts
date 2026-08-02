import * as THREE from 'three';
import type { Planet, PlanetSurfaceSample, TileInfo, Vec3 } from '../../types';
import { distance } from '../../math/vec3';
import {
  sampleRenderablePlanetSurface,
} from '../../world/planet-surface';
import { createTileMeshCache } from './cache/mesh-cache';
import {
  MAX_CACHED_TILES,
  MAX_FALLBACK_SUPPRESSION_LEVELS,
  MAX_LEVEL,
  MIN_LEVEL,
  PLANET_RENDER_SCALE,
  TILE_BUILD_BUDGET_PER_FRAME,
} from './domain/constants';
import { setFootSurfaceSampleLevel } from '../../world/foot-surface-level';
import { planApproachPrefetch } from './domain/approach-prefetch';
import { collectTilesNearPosition } from './domain/spawn-tiles';
import {
  finestSelectedTileLevel,
  retainFallbackAncestors,
  selectedTileAncestorLevel,
} from './domain/tile-coverage';
import { EDGE_NEIGHBOUR_ABSENT, resolveEdgeDeltas } from './domain/edge-deltas';
import {
  createTerrainGridRenderer,
  type TerrainGridTile,
} from './render/terrain-grid-renderer';
import { tileKey } from './domain/tile-info';
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

  // Shares the tile group's floating-origin transform and render scale, so the
  // shader can work in anchor-relative metres exactly as per-tile geometry did.
  const gridRenderer = createTerrainGridRenderer(planet);
  tileGroup.add(gridRenderer.object);

  const meshCache = createTileMeshCache({ planet, seed, gridRenderer });

  let frameNumber = 0;
  let lastApproachPrefetchFrame = -APPROACH_PREFETCH_INTERVAL_FRAMES;
  let previousSplitKeys = new Set<string>();
  // Geomorph needs a wall-clock delta and `update` is not given one. Clamped so
  // a stall or a tab restore cannot snap every blending tile to full detail.
  let lastUpdateMs: number | null = null;

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
    const nowMs = performance.now();
    const deltaSeconds =
      lastUpdateMs === null ? 0 : Math.min(0.25, Math.max(0, (nowMs - lastUpdateMs) / 1000));
    lastUpdateMs = nowMs;
    meshCache.setFrameNumber(frameNumber);
    meshCache.setFocusPosition(bodyPosition);
    meshCache.resetFrameCounters();
    const buildBudget = { remaining: TILE_BUILD_BUDGET_PER_FRAME };
    const selectedKeys = new Set<string>();
    // Protect requested fine LODs even while a coarser parent is displayed.
    // Without this, pending underfoot tiles are the first capacity evictions
    // and the worker never finishes them.
    const keepKeys = new Set<string>();
    // Kept apart from `keepKeys` so the "present implies whole chain present"
    // invariant that lets `retainFallbackAncestors` stop early stays true —
    // `keepKeys` also holds selected and resolved keys, which carry no chain.
    const ancestorKeys = new Set<string>();
    const requestedTiles: TileInfo[] = [];
    const renderedTiles: TileInfo[] = [];
    const renderedGridTiles: TerrainGridTile[] = [];
    const resolvedCandidates = new Map<string, ResolvedTile>();
    const nextSplitKeys = new Set<string>();

    visitSelectedTiles(
      planet,
      bodyPosition,
      surface.altitudeMeters,
      (info) => {
        requestedTiles.push(info);
        keepKeys.add(tileKey(info.face, info.level, info.x, info.y));
        // Ancestors are this tile's fallback ladder. Keeping them resident is
        // what stops a momentarily-unready tile from resolving to a root.
        retainFallbackAncestors(info, planet, ancestorKeys);
        const resolved = meshCache.requestBestAvailableTile(info, buildBudget);
        if (!resolved.ready) return;
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
      // together. Terrain skirts are crack covers; exposing nested ancestor
      // skirts still turns a cold-cache refinement into visible walls.
      // Keep the coarsest complete cover until every request in that subtree
      // can resolve without the fallback ancestor.
      //
      // Bounded, though. That rule is right for a refinement step or two, but
      // an ancestor many levels coarser is not a "cover" at ground level — it
      // is a planet-scale triangle that suppresses every ready tile beneath it
      // and puts the camera inside or above the terrain for as long as one
      // sibling stays unready. Past the gap limit, let the fine tiles keep
      // rendering; a seam is cheap next to the whole surface vanishing.
      const ancestorLevel = selectedTileAncestorLevel(resolved.info, selectedKeys);
      const suppressed =
        ancestorLevel >= 0 &&
        resolved.info.level - ancestorLevel <= MAX_FALLBACK_SUPPRESSION_LEVELS;
      if (suppressed) continue;
      if (!gridRenderer.hasTile(resolved.key)) continue;
      renderedGridTiles.push({
        info: resolved.info,
        key: resolved.key,
        // Overwritten below, but the placeholder is the fail-safe value: it
        // keeps every skirt drawn if a tile ever reaches the renderer without
        // its deltas resolved.
        edgeDeltas: [
          EDGE_NEIGHBOUR_ABSENT,
          EDGE_NEIGHBOUR_ABSENT,
          EDGE_NEIGHBOUR_ABSENT,
          EDGE_NEIGHBOUR_ABSENT,
        ],
      });
      renderedTiles.push(resolved.info);
      selectedKeys.add(resolved.key);
    }

    // Edge deltas need the full rendered set, so they resolve after the loop.
    // This is what replaces seam stitching: the coarser neighbour's straight
    // edge is folded onto in the vertex shader rather than by rewriting vertex
    // positions and recomputing normals on the CPU every time the LOD
    // configuration changed — which also flipped the geometry's normal
    // attribute between two formats and forced a pipeline rebuild each way.
    for (const tile of renderedGridTiles) {
      resolveEdgeDeltas(
        tile.info,
        selectedKeys,
        tile.edgeDeltas as [number, number, number, number],
      );
    }
    // Same focus the tile group is about to be centred on, so the per-instance
    // tile offsets and the group transform cancel instead of compounding.
    gridRenderer.setVisibleTiles(renderedGridTiles, deltaSeconds, bodyPosition);

    runApproachPrefetch(bodyPosition, surface.altitudeMeters, options?.velocity);

    const footLevel = finestSelectedTileLevel(renderedTiles, bodyPosition);
    if (footLevel > 0) {
      setFootSurfaceSampleLevel(footLevel);
    }

    for (const key of ancestorKeys) keepKeys.add(key);
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
        buildMsAverage: cacheStats.buildMsAverage,
        buildMsPeak: cacheStats.buildMsPeak,
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
    gridRenderer.dispose();
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
