/// <reference types="vite/client" />

declare global {
  interface Window {
    __claudecitizenRenderStats: import('./types').RenderStats | null;
    __claudecitizenWorld?: import('./player/world_state').WorldState;
    __claudecitizenShipModel?: import('./render/main/scene/ship_model').ShipModelHandle;
    __claudecitizenDev?: {
      callShip: () => number;
      teleportToHangar: (index: number) => void;
      face: (yawRadians: number, pitchRadians?: number) => void;
    };
    __spikeScene?: import('three').Scene;
    __claudeCitizenCloudDebug?: unknown;
  }
}

export {};
