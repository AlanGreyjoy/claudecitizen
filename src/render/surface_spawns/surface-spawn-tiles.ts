import type { Planet, PlanetSpawnCatalog, SurfaceSpawnInstance, TileInfo, Vec3 } from '../../types';
import { distance } from '../../math/vec3';
import { getActivePlanetConfig } from '../../world/planets/runtime';
import { collectTileSurfaceSpawns, SURFACE_SPAWN_MIN_TILE_LEVEL } from '../../world/surface_spawns';
import type { SurfaceSpawnWorkerInMessage } from '../../types/surface-spawn-worker';
import { loadSurfaceSpawnTile, saveSurfaceSpawnTile } from './cache/tile-cache';
import { STORED_SURFACE_SPAWN_TILE_VERSION } from './domain/storage';
import type { TileEntry } from './surface-spawn-batch';

const BUILD_BUDGET_PER_FRAME = 4;
const BUILD_BUDGET_MS = 10;
const ENQUEUE_RADIUS_METERS = 700;
const KEEP_RADIUS_METERS = 900;
const MAX_CACHED_TILES = 64;

export interface SurfaceSpawnTileCtx {
  abandonWorker: (reason: string) => void;
  diskLoadsInFlight: Set<string>;
  getCatalog: () => PlanetSpawnCatalog;
  getCatalogEpoch: () => number;
  getFrameNumber: () => number;
  getLayers: () => PlanetSpawnCatalog['entries'];
  getNextBuildId: () => number;
  getWorker: () => Worker | null;
  getWorkerAlive: () => boolean;
  getWorkerReady: () => boolean;
  markPackedSelectionDirty: () => void;
  pendingKeys: string[];
  planet: Planet;
  seed: number;
  setNextBuildId: (value: number) => void;
  tileCache: Map<string, TileEntry>;
  tileKey: (tile: TileInfo) => string;
}

