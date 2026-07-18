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

export type RendererMode = 'log-depth' | 'default-depth' | 'compatibility';

export type RenderMode = SpikeRenderWorld['mode'] | 'on-ship-deck';

export type TimeOverride = 'auto' | 'day' | 'night';

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
    inventory: import('../../../player/inventory/types').InventoryState | null,
  ) => void;
  /** Prefetch + wait for spawn-corridor terrain/veg around a surface focus. */
  warmSpawnCorridor: (
    focus: import('../../../types').Vec3,
    options?: {
      radiusMeters?: number;
      timeoutMs?: number;
      onProgress?: (fraction: number, label: string) => void;
    },
  ) => Promise<void>;
  getStationRoot: () => import('three').Object3D;
  getActiveShipGroup: () => import('three').Object3D;
  getCamera: () => import('three').Camera;
  getRenderScale: () => number;
  dispose: () => void;
}
