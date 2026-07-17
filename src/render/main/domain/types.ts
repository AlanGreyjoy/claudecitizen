import type {
  ColorCorrectionSettings,
  FogSettings,
  RenderStats,
  SpikeRenderWorld,
  SsaoSettings,
  VegetationSettings,
} from '../../../types';

export type RendererMode = 'log-depth' | 'default-depth' | 'compatibility';

export type RenderMode = SpikeRenderWorld['mode'] | 'on-ship-deck';

export type TimeOverride = 'auto' | 'day' | 'night';

export interface SpikeRenderer {
  rendererMode: RendererMode;
  render: (world: SpikeRenderWorld) => RenderStats;
  resize: (width: number, height: number) => void;
  setVegetationSettings: (nextSettings: Partial<VegetationSettings>) => void;
  setFogSettings: (settings: FogSettings) => void;
  setColorCorrectionSettings: (settings: Partial<ColorCorrectionSettings>) => void;
  setSsaoSettings: (settings: Partial<SsaoSettings>) => void;
  setSsaoIntensity: (intensity: number) => void;
  setSsaoColor: (color: string | null) => void;
  setTimeOverride: (mode: TimeOverride) => void;
  setEquippedInventory: (
    inventory: import('../../../player/inventory/types').InventoryState | null,
  ) => void;
  getStationRoot: () => import('three').Object3D;
  getActiveShipGroup: () => import('three').Object3D;
  getCamera: () => import('three').Camera;
  getRenderScale: () => number;
  dispose: () => void;
}
