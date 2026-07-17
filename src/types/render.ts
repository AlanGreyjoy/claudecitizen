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
import type { PlayerCharacterAppearanceV1 } from '../player/character_creator/player_character_appearance';

export interface FogSettings {
  density: number;
  maxHeight: number;
  heightFalloff: number;
  noiseStrength: number;
}

export interface ColorCorrectionSettings {
  enabled: boolean;
  /** Additive brightness offset, typically -1..1. Default 0. */
  brightness: number;
  /** Contrast multiplier, typically 0..2. Default 1. */
  contrast: number;
  /** Saturation multiplier, typically 0..2. Default 1. */
  saturation: number;
  /** Hue rotation in radians, any real value. Default 0. */
  hue: number;
  /** Gamma correction, typically 0.1..3. Default 1. */
  gamma: number;
}

export interface SsaoSettings {
  /** N8AO intensity (pow exponent). 0 disables, 2 is soft, 5 is strong. */
  intensity: number;
  /** World-space AO radius in meters. Scaled by the renderer's renderScale. */
  aoRadius: number;
  /** Distance falloff ratio. 0.1 is tight, 1.0 is default, 5.0 is very soft. */
  distanceFalloff: number;
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

/** Ship body fields received from authoritative cell snapshots. */
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
  characterAppearance: PlayerCharacterAppearanceV1 | null;
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
  /**
   * Cockpit flight camera feel for the current frame (FOV kick + boost shake).
   * Only applied in pilot cockpit view.
   */
  flightCameraFeel?: {
    /** Delta from the camera's base FOV (degrees; positive = wider). */
    fovDeltaDeg: number;
    /** Ship-local eye offset (meters). */
    eyeShake: { right: number; up: number; forward: number };
  };
  /**
   * Bunk entertainment-screen focus (FOV zoom + dolly). Applied in bed mode.
   */
  entertainmentCameraFeel?: {
    /** Delta from the camera's base FOV (degrees; negative = zoom in). */
    fovDeltaDeg: number;
    /** World-space eye after dolly toward the screen. */
    eye: Vec3;
    /** World-space look point (through the screen). */
    lookTarget: Vec3;
  };
  /** Active bunk id while in bed occupancy modes. */
  activeBedId?: string | null;
  timeSeconds?: number;
  shipCameraZoom?: number;
  prompt?: string;
  /** Current station room while in station modes; drives interior camera clamping. */
  stationRoomId?: string | null;
  /** Current ship walk zone while on board; drives interior camera clamping. */
  shipZoneId?: string | null;
  /** Landing gear / ramp / door articulation, 0..1 each (doors by layout id). */
  shipRig?: { gear01: number; ramp01: number; doors: Record<string, number> };
  /** Remote players/ships received from WebTransport cell snapshots. */
  networkEntities?: NetworkRenderEntity[];
  /** Piloting sub-mode for ship HUD / quantum VFX. */
  flightMode?: import('../flight/flight_modes').ShipFlightMode;
  quantum?: import('../flight/quantum_travel').QuantumTravelState;
}
