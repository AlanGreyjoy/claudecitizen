import { RectAreaLightNode } from 'three/webgpu';
import { RectAreaLightTexturesLib } from 'three/examples/jsm/lights/RectAreaLightTexturesLib.js';

let rectAreaLightTexturesInitialized = false;

/**
 * Installs the LTC lookup textures used by RectAreaLight on the node renderer.
 *
 * The WebGL uniforms initializer in prefab-renderer does not initialize the
 * WebGPU node-light singleton. Every WebGPU surface that may render an
 * arbitrary prefab must call this before its first frame.
 */
export function ensureNodeRectAreaLights(): void {
  if (rectAreaLightTexturesInitialized) return;
  RectAreaLightNode.setLTC(RectAreaLightTexturesLib.init());
  rectAreaLightTexturesInitialized = true;
}
