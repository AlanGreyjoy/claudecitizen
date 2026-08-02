import type {
  ColorCorrectionSettings,
  FogSettings,
  PlanetSpawnCatalog,
  PlanetSpawnLayer,
  RenderStats,
  SpikeRenderWorld,
  SsaoSettings,
  SurfaceSpawnInstance,
  SurfaceSpawnMeshCollision,
  VegetationSettings,
  Vec3,
} from '../../../types';
import type { InventoryState } from '../../../player/inventory/types';
import type { WeaponSurfaceKind } from '../../../player/weapon-ballistics';
import type { Camera, Object3D } from 'three';

/**
 * `webgpu` is the shipping mode. The WebGL variants are retained only because
 * the HUD stats panel reports whichever mode a surface came up in, and the ship
 * sandbox still creates a `WebGLRenderer`.
 */
export type RendererMode = 'webgpu' | 'log-depth' | 'default-depth' | 'compatibility';

export type RenderMode = SpikeRenderWorld['mode'] | 'on-ship-deck';

export type TimeOverride = 'auto' | 'day' | 'night';

export interface WeaponMarkerWorldPose {
  forward: Vec3;
  position: Vec3;
}

export interface ActiveWeaponWorldPose {
  barrelEnd: WeaponMarkerWorldPose | null;
  combat: {
    dryFireSoundUrl: string | null;
    fireSoundUrl: string | null;
    hitDecalUrl: string | null;
    reloadSoundUrl: string | null;
  } | null;
  muzzleFlash: WeaponMarkerWorldPose | null;
}

export interface WeaponCombatShotPresentation {
  /** `surfaceKind` picks the impact tint: sparks on hull, dust on dirt. */
  hit: { normal: Vec3; point: Vec3; surfaceKind?: WeaponSurfaceKind } | null;
  hitDecalUrl: string | null;
  muzzleFlash: WeaponMarkerWorldPose | null;
  /** Barrel-end → hit (or max-range end) for cosmetic tracer streaks. */
  tracer: { end: Vec3; speedMps?: number; start: Vec3 } | null;
}

export interface SpikeRenderer {
  rendererMode: RendererMode;
  render: (world: SpikeRenderWorld) => RenderStats;
  resize: (width: number, height: number) => void;
  setVegetationSettings: (nextSettings: Partial<VegetationSettings>) => void;
  /** FPS-debug layer toggles; does not change planet-authored density. */
  setVegetationLayers: (layers: { grass?: boolean; trees?: boolean }) => void;
  setSurfaceSpawnCatalog: (catalog: PlanetSpawnCatalog) => void;
  /** Compat wrapper — prefer setSurfaceSpawnCatalog. */
  setSurfaceSpawnLayers: (layers: readonly PlanetSpawnLayer[]) => void;
  getNearbySurfaceSpawns: (
    focus: Vec3,
    radiusMeters: number,
  ) => SurfaceSpawnInstance[];
  /** Changes only when the resident spawn instance set does. */
  getSurfaceSpawnRevision: () => number;
  getSurfaceSpawnLayers: () => readonly PlanetSpawnLayer[];
  getSurfaceSpawnCatalog: () => PlanetSpawnCatalog;
  getSurfaceSpawnMeshCollisions: () => ReadonlyMap<string, SurfaceSpawnMeshCollision>;
  getSurfaceSpawnDebugStats: () => {
    layerCount: number;
    enabledLayers: number;
    entryCount: number;
    uniqueAssets: number;
    batchMeshes: number;
    estimatedDrawCalls: number;
    cachedTiles: number;
    readyTiles: number;
    pendingTiles: number;
    totalInstances: number;
    loadedAssets: number;
    failedAssets: number;
    meshCounts: number[];
    rootVisible: boolean;
    rootInScene: boolean;
    sampleRenderPos: { x: number; y: number; z: number } | null;
    rootPos: { x: number; y: number; z: number };
    rootScale: number;
  };
  setFogSettings: (settings: FogSettings) => void;
  setColorCorrectionSettings: (settings: Partial<ColorCorrectionSettings>) => void;
  setSsaoSettings: (settings: Partial<SsaoSettings>) => void;
  setSsaoIntensity: (intensity: number) => void;
  setSsaoColor: (color: string | null) => void;
  /** Live bloom tuning. `intensity: 0` disables the glow entirely. */
  setBloomSettings: (settings: {
    intensity?: number;
    luminanceThreshold?: number;
    luminanceSmoothing?: number;
  }) => void;
  /** Live AgX exposure (renderer.toneMappingExposure). */
  setExposure: (exposure: number) => void;
  setTimeOverride: (mode: TimeOverride) => void;
  setEquippedInventory: (
    inventory: InventoryState | null,
    activeWeaponSlotId?: string | null,
  ) => void;
  getActiveWeaponWorldPose: () => ActiveWeaponWorldPose | null;
  presentWeaponShot: (shot: WeaponCombatShotPresentation) => void;
  /** Prefetch + wait for spawn-corridor terrain/veg around a surface focus. */
  warmSpawnCorridor: (
    focus: Vec3,
    options?: {
      radiusMeters?: number;
      timeoutMs?: number;
      onProgress?: (fraction: number, label: string) => void;
    },
  ) => Promise<void>;
  /**
   * Build render pipelines for everything currently in the scene. Call while a
   * loading screen is up: three only takes the async pipeline-creation path via
   * `compileAsync`, so anything not warmed here compiles synchronously on the
   * render thread the first frame it becomes visible.
   */
  warmRenderPipelines: () => Promise<void>;
  getStationRoot: () => Object3D;
  getActiveShipGroup: () => Object3D;
  getCamera: () => Camera;
  getRenderScale: () => number;
  dispose: () => void;
}
