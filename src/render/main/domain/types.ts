import type { FogSettings, RenderStats, SpikeRenderWorld, VegetationSettings } from '../../../types';

export type RendererMode = 'log-depth' | 'default-depth' | 'compatibility';

export type RenderMode = SpikeRenderWorld['mode'] | 'on-ship-deck';

export interface SpikeRenderer {
  rendererMode: RendererMode;
  render: (world: SpikeRenderWorld) => RenderStats;
  resize: (width: number, height: number) => void;
  setVegetationSettings: (nextSettings: Partial<VegetationSettings>) => void;
  setFogSettings: (settings: FogSettings) => void;
  dispose: () => void;
}
