import * as THREE from 'three';
import { Effect } from 'postprocessing';
import type { ColorCorrectionSettings } from '../../../types';

const ColorCorrectionShader = `
  uniform float uEnabled;
  uniform float uBrightness;
  uniform float uContrast;
  uniform float uSaturation;
  uniform float uHue;
  uniform float uGamma;

  const vec3 LUMA = vec3(0.2126, 0.7152, 0.0722);

  vec3 hueShift(vec3 color, float hue) {
    float cosHue = cos(hue);
    float sinHue = sin(hue);
    return vec3(
      color.r * (0.299 + 0.701 * cosHue + 0.168 * sinHue) +
      color.g * (0.587 - 0.587 * cosHue + 0.330 * sinHue) +
      color.b * (0.114 - 0.114 * cosHue - 0.497 * sinHue),
      color.r * (0.299 - 0.299 * cosHue - 0.328 * sinHue) +
      color.g * (0.587 + 0.413 * cosHue + 0.035 * sinHue) +
      color.b * (0.114 - 0.114 * cosHue + 0.292 * sinHue),
      color.r * (0.299 - 0.300 * cosHue + 1.250 * sinHue) +
      color.g * (0.587 - 0.588 * cosHue - 1.050 * sinHue) +
      color.b * (0.114 + 0.886 * cosHue - 0.203 * sinHue)
    );
  }

  void mainImage(const in vec4 inputColor, const in vec2 uv, out vec4 outputColor) {
    if (uEnabled < 0.5) {
      outputColor = inputColor;
      return;
    }

    vec3 color = inputColor.rgb;

    // Brightness: additive offset in linear/display space.
    color += vec3(uBrightness);

    // Contrast: scale around mid-gray.
    color = (color - vec3(0.5)) * uContrast + vec3(0.5);

    // Hue: rotate RGB around the luma axis.
    color = hueShift(color, uHue);

    // Saturation: blend toward luma.
    float luma = dot(color, LUMA);
    color = mix(vec3(luma), color, uSaturation);

    // Gamma: power function with safe denominator.
    float invGamma = 1.0 / max(uGamma, 0.0001);
    color = pow(max(color, vec3(0.0)), vec3(invGamma));

    outputColor = vec4(color, inputColor.a);
  }
`;

export class ColorCorrectionEffect extends Effect {
  constructor() {
    super('ColorCorrectionEffect', ColorCorrectionShader, {
      uniforms: new Map<string, THREE.Uniform>([
        ['uEnabled', new THREE.Uniform(1.0)],
        ['uBrightness', new THREE.Uniform(0.0)],
        ['uContrast', new THREE.Uniform(1.0)],
        ['uSaturation', new THREE.Uniform(1.0)],
        ['uHue', new THREE.Uniform(0.0)],
        ['uGamma', new THREE.Uniform(1.0)],
      ]),
    });
  }

  setSettings(settings: Partial<ColorCorrectionSettings>): void {
    if (settings.enabled !== undefined) {
      this.uniforms.get('uEnabled')!.value = settings.enabled ? 1.0 : 0.0;
    }
    if (settings.brightness !== undefined) {
      this.uniforms.get('uBrightness')!.value = settings.brightness;
    }
    if (settings.contrast !== undefined) {
      this.uniforms.get('uContrast')!.value = settings.contrast;
    }
    if (settings.saturation !== undefined) {
      this.uniforms.get('uSaturation')!.value = settings.saturation;
    }
    if (settings.hue !== undefined) {
      this.uniforms.get('uHue')!.value = settings.hue;
    }
    if (settings.gamma !== undefined) {
      this.uniforms.get('uGamma')!.value = settings.gamma;
    }
  }
}
