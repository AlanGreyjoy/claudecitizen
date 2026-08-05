/// <reference types="vite/client" />

declare global {
  /**
   * Build stamp injected by Vite's `define`. Telemetry reports it so a
   * regression can be attributed to a build rather than to "recently" — players
   * run whatever version their cache last picked up.
   */
  const __ASTERON_BUILD_ID__: string;

  interface Window {
    __claudecitizenRenderStats: import('./types').RenderStats | null;
    __claudecitizenWorld?: import('./player/world-state').WorldState;
    __claudecitizenShipModel?: import('./render/main/scene/ship-model').ShipModelHandle | null;
    __claudecitizenDev?: {
      callShip: () => Promise<number>;
      teleportToHangar: (index: number) => void;
      teleportToSurface?: (
        destination: import('./world/biome-teleport').SurfaceDestination,
      ) => boolean;
      face: (yawRadians: number, pitchRadians?: number) => void;
      setColorCorrection: (settings: Partial<import('./types').ColorCorrectionSettings>) => void;
      setSsaoSettings: (settings: Partial<import('./types').SsaoSettings>) => void;
      setSsaoIntensity: (intensity: number) => void;
      setSsaoColor: (color: string | null) => void;
      setBloom: (settings: {
        intensity?: number;
        luminanceThreshold?: number;
        luminanceSmoothing?: number;
      }) => void;
      setExposure: (exposure: number) => void;
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
    __spikeScene?: import('three').Scene | null;
    __claudeCitizenCloudDebug?: unknown;
  }
}

export {};
