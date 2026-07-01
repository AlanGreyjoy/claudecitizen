import type { CameraOrbit, CharacterRenderState, GameMode } from './character';
import type { FlightBody } from './flight';

export interface FogSettings {
  density: number;
  maxHeight: number;
  heightFalloff: number;
  noiseStrength: number;
}

export interface RenderableSurfaceCacheStats {
  entries: number;
  evictions: number;
  hits: number;
  limit: number;
  misses: number;
  peakEntries: number;
}

export interface TileCacheStats {
  activeTiles: number;
  builtThisFrame: number;
  cacheLimit: number;
  cachedTiles: number;
  evictedThisFrame: number;
  peakCachedTiles: number;
  pendingTiles: number;
  queuedThisFrame: number;
  totalBuilds: number;
  totalEvictions: number;
}

export interface VegetationCacheStats {
  activeTiles: number;
  builtThisFrame: number;
  cacheLimit: number;
  cachedTiles: number;
  evictedThisFrame: number;
  peakCachedTiles: number;
  totalBuilds: number;
  totalEvictions: number;
}

export interface RenderStats {
  surfaceCache: RenderableSurfaceCacheStats;
  terrain: TileCacheStats;
  vegetation: VegetationCacheStats;
}

export interface SpikeRenderWorld {
  mode?: GameMode;
  ship: FlightBody;
  character?: CharacterRenderState | null;
  cameraOrbit?: CameraOrbit;
  timeSeconds?: number;
  shipCameraZoom?: number;
  prompt?: string;
}
