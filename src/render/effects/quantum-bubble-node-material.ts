import * as THREE from 'three';
import { NodeMaterial } from 'three/webgpu';
import {
  abs,
  clamp,
  float,
  fract,
  mix,
  sin,
  smoothstep,
  texture,
  uniform,
  uv,
  vec2,
  vec3,
  vec4,
} from 'three/tsl';
import type {
  HyperspaceMaterialFactory,
  HyperspaceMaterialHandle,
} from './quantum-bubble';

const TAU = Math.PI * 2;

/**
 * TSL counterpart to the legacy hyperspace `ShaderMaterial`.
 *
 * The material factory is injected into `createQuantumBubble()` so the current
 * WebGL game remains unchanged until the main renderer flips to WebGPU.
 */
export const createWebGpuHyperspaceMaterial: HyperspaceMaterialFactory = (
  flowTexture,
  opacityTexture,
): HyperspaceMaterialHandle => {
  const intensity = uniform(0);
  const elapsed = uniform(0);
  const flowTextureNode = texture(flowTexture);
  const opacityTextureNode = texture(opacityTexture);
  const surfaceUv = uv();
  const angle = surfaceUv.x.mul(TAU);
  const axis = surfaceUv.y;
  const flowUv = vec2(
    fract(surfaceUv.x.mul(2).add(elapsed.mul(0.025))),
    fract(axis.mul(3).sub(elapsed.mul(0.42))),
  );
  const opacityUv = vec2(
    fract(surfaceUv.x.mul(1.5).sub(elapsed.mul(0.018))),
    fract(axis.mul(2).sub(elapsed.mul(0.18))),
  );
  const flowSample = flowTextureNode.sample(flowUv).r;
  const opacitySample = opacityTextureNode.sample(opacityUv).r;
  const axialPulse = float(0.5).add(
    sin(
      axis
        .mul(56)
        .sub(elapsed.mul(8))
        .add(angle.mul(2))
        .add(flowSample.sub(0.5).mul(3)),
    ).mul(0.5),
  );
  const spiral = float(0.5).add(
    sin(angle.mul(5).add(axis.mul(14)).sub(elapsed.mul(2.5))).mul(0.5),
  );
  const streak = smoothstep(
    0.46,
    0.84,
    mix(flowSample, opacitySample, 0.42),
  );
  const lightning = smoothstep(
    0.68,
    0.96,
    abs(flowSample.sub(opacitySample)).mul(1.3).add(axialPulse.mul(0.34)),
  );
  const ribbon = smoothstep(
    0.58,
    0.92,
    streak.mul(0.72).add(spiral.mul(0.34)),
  );

  const violet = vec3(0.58, 0.08, 0.42);
  const blue = vec3(0.05, 0.42, 0.95);
  const cyan = vec3(0.32, 0.88, 1);
  const plasma = mix(
    mix(violet, blue, smoothstep(0.12, 0.78, axis)),
    cyan,
    streak.mul(0.52).add(lightning.mul(0.38)),
  );
  const energy = float(0.2)
    .add(streak.mul(0.58))
    .add(lightning.mul(0.72))
    .add(ribbon.mul(0.22));
  const color = vec3(0.003, 0.009, 0.035).add(plasma.mul(energy));
  const alpha = clamp(
    float(0.82)
      .add(streak.mul(0.1))
      .add(lightning.mul(0.05))
      .mul(intensity),
    0,
    0.98,
  );

  const material = new NodeMaterial();
  material.name = 'quantum-hyperspace-node';
  // outputNode keeps this compatible with the gameplay scene's MRT pass; see
  // the note in lake_water/render/node-material.ts.
  material.outputNode = vec4(color.mul(intensity), alpha);
  material.transparent = true;
  material.depthWrite = false;
  material.depthTest = true;
  material.side = THREE.BackSide;
  material.toneMapped = false;

  return {
    material,
    setFlowTexture(next) {
      flowTextureNode.value = next;
    },
    setIntensity(value) {
      intensity.value = value;
    },
    setOpacityTexture(next) {
      opacityTextureNode.value = next;
    },
    setTime(value) {
      elapsed.value = value;
    },
    dispose() {
      material.dispose();
    },
  };
};
