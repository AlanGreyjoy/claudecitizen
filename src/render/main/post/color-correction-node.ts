import type { Node } from 'three/webgpu';
import {
  Fn,
  If,
  cos,
  dot,
  float,
  max,
  mix,
  pow,
  sin,
  uniform,
  vec3,
  vec4,
} from 'three/tsl';
import type { ColorCorrectionSettings } from '../../../types';

export interface MainColorCorrectionNode {
  node: Node;
  setSettings: (settings: Partial<ColorCorrectionSettings>) => void;
}

/**
 * TSL port of `ColorCorrectionEffect`.
 *
 * The WebGPU post graph places this after AgX but before the final output-color
 * conversion, matching the current lens pass (tone map, correction, vignette).
 */
export function createMainColorCorrectionNode(
  inputNode: Node,
): MainColorCorrectionNode {
  const enabled = uniform(1);
  const brightness = uniform(0);
  const contrast = uniform(1);
  const saturation = uniform(1);
  const hue = uniform(0);
  const gamma = uniform(1);
  const lumaWeights = vec3(0.2126, 0.7152, 0.0722);

  const node = Fn(() => {
    const result = vec4(inputNode).toVar();
    If(enabled.greaterThanEqual(0.5), () => {
      const color = inputNode.rgb.add(brightness).toVar();
      color.assign(color.sub(0.5).mul(contrast).add(0.5));

      const cosHue = cos(hue);
      const sinHue = sin(hue);
      const source = color.toVar();
      color.assign(
        vec3(
          source.r
            .mul(float(0.299).add(cosHue.mul(0.701)).add(sinHue.mul(0.168)))
            .add(
              source.g.mul(
                float(0.587).sub(cosHue.mul(0.587)).add(sinHue.mul(0.33)),
              ),
            )
            .add(
              source.b.mul(
                float(0.114).sub(cosHue.mul(0.114)).sub(sinHue.mul(0.497)),
              ),
            ),
          source.r
            .mul(float(0.299).sub(cosHue.mul(0.299)).sub(sinHue.mul(0.328)))
            .add(
              source.g.mul(
                float(0.587).add(cosHue.mul(0.413)).add(sinHue.mul(0.035)),
              ),
            )
            .add(
              source.b.mul(
                float(0.114).sub(cosHue.mul(0.114)).add(sinHue.mul(0.292)),
              ),
            ),
          source.r
            .mul(float(0.299).sub(cosHue.mul(0.3)).add(sinHue.mul(1.25)))
            .add(
              source.g.mul(
                float(0.587).sub(cosHue.mul(0.588)).sub(sinHue.mul(1.05)),
              ),
            )
            .add(
              source.b.mul(
                float(0.114).add(cosHue.mul(0.886)).sub(sinHue.mul(0.203)),
              ),
            ),
        ),
      );

      const luminance = dot(color, lumaWeights);
      color.assign(mix(vec3(luminance), color, saturation));
      color.assign(
        pow(
          max(color, vec3(0)),
          vec3(float(1).div(max(gamma, 0.0001))),
        ),
      );
      result.assign(vec4(color, inputNode.a));
    });
    return result;
  })();

  return {
    node,
    setSettings(settings) {
      if (settings.enabled !== undefined) {
        enabled.value = settings.enabled ? 1 : 0;
      }
      if (settings.brightness !== undefined) {
        brightness.value = settings.brightness;
      }
      if (settings.contrast !== undefined) {
        contrast.value = settings.contrast;
      }
      if (settings.saturation !== undefined) {
        saturation.value = settings.saturation;
      }
      if (settings.hue !== undefined) {
        hue.value = settings.hue;
      }
      if (settings.gamma !== undefined) {
        gamma.value = settings.gamma;
      }
    },
  };
}