export function createSurfaceSpawnTiles(ctx: SurfaceSpawnTileCtx) {
  function finishTileBuild(
    entry: TileEntry,
    instances: SurfaceSpawnInstance[] | null,
    forceSync: boolean,
  ): void {
    const epoch = ctx.getCatalogEpoch();
    const resolved =
      instances ??
      (forceSync
        ? collectTileSurfaceSpawns(entry.tileInfo, ctx.planet, ctx.seed, ctx.getCatalog())
        : null);
    if (resolved == null) {
      entry.status = 'pending';
      if (!ctx.pendingKeys.includes(entry.key)) ctx.pendingKeys.push(entry.key);
      return;
    }
    if (epoch !== ctx.getCatalogEpoch()) return;
    entry.instances = resolved;
    entry.status = 'ready';
    entry.lastUsedFrame = ctx.getFrameNumber();
    saveSurfaceSpawnTile(
      ctx.planet,
      ctx.seed,
      ctx.getCatalog(),
      entry.tileInfo.face,
      entry.tileInfo.level,
      entry.tileInfo.x,
      entry.tileInfo.y,
      { version: STORED_SURFACE_SPAWN_TILE_VERSION, instances: resolved },
    );
    ctx.markPackedSelectionDirty();
  }

  function startDiskLoad(tile: TileInfo): void {
    const key = ctx.tileKey(tile);
    if (ctx.tileCache.has(key) || ctx.diskLoadsInFlight.has(key)) return;
    const entry: TileEntry = {
      key,
      tileInfo: tile,
      instances: [],
      lastUsedFrame: ctx.getFrameNumber(),
      status: 'loading-disk',
      buildId: 0,
    };
    ctx.tileCache.set(key, entry);
    ctx.diskLoadsInFlight.add(key);
    const epoch = ctx.getCatalogEpoch();
    const catalogForLoad = ctx.getCatalog();
    void loadSurfaceSpawnTile(
      ctx.planet,
      ctx.seed,
      catalogForLoad,
      tile.face,
      tile.level,
      tile.x,
      tile.y,
    )
      .then((stored) => {
        ctx.diskLoadsInFlight.delete(key);
        const current = ctx.tileCache.get(key);
        if (!current || current.status !== 'loading-disk') return;
        if (epoch !== ctx.getCatalogEpoch()) {
          ctx.tileCache.delete(key);
          return;
        }
        if (stored) {
          current.instances = stored.instances;
          current.status = 'ready';
          current.lastUsedFrame = ctx.getFrameNumber();
          ctx.markPackedSelectionDirty();
          return;
        }
        current.status = 'pending';
        if (!ctx.pendingKeys.includes(key)) ctx.pendingKeys.push(key);
      })
      .catch(() => {
        ctx.diskLoadsInFlight.delete(key);
        const current = ctx.tileCache.get(key);
        if (!current || current.status !== 'loading-disk') return;
        if (epoch !== ctx.getCatalogEpoch()) {
          ctx.tileCache.delete(key);
          return;
        }
        current.status = 'pending';
        if (!ctx.pendingKeys.includes(key)) ctx.pendingKeys.push(key);
      });
  }

  function enqueueTile(tile: TileInfo, focus: Vec3): void {
    if (tile.level < SURFACE_SPAWN_MIN_TILE_LEVEL) return;
    if (distance(focus, tile.centerPosition) > ENQUEUE_RADIUS_METERS) return;
    const key = ctx.tileKey(tile);
    const existing = ctx.tileCache.get(key);
    if (existing) {
      existing.lastUsedFrame = ctx.getFrameNumber();
      return;
    }
    startDiskLoad(tile);
  }

  function postWorkerBuild(entry: TileEntry): boolean {
    if (!ctx.getWorker() || !ctx.getWorkerAlive() || !ctx.getWorkerReady()) return false;
    const buildId = ctx.getNextBuildId();
    ctx.setNextBuildId(buildId + 1);
    entry.buildId = buildId;
    entry.status = 'building';
    const planetDocument = getActivePlanetConfig().document;
    const message: SurfaceSpawnWorkerInMessage = {
      buildId,
      key: entry.key,
      info: entry.tileInfo,
      planet: ctx.planet,
      planetDocument,
      seed: ctx.seed,
      catalog: ctx.getCatalog(),
    };
    try {
      const worker = ctx.getWorker();
      if (!worker) return false;
      worker.postMessage(message);
      return true;
    } catch {
      ctx.abandonWorker('postMessage failed');
      entry.status = 'pending';
      return false;
    }
  }

  function processBuildBudget(focus: Vec3): void {
    if (ctx.getLayers().length === 0) return;
    // Prefer nearer, finer tiles so underfoot props appear before distant L12s.
    ctx.pendingKeys.sort((a, b) => {
      const ea = ctx.tileCache.get(a);
      const eb = ctx.tileCache.get(b);
      if (!ea || !eb) return 0;
      const da = distance(focus, ea.tileInfo.centerPosition);
      const db = distance(focus, eb.tileInfo.centerPosition);
      if (da !== db) return da - db;
      return eb.tileInfo.level - ea.tileInfo.level;
    });

    const start = performance.now();
    let started = 0;
    let syncReady = 0;
    while (
      ctx.pendingKeys.length > 0 &&
      started < BUILD_BUDGET_PER_FRAME &&
      performance.now() - start < BUILD_BUDGET_MS
    ) {
      const key = ctx.pendingKeys.shift()!;
      const entry = ctx.tileCache.get(key);
      if (!entry || entry.status !== 'pending') continue;

      if (postWorkerBuild(entry)) {
        started += 1;
        continue;
      }

      // Sync fallback within the same frame budget.
      entry.instances = collectTileSurfaceSpawns(
        entry.tileInfo,
        ctx.planet,
        ctx.seed,
        ctx.getCatalog(),
      );
      entry.status = 'ready';
      entry.lastUsedFrame = ctx.getFrameNumber();
      saveSurfaceSpawnTile(
        ctx.planet,
        ctx.seed,
        ctx.getCatalog(),
        entry.tileInfo.face,
        entry.tileInfo.level,
        entry.tileInfo.x,
        entry.tileInfo.y,
        {
          version: STORED_SURFACE_SPAWN_TILE_VERSION,
          instances: entry.instances,
        },
      );
      started += 1;
      syncReady += 1;
    }
    if (syncReady > 0) ctx.markPackedSelectionDirty();
  }

  function evictStaleTiles(focus: Vec3): void {
    // Drop far tiles first so the budget stays on the player's neighborhood.
    let removed = false;
    for (const [key, entry] of [...ctx.tileCache]) {
      if (distance(focus, entry.tileInfo.centerPosition) > KEEP_RADIUS_METERS) {
        ctx.tileCache.delete(key);
        removed = true;
      }
    }
    if (ctx.tileCache.size > MAX_CACHED_TILES) {
      const ranked = [...ctx.tileCache.values()].sort((a, b) => {
        const da = distance(focus, a.tileInfo.centerPosition);
        const db = distance(focus, b.tileInfo.centerPosition);
        if (da !== db) return db - da; // farthest first
        return a.lastUsedFrame - b.lastUsedFrame;
      });
      while (ctx.tileCache.size > MAX_CACHED_TILES && ranked.length > 0) {
        const victim = ranked.shift()!;
        ctx.tileCache.delete(victim.key);
        removed = true;
      }
    }
    if (removed) {
      for (let i = ctx.pendingKeys.length - 1; i >= 0; i -= 1) {
        if (!ctx.tileCache.has(ctx.pendingKeys[i]!)) ctx.pendingKeys.splice(i, 1);
      }
      ctx.markPackedSelectionDirty();
    }
  }
  return {
    enqueueTile,
    evictStaleTiles,
    finishTileBuild,
    processBuildBudget,
    startDiskLoad,
  };
}
