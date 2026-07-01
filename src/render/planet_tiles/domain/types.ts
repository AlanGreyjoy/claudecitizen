import type * as THREE from 'three';
import type { PlanetSurfaceSample, TileCacheStats, TileInfo } from '../../../types';

export type TileEntryStatus = 'loading-disk' | 'pending' | 'ready';

export interface TileMeshEntry {
  buildId: number | null;
  info: TileInfo;
  lastUsedFrame: number;
  mesh: THREE.Mesh | null;
  status: TileEntryStatus;
}

export interface PendingBuildJob {
  buildId: number;
  info: TileInfo;
  key: string;
}

export interface ResolvedTile {
  info: TileInfo;
  key: string;
  mesh: THREE.Mesh | null;
}

export interface ExtendedTileCacheStats extends TileCacheStats {
  workerBuildsEnabled: boolean;
  workerErrors: number;
}

export interface TileManagerUpdateResult {
  selectedTiles: TileInfo[];
  stats: ExtendedTileCacheStats;
  surface: PlanetSurfaceSample;
}

export interface TileCacheStatsAccumulator {
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
