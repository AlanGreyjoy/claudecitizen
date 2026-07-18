/// <reference types="vite/client" />

interface ImportMetaEnv {
  readonly VITE_API_BASE_URL?: string;
}

interface ImportMeta {
  readonly env: ImportMetaEnv;
}

declare global {
  interface Window {
    __claudecitizenRenderStats: import('./types').RenderStats | null;
    __claudecitizenWorld?: import('./player/world_state').WorldState;
    __claudecitizenShipModel?: import('./render/main/scene/ship_model').ShipModelHandle;
    __claudecitizenDev?: {
      callShip: () => Promise<number>;
      teleportToHangar: (index: number) => void;
      face: (yawRadians: number, pitchRadians?: number) => void;
      setColorCorrection: (settings: Partial<import('./types').ColorCorrectionSettings>) => void;
      setSsaoSettings: (settings: Partial<import('./types').SsaoSettings>) => void;
      setSsaoIntensity: (intensity: number) => void;
      setSsaoColor: (color: string | null) => void;
      getSurfaceSpawnDebug?: () => {
        layerCount: number;
        layers: Array<{
          id: string;
          enabled: boolean;
          assetUrl: string;
          biomes: string[];
          minH: number;
          maxH: number;
          density: number;
          weight?: number;
          collider?: unknown;
        }>;
        nearbyCount: number;
        activeColliders?: number;
        sample: unknown[];
      };
    };
    __spikeScene?: import('three').Scene;
    __claudeCitizenCloudDebug?: unknown;
  }
}

export {};
