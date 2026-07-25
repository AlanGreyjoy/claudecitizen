import * as THREE from 'three';
import type { RendererMode } from '../domain/types';
import { resolveRenderQuality } from '../domain/render_quality';

export interface WebGlRendererContext {
  rendererMode: RendererMode;
  renderer: THREE.WebGLRenderer;
}

export function createWebGlRenderer(canvas: HTMLCanvasElement): WebGlRendererContext {
  const renderQuality = resolveRenderQuality();
  let rendererMode: RendererMode = 'log-depth';
  let renderer: THREE.WebGLRenderer;
  try {
    renderer = new THREE.WebGLRenderer({
      antialias: renderQuality.antialias,
      canvas,
      logarithmicDepthBuffer: true,
      powerPreference: 'high-performance',
    });
  } catch {
    try {
      rendererMode = 'default-depth';
      renderer = new THREE.WebGLRenderer({
        antialias: renderQuality.antialias,
        canvas,
        powerPreference: 'high-performance',
      });
    } catch {
      rendererMode = 'compatibility';
      renderer = new THREE.WebGLRenderer({
        antialias: false,
        canvas,
      });
    }
  }

  renderer.setPixelRatio(Math.min(window.devicePixelRatio || 1, renderQuality.maxPixelRatio));
  renderer.outputColorSpace = THREE.SRGBColorSpace;
  // Tone mapping itself runs in the composer's ToneMappingEffect (AgX), but the
  // effect shader reads this renderer uniform for exposure. AgX sits darker
  // than ACES at exposure 1.0, so compensate here.
  renderer.toneMappingExposure = 1.35;
  renderer.shadowMap.enabled = renderQuality.shadowMapSize > 0;
  renderer.shadowMap.type = THREE.PCFSoftShadowMap;

  return { rendererMode, renderer };
}
