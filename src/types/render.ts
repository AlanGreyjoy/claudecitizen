import type {
  CameraOrbit,
  CameraView,
  CharacterRenderState,
  GameMode,
  SeatLook,
  ShipCameraView,
} from './character';
import type { FlightBody } from './flight';
import type { Vec3 } from './math';

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

export interface NetworkShipRig {
  gear01: number;
  ramp01: number;
  doors: Record<string, number>;
}

/** Ship body fields relayed from other players over the presence WebSocket. */
export interface NetworkShipBody extends FlightBody {
  shipId?: string;
  prefabId?: string;
  hp?: number;
  shields?: number;
  maxHp?: number;
  maxShields?: number;
}

export interface RenderShipVitals {
  hp: number;
  shields: number;
}

export interface RenderShipSpecCaps {
  maxHp: number;
  maxShields: number;
}

export interface RenderShipInstance {
  id: string;
  prefabId: string;
  body: import('./flight').FlightBody;
  rig: NetworkShipRig;
  vitals?: RenderShipVitals;
  spec?: RenderShipSpecCaps;
}

export type NetworkLod = 'full' | 'medium' | 'marker';

export interface NetworkRenderEntity {
  id: string;
  playerId: string;
  displayName: string;
  lod: NetworkLod;
  mode: GameMode | string;
  character: CharacterRenderState | null;
  ship: NetworkShipBody | null;
  shipRig: NetworkShipRig | null;
  markerPosition: Vec3;
  stationRoomId: string | null;
  shipZoneId: string | null;
}

export interface SpikeRenderWorld {
  mode?: GameMode;
  ship: import('./flight').FlightBody;
  /** All ship instances visible this frame (multi-ship render pool). */
  ships?: RenderShipInstance[];
  activeShipId?: string;
  character?: CharacterRenderState | null;
  cameraOrbit?: CameraOrbit;
  cameraView?: CameraView;
  /** Piloting camera view; cockpit first person is the default. */
  shipCameraView?: ShipCameraView;
  /** Cockpit free-look offset while holding F in the pilot seat. */
  seatLook?: SeatLook;
  timeSeconds?: number;
  shipCameraZoom?: number;
  prompt?: string;
  /** Current station room while in station modes; drives interior camera clamping. */
  stationRoomId?: string | null;
  /** Current ship walk zone while on board; drives interior camera clamping. */
  shipZoneId?: string | null;
  /** Landing gear / ramp / door articulation, 0..1 each (doors by layout id). */
  shipRig?: { gear01: number; ramp01: number; doors: Record<string, number> };
  /** Remote players/ships received from the native WebSocket presence service. */
  networkEntities?: NetworkRenderEntity[];
}
