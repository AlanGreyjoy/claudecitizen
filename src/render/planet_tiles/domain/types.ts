import type { PlanetSurfaceSample, TileCacheStats, TileInfo } from '../../../types';

export type TileEntryStatus = 'loading-disk' | 'pending' | 'ready';

/**
 * A tile's residency, not its geometry.
 *
 * Tiles used to own a `THREE.Mesh` and `status === 'ready'` meant "that mesh
 * exists". The shared grid draws every tile as an instance of one geometry, so
 * a ready tile is one whose height and colour pages are resident in the atlas —
 * there is nothing per-tile left to hold.
 */
export interface TileMeshEntry {
  buildId: number | null;
  info: TileInfo;
  lastUsedFrame: number;
  status: TileEntryStatus;
}

export interface PendingBuildJob {
  buildId: number;
  info: TileInfo;
  key: string;
  /** Lower = sooner. Distance from focus in meters when known. */
  priority: number;
}

export interface ResolvedTile {
  info: TileInfo;
  key: string;
  /** False when nothing in the tile's ancestry could be drawn this frame. */
  ready: boolean;
}

export interface ExtendedTileCacheStats extends TileCacheStats {
  workerErrors: number;
}

export interface TileManagerUpdateResult {
  selectedTiles: TileInfo[];
  stats: ExtendedTileCacheStats;
  surface: PlanetSurfaceSample;
}

export interface TileCacheStatsAccumulator {
  /** Exponential moving average of per-tile generation cost, in milliseconds. */
  buildMsAverage: number;
  /** Worst single tile generation seen this session, in milliseconds. */
  buildMsPeak: number;
  diskHits: number;
  diskMisses: number;
  peakCachedTiles: number;
  totalBuilds: number;
  totalEvictions: number;
  workerErrors: number;
}

export interface TileFrameCounters {
  builtThisFrame: number;
  completedSinceLastUpdate: number;
  evictedThisFrame: number;
  queuedThisFrame: number;
}
