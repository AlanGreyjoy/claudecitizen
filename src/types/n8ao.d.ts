declare module 'n8ao' {
  import type * as THREE from 'three';
  import type { Pass } from 'postprocessing';

  export type N8AOQualityMode = 'Performance' | 'Low' | 'Medium' | 'High' | 'Ultra';
  export type N8AODisplayMode = 'Combined' | 'AO' | 'No AO' | 'Split' | 'Split AO';

  export interface N8AOConfiguration {
    aoSamples: number;
    aoRadius: number;
    aoTones: number;
    denoiseSamples: number;
    denoiseRadius: number;
    distanceFalloff: number;
    intensity: number;
    denoiseIterations: number;
    renderMode: number;
    biasOffset: number;
    biasMultiplier: number;
    color: THREE.Color;
    gammaCorrection: boolean;
    depthBufferType: number;
    screenSpaceRadius: boolean;
    halfRes: boolean;
    depthAwareUpsampling: boolean;
    colorMultiply: boolean;
    transparencyAware: boolean;
    accumulate: boolean;
  }

  export class N8AOPass extends Pass {
    constructor(scene: THREE.Scene, camera: THREE.Camera, width?: number, height?: number);

    scene: THREE.Scene;
    camera: THREE.Camera;
    width: number;
    height: number;
    configuration: N8AOConfiguration;
    beautyRenderTarget: THREE.WebGLRenderTarget;
    lastTime: number;

    setSize(width: number, height: number): void;
    setDisplayMode(mode: N8AODisplayMode): void;
    setQualityMode(mode: N8AOQualityMode): void;
    enableDebugMode(): void;
    disableDebugMode(): void;
  }

  export class N8AOPostPass extends Pass {
    constructor(scene: THREE.Scene, camera: THREE.Camera, width?: number, height?: number);

    scene: THREE.Scene;
    camera: THREE.Camera;
    width: number;
    height: number;
    configuration: N8AOConfiguration;
    lastTime: number;
    needsDepthTexture: boolean;
    needsSwap: boolean;

    // Internal render targets and full-screen triangles exposed for disposal.
    writeTargetInternal?: THREE.WebGLRenderTarget;
    readTargetInternal?: THREE.WebGLRenderTarget;
    outputTargetInternal?: THREE.WebGLRenderTarget;
    accumulationRenderTarget?: THREE.WebGLRenderTarget;
    depthDownsampleTarget?: { dispose: () => void };
    transparencyRenderTargetDWFalse?: THREE.WebGLRenderTarget;
    transparencyRenderTargetDWTrue?: THREE.WebGLRenderTarget;
    effectShaderQuad?: { dispose: () => void };
    poissonBlurQuad?: { dispose: () => void };
    effectCompositerQuad?: { dispose: () => void };
    copyQuad?: { dispose: () => void };
    accumulationQuad?: { dispose: () => void };
    depthCopyPass?: { dispose: () => void };

    setSize(width: number, height: number): void;
    setDepthTexture(depthTexture: THREE.DepthTexture): void;
    setDisplayMode(mode: N8AODisplayMode): void;
    setQualityMode(mode: N8AOQualityMode): void;
    enableDebugMode(): void;
    disableDebugMode(): void;
  }
}
