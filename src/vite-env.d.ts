/// <reference types="vite/client" />

declare global {
  interface Window {
    __claudecitizenRenderStats: import('./types').RenderStats | null;
    __spikeScene?: import('three').Scene;
    __claudeCitizenCloudDebug?: unknown;
  }
}

export {};
