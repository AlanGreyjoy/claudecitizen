import type {
  CameraOrbit,
  CharacterRenderState,
  GameMode,
  SeatLook,
  ShipCameraView,
} from './character';
import type { FlightBody } from './flight';
import type { Vec3 } from './math';
import type { PlayerCharacterAppearanceV1 } from '../player/character_creator/player-character-appearance';

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
  /** Exponential moving average of per-tile generation cost, in milliseconds. */
  buildMsAverage: number;
  /** Worst single tile generation seen this session, in milliseconds. */
  buildMsPeak: number;
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
  /** False once the pool dies and generation falls back to the main thread. */
  workerBuildsEnabled: boolean;
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

export interface GpuMemoryStats {
  geometries: number;
  programs: number;
  textures: number;
  /** Covers dedup-eligible (>= 1024px) atlases only — not the whole texture set. */
  estimatedTextureBytes: number;
  /** Decoded CPU-side bitmaps still waiting to be uploaded and closed. */
  pendingSourceReleases: number;
}

export interface AssetCacheStats {
  /** Live entry count per registered asset cache. */
  entries: Record<string, number>;
  canonicalTextures: number;
  dedupExamined: number;
  dedupReused: number;
  generation: number;
}

export interface RenderStats {
  surfaceCache: RenderableSurfaceCacheStats;
  terrain: TileCacheStats;
  vegetation: VegetationCacheStats;
  gpu: GpuMemoryStats;
  assets: AssetCacheStats;
}

export interface NetworkShipRig {
  gear01: number;
  ramp01: number;
  canopy01: number;
  doors: Record<string, number>;
}

/** Local procedural pose layered over the animated character's spine chain. */
export interface CharacterUpperBodyAim {
  pitchRadians: number;
  yawRadians: number;
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

/** Cosmetic station NPC pose produced by the local ambient population runtime. */
export interface StationNpcRenderState extends CharacterRenderState {
  id: string;
  displayName: string;
  appearance: PlayerCharacterAppearanceV1;
  /**
   * Authored character GLB. When set the NPC wears that model instead of the
   * modular Sidekick avatar built from `appearance`.
   */
  modelUrl?: string | null;
  /**
   * Optional Head-bone look (yaw/pitch relative to NPC facing). Used when
   * glancing at the local player walking by.
   */
  headLook?: CharacterUpperBodyAim | null;
}

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
  /**
   * Near-ship exterior walk: use on-foot camera (character focus, planet orbit)
   * even though locomotion still runs in ship-local Rapier.
   */
  shipExteriorWalk?: boolean;
  ship: import('./flight').FlightBody;
  /** All ship instances visible this frame (multi-ship render pool). */
  ships?: RenderShipInstance[];
  activeShipId?: string;
  character?: CharacterRenderState | null;
  /** Local-only RMB weapon aim; never sourced from replicated character state. */
  weaponAimActive?: boolean;
  /**
   * Local-only Head-bone look toward a nearby station vendor screen.
   * Same yaw/pitch convention as upper-body aim (relative to character facing).
   */
  characterHeadLook?: CharacterUpperBodyAim | null;
  cameraOrbit?: CameraOrbit;
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
   * Bunk entertainment-screen focus (FOV zoom + dolly). Bed mode only.
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
  /**
   * Collider-occlusion query wired by the app layer. Given the look-at
   * pivot and desired camera position (world space), returns the camera
   * position pulled in front of the first blocking collider.
   */
  cameraOcclusion?: (from: Vec3, to: Vec3) => Vec3;
  /** Current ship camera-bound id while on board; drives interior camera clamping. */
  shipZoneId?: string | null;
  /** Landing gear / ramp / canopy / door articulation, 0..1 each (doors by layout id). */
  shipRig?: {
    gear01: number;
    ramp01: number;
    canopy01: number;
    doors: Record<string, number>;
  };
  /** Remote players/ships received from WebTransport cell snapshots. */
  networkEntities?: NetworkRenderEntity[];
  /** Authored ambient station NPCs. Local/cosmetic until NPCs become cell entities. */
  stationNpcs?: StationNpcRenderState[];
  /** Piloting sub-mode for ship HUD / quantum VFX. */
  flightMode?: import('../flight/flight-modes').ShipFlightMode;
  quantum?: import('../flight/quantum-travel').QuantumTravelState;
}
