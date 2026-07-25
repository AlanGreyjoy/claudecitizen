import * as THREE from 'three';
import { Effect, EffectAttribute } from 'postprocessing';

const SpeedBlurShader = `
  uniform float uStrength;
  uniform vec2 uCenter;

  void mainImage(const in vec4 inputColor, const in vec2 uv, out vec4 outputColor) {
    if (uStrength <= 0.0) {
      outputColor = inputColor;
      return;
    }
    
    vec2 toCenter = uCenter - uv;
    vec4 accumColor = vec4(0.0);
    float totalWeight = 0.0;
    
    const int SAMPLES = 8;
    for (int i = 0; i < SAMPLES; i++) {
      float t = float(i) / float(SAMPLES - 1);
      vec2 offsetUv = uv + toCenter * uStrength * t;
      offsetUv = clamp(offsetUv, 0.0, 1.0);
      
      float weight = 1.0 - (t * 0.5);
      accumColor += texture2D(inputBuffer, offsetUv) * weight;
      totalWeight += weight;
    }
    
    outputColor = accumColor / totalWeight;
  }
`;

export class SpeedBlurEffect extends Effect {
  constructor() {
    super('SpeedBlurEffect', SpeedBlurShader, {
      attributes: EffectAttribute.CONVOLUTION,
      uniforms: new Map<string, THREE.Uniform>([
        ['uStrength', new THREE.Uniform(0.0)],
        ['uCenter', new THREE.Uniform(new THREE.Vector2(0.5, 0.5))],
      ]),
    });
  }

  setStrength(value: number): void {
    this.uniforms.get('uStrength')!.value = value;
  }

  setCenter(x: number, y: number): void {
    this.uniforms.get('uCenter')!.value.set(x, y);
  }
}
