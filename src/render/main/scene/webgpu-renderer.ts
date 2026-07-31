import * as THREE from 'three';
import { WebGPURenderer } from 'three/webgpu';
import { setKtx2SupportRenderer } from '../../assets/ktx2';
import { ensureNodeRectAreaLights } from '../../node-lights';
import { initRequiredWebGpu } from '../../webgpu-required';
import { resolveRenderQuality } from '../domain/render-quality';

export interface WebGpuRendererContext {
  rendererMode: 'webgpu';
  renderer: WebGPURenderer;
}

/**
 * Creates the required-WebGPU gameplay renderer.
 *
 * Initialization completes before this returns: KTX2 feature detection reads
 * the live backend synchronously, and gameplay starts loading arbitrary scene
 * content as soon as the renderer factory resolves.
 */
export async function createWebGpuRenderer(
  canvas: HTMLCanvasElement,
): Promise<WebGpuRendererContext> {
  const renderQuality = resolveRenderQuality();
  ensureNodeRectAreaLights();

  const renderer = new WebGPURenderer({
    antialias: renderQuality.antialias,
    canvas,
    logarithmicDepthBuffer: true,
    powerPreference: 'high-performance',
  });
  // Do not call dispose() on a rejected pre-init renderer. Three's pre-init
  // disposal path can try to initialize it again; the boot gate owns failure
  // presentation and no live render loop exists yet.
  await initRequiredWebGpu(renderer);

  renderer.setPixelRatio(
    Math.min(window.devicePixelRatio || 1, renderQuality.maxPixelRatio),
  );
  renderer.outputColorSpace = THREE.SRGBColorSpace;
  // The main PostProcessing node graph owns AgX and output conversion. Keeping
  // the renderer neutral prevents direct renderer settings from applying a
  // second tone-map to the post result.
  renderer.toneMapping = THREE.NoToneMapping;
  renderer.toneMappingExposure = 1.35;
  // Left on unconditionally so shadow quality can change without a reload.
  // Whether anything actually casts is owned per-light by `applyShadowQuality`
  // and `updateSunSystem`; with no caster the shadow pass renders nothing, and
  // keeping the flag steady avoids invalidating every scene material when the
  // player switches the setting.
  renderer.shadowMap.enabled = true;
  renderer.shadowMap.type = THREE.PCFSoftShadowMap;

  setKtx2SupportRenderer(renderer);
  return { rendererMode: 'webgpu', renderer };
}
