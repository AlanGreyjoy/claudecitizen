import * as THREE from 'three';
import { NodeMaterial } from 'three/webgpu';
import {
  Fn,
  abs,
  cameraProjectionMatrix,
  cameraViewMatrix,
  clamp,
  cos,
  dot,
  float,
  mix,
  modelWorldMatrix,
  positionGeometry,
  sin,
  smoothstep,
  uniform,
  vec3,
  vec4,
} from 'three/tsl';
import type TslBaseNode from 'three/src/nodes/core/Node.js';
import type { CloudShellMaterialFactory } from './shell';

type Tsl = TslBaseNode;

/**
 * TSL counterpart to the legacy cloud-shell ShaderMaterial.
 *
 * The shell itself remains renderer-neutral: a WebGPU owner passes this
 * factory to `createCloudShell`, while the existing WebGL caller keeps using
 * the default GLSL material. Coverage constants deliberately mirror
 * `sampleCloudCoverage` in world/clouds.ts and the GLSL fallback in shell.ts.
 */
export const createWebGpuCloudShellMaterial: CloudShellMaterialFactory = ({
  cameraSimPosition,
  invRenderScale,
  phase,
  scale,
}) => {
  const uniforms = {
    cameraSimPosition: uniform(cameraSimPosition),
    invRenderScale: uniform(invRenderScale),
    driftAngle: uniform(0),
    scale: uniform(scale),
    phase: uniform(phase),
    opacity: uniform(0),
  };

  const cloudCoverage = Fn<[Tsl]>(([direction]) => {
    const p = direction.mul(uniforms.scale).toVar();
    const continental = sin(
      p.x.mul(2.8).add(p.y.mul(1.1)).add(uniforms.phase.mul(0.7)),
    )
      .mul(0.48)
      .add(
        cos(
          p.y.mul(3.2).sub(p.z.mul(1.4)).sub(uniforms.phase.mul(0.4)),
        ).mul(0.3),
      )
      .add(
        sin(
          p.x
            .mul(1.6)
            .add(p.z.mul(2.1))
            .add(p.y.mul(1.3))
            .add(uniforms.phase.mul(1.2)),
        ).mul(0.18),
      );
    const billow = sin(
      p.x
        .mul(9.2)
        .sub(p.y.mul(6.4))
        .add(p.z.mul(4.1))
        .add(uniforms.phase.mul(1.5)),
    )
      .mul(0.15)
      .add(
        cos(
          p.x
            .mul(14.5)
            .add(p.y.mul(8.2))
            .sub(p.z.mul(11.3))
            .sub(uniforms.phase.mul(0.85)),
        ).mul(0.12),
      )
      .add(
        sin(
          p.x
            .mul(22.1)
            .add(p.y.mul(18.4))
            .add(p.z.mul(15.7))
            .add(uniforms.phase.mul(2.1)),
        ).mul(0.07),
      );
    const ridges = float(1).sub(
      abs(
        sin(
          p.x
            .mul(7.1)
            .add(p.y.mul(5.3))
            .add(uniforms.phase.mul(0.55)),
        ).mul(
          cos(
            p.z
              .mul(6.8)
              .sub(p.y.mul(4.2))
              .sub(uniforms.phase.mul(0.95)),
          ),
        ),
      ),
    );
    const density = continental
      .mul(0.62)
      .add(ridges.mul(2).sub(1).mul(0.18))
      .add(billow);
    return clamp(density.add(0.28).div(1.18), 0, 1);
  });

  // Preserve the GLSL varying's object-local sphere position. The group moves
  // with the camera, but this offset is converted back to sim space below.
  const sceneOffset = positionGeometry.toVarying('cloudSceneOffset');

  const vertex = Fn(() =>
    cameraProjectionMatrix
      .mul(cameraViewMatrix)
      .mul(modelWorldMatrix)
      .mul(vec4(positionGeometry, 1)),
  )();

  const fragment = Fn(() => {
    const viewDirection = sceneOffset.normalize().toVar();
    const cameraUp = uniforms.cameraSimPosition.normalize().toVar();
    const elevationFade = smoothstep(
      0.02,
      0.12,
      dot(viewDirection, cameraUp),
    ).toVar();

    const simulationPosition = uniforms.cameraSimPosition
      .add(sceneOffset.mul(uniforms.invRenderScale))
      .toVar();
    const direction = simulationPosition.normalize().toVar();
    const driftCos = cos(uniforms.driftAngle).toVar();
    const driftSin = sin(uniforms.driftAngle).toVar();
    direction.assign(
      vec3(
        driftCos.mul(direction.x).add(driftSin.mul(direction.z)),
        direction.y,
        driftCos.mul(direction.z).sub(driftSin.mul(direction.x)),
      ),
    );

    const coverage = cloudCoverage(direction).toVar();
    const cloudAlpha = clamp(coverage.sub(0.28).div(0.42), 0, 1).toVar();
    const alpha = cloudAlpha
      .mul(elevationFade)
      .mul(uniforms.opacity)
      .toVar();
    alpha.lessThan(0.06).discard();

    const color = vec3(
      mix(0.831, 1, cloudAlpha),
      mix(0.831, 1, cloudAlpha),
      mix(0.93, 1, cloudAlpha),
    );
    return vec4(color, alpha);
  })();

  const material = new NodeMaterial();
  material.vertexNode = vertex;
  // outputNode keeps this compatible with the gameplay scene's MRT pass; see
  // the note in lake_water/render/node-material.ts.
  material.outputNode = fragment;
  material.depthWrite = false;
  material.depthTest = true;
  material.side = THREE.BackSide;
  material.transparent = true;
  material.blending = THREE.NormalBlending;
  material.fog = false;

  return {
    material,
    setDriftAngle(value) {
      uniforms.driftAngle.value = value;
    },
    setOpacity(value) {
      uniforms.opacity.value = value;
    },
    dispose() {
      material.dispose();
    },
  };
};
