import type { CameraOrbit, CameraView, CharacterRenderState, GameMode } from './character';
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
  diskHits: number;
  diskMisses: number;
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
  diskHits: number;
  diskMisses: number;
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
  cameraView?: CameraView;
  timeSeconds?: number;
  shipCameraZoom?: number;
  prompt?: string;
  /** Current station room while in station modes; drives interior camera clamping. */
  stationRoomId?: string | null;
  /** Current ship walk zone while on board; drives interior camera clamping. */
  shipZoneId?: string | null;
  /** Landing gear / ramp / cockpit door articulation, 0..1 each. */
  shipRig?: { gear01: number; ramp01: number; cockpit01: number };
}
