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
import type { Camera, Object3D } from 'three';

export type RendererMode = 'log-depth' | 'default-depth' | 'compatibility';

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
  hit: { normal: Vec3; point: Vec3 } | null;
  hitDecalUrl: string | null;
  muzzleFlash: WeaponMarkerWorldPose | null;
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
  getStationRoot: () => Object3D;
  getActiveShipGroup: () => Object3D;
  getCamera: () => Camera;
  getRenderScale: () => number;
  dispose: () => void;
}
