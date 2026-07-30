import type { Node } from 'three/webgpu';
import { Fn, smoothstep, uniform, uv, vec2, vec4 } from 'three/tsl';

export interface MainVignetteNode {
  node: Node;
}

/**
 * TSL port of postprocessing's default vignette technique.
 *
 * Keep this after tone mapping and color correction, but before the final
 * working-to-output color-space transform, matching the existing lens pass.
 */
export function createMainVignetteNode(
  inputNode: Node,
  options: { darkness?: number; offset?: number } = {},
): MainVignetteNode {
  const darkness = uniform(options.darkness ?? 0.28);
  const offset = uniform(options.offset ?? 0.3);

  const node = Fn(() => {
    const distanceFromCenter = uv().distance(vec2(0.5));
    const factor = smoothstep(
      0.8,
      offset.mul(0.799),
      distanceFromCenter.mul(darkness.add(offset)),
    );
    return vec4(inputNode.rgb.mul(factor), inputNode.a);
  })();

  return { node };
}
