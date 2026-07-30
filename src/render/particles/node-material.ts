import * as THREE from "three";
import { NodeMaterial } from "three/webgpu";
import {
  Fn,
  If,
  attribute,
  cameraProjectionMatrix,
  cameraViewMatrix,
  float,
  modelWorldMatrix,
  positionGeometry,
  screenUV,
  smoothstep,
  uniform,
  uniformTexture,
  uv,
  vec3,
  vec4,
} from "three/tsl";
import type {
  ParticleMaterialFactory,
  ParticleMaterialOptions,
} from "./material";

const instancePosition = attribute("instancePositionAttr", "vec3");
const instanceSize = attribute("instanceSize", "float");
const instanceColor = attribute("instanceColorAttr", "vec3");
const instanceAlpha = attribute("instanceAlpha", "float");
const instanceTileOffset = attribute("instanceTileOffset", "vec2");
const instanceTileScale = attribute("instanceTileScale", "vec2");
const instanceStretch = attribute("instanceStretch", "float");

/**
 * TSL counterpart to the legacy particle `ShaderMaterial`.
 *
 * The instance center and size are explicit attributes instead of reaching
 * through Three's private `InstanceNode` for its matrix. That keeps this
 * material on public TSL APIs while preserving the old shader's behavior:
 * instance transforms place the center, then the quad axes face the camera.
 */
export const createWebGpuParticleMaterial: ParticleMaterialFactory = (
  options: ParticleMaterialOptions,
) => {
  const uniforms = {
    map: uniformTexture(options.map ?? undefined),
    hasMap: uniform(options.map ? 1 : 0),
    softEnabled: uniform(
      options.softParticles && options.depthTexture ? 1 : 0,
    ),
    softNear: uniform(options.softNear),
    softFar: uniform(options.softFar),
    cameraNear: uniform(0.1),
    cameraFar: uniform(2000),
    depth: uniformTexture(options.depthTexture ?? undefined),
    additive: uniform(options.blendMode === "additive" ? 1 : 0),
    renderMode: uniform(renderModeValue(options)),
  };
  const emptyMap = uniforms.map.value;
  const emptyDepth = uniforms.depth.value;

  const centerView = cameraViewMatrix
    .mul(modelWorldMatrix)
    .mul(vec4(instancePosition, 1));
  const particleViewDepth = centerView.z
    .negate()
    .toVarying("particleViewDepth");

  const vertex = Fn(() => {
    const right = vec3(
      cameraViewMatrix[0][0],
      cameraViewMatrix[1][0],
      cameraViewMatrix[2][0],
    ).toVar();
    const up = vec3(
      cameraViewMatrix[0][1],
      cameraViewMatrix[1][1],
      cameraViewMatrix[2][1],
    ).toVar();

    If(uniforms.renderMode.equal(2), () => {
      right.assign(
        vec3(
          cameraViewMatrix[0][0],
          0,
          cameraViewMatrix[2][0],
        ).normalize(),
      );
      up.assign(vec3(0, 1, 0));
    }).ElseIf(uniforms.renderMode.equal(3), () => {
      right.assign(
        vec3(
          cameraViewMatrix[0][0],
          0,
          cameraViewMatrix[2][0],
        ).normalize(),
      );
      up.assign(
        vec3(
          cameraViewMatrix[0][1],
          cameraViewMatrix[1][1],
          cameraViewMatrix[2][1],
        ).normalize(),
      );
    });

    const stretch = uniforms.renderMode
      .equal(1)
      .select(instanceStretch.max(1), float(1))
      .toVar();
    const local = vec3(positionGeometry).toVar();
    local.y.mulAssign(stretch);
    const viewOffset = right
      .mul(local.x.mul(instanceSize))
      .add(up.mul(local.y.mul(instanceSize)));
    return cameraProjectionMatrix.mul(
      vec4(centerView.xyz.add(viewOffset), 1),
    );
  })();

  const fragment = Fn(() => {
    const particleUv = uv()
      .mul(instanceTileScale)
      .add(instanceTileOffset);
    const sampled = uniforms.map.sample(particleUv);
    const texel = uniforms.hasMap
      .equal(1)
      .select(sampled, vec4(1))
      .toVar();
    const alpha = texel.a.mul(instanceAlpha).toVar();
    const rgb = texel.rgb.mul(instanceColor).toVar();

    If(uniforms.softEnabled.equal(1), () => {
      const depth = uniforms.depth.sample(screenUV).r;
      // WebGPU clip space is z in [0,1]. The GLSL original remapped to
      // OpenGL's [-1,1] before linearizing; carrying that remap here would
      // fade particles at the wrong distances.
      const sceneDepth = uniforms.cameraNear
        .mul(uniforms.cameraFar)
        .div(
          uniforms.cameraFar.sub(
            depth.mul(uniforms.cameraFar.sub(uniforms.cameraNear)),
          ),
        );
      alpha.mulAssign(
        smoothstep(
          uniforms.softNear,
          uniforms.softFar,
          sceneDepth.sub(particleViewDepth),
        ),
      );
    });

    alpha.lessThan(0.01).discard();
    const outputRgb = uniforms.additive
      .equal(1)
      .select(rgb.mul(alpha), rgb);
    return vec4(outputRgb, alpha);
  })();

  const material = new NodeMaterial();
  material.vertexNode = vertex;
  // outputNode keeps this compatible with the gameplay scene's MRT pass; see
  // the note in lake_water/render/node-material.ts.
  material.outputNode = fragment;
  material.transparent = true;
  material.depthWrite = false;
  // The legacy ShaderMaterial is deliberately unaffected by scene fog. Keep
  // parity here, and avoid the default fog node using a position path that
  // does not know about this material's custom billboard vertex.
  material.fog = false;
  material.blending =
    options.blendMode === "additive"
      ? THREE.AdditiveBlending
      : THREE.NormalBlending;
  let blendMode = options.blendMode;

  return {
    material,
    applyOptions(next) {
      uniforms.map.value = next.map ?? emptyMap;
      uniforms.hasMap.value = next.map ? 1 : 0;
      uniforms.softEnabled.value =
        next.softParticles && next.depthTexture ? 1 : 0;
      uniforms.softNear.value = next.softNear;
      uniforms.softFar.value = next.softFar;
      uniforms.depth.value = next.depthTexture ?? emptyDepth;
      uniforms.additive.value = next.blendMode === "additive" ? 1 : 0;
      uniforms.renderMode.value = renderModeValue(next);
      if (next.blendMode !== blendMode) {
        blendMode = next.blendMode;
        material.blending =
          blendMode === "additive"
            ? THREE.AdditiveBlending
            : THREE.NormalBlending;
        material.needsUpdate = true;
      }
    },
    updateCamera(camera) {
      const perspective = camera as THREE.PerspectiveCamera;
      if (!perspective.isPerspectiveCamera) return;
      uniforms.cameraNear.value = perspective.near;
      uniforms.cameraFar.value = perspective.far;
    },
    dispose() {
      material.dispose();
    },
  };
};

function renderModeValue(options: ParticleMaterialOptions): number {
  return options.renderMode === "stretched-billboard"
    ? 1
    : options.renderMode === "horizontal"
      ? 2
      : options.renderMode === "vertical"
        ? 3
        : 0;
}
