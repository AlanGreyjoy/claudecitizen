import * as THREE from 'three';
import { NodeMaterial } from 'three/webgpu';
import {
  Fn,
  attribute,
  cameraViewMatrix,
  clamp,
  directionToFaceDirection,
  dot,
  float,
  floor,
  fwidth,
  mix,
  positionGeometry,
  positionView,
  sin,
  smoothstep,
  step,
  uniform,
  vec3,
  vec4,
} from 'three/tsl';
import type { SurfaceWaterMaterialFactory } from './material';

// The packed attributes are vec4 for WebGPU vertex-format reasons only; the
// fourth component of barycentric and color is padding. `waterFactor` carries
// effectDetail, shore, and surf strength in x/y/z.
const barycentricAttribute = attribute('barycentric', 'vec4').xyz;
const facetColorAttribute = attribute('color', 'vec4').xyz;
const waterFactorAttribute = attribute('waterFactor', 'vec4');
const effectDetailAttribute = waterFactorAttribute.x;
const shoreAttribute = waterFactorAttribute.y;
const surfStrengthAttribute = waterFactorAttribute.z;
const radialDirectionAttribute = attribute('radialDirection', 'vec3');
const waterDepthAttribute = attribute('waterDepth', 'float');

/**
 * TSL counterpart to the faceted GLSL lake-water material.
 *
 * The fragment node returns linear color. WebGPURenderer performs tone mapping
 * and output conversion in its output pass, so the GLSL chunks are deliberately
 * not reproduced here. NodeMaterial's normal fog pipeline handles scene fog.
 */
export const createWebGpuSurfaceWaterMaterial: SurfaceWaterMaterialFactory = ({
  planetRadiusMeters,
}) => {
  const uniforms = {
    planetRadius: uniform(planetRadiusMeters),
    skyColor: uniform(new THREE.Color(0x7eb8e8)),
    sunColor: uniform(new THREE.Color(0xffffff)),
    sunDirection: uniform(
      new THREE.Vector3(0.4, 0.85, 0.2).normalize(),
    ),
    time: uniform(0),
  };

  const barycentric = barycentricAttribute.toVarying(
    'waterBarycentric',
  );
  const facetColor = facetColorAttribute.toVarying('waterFacetColor');
  const effectDetail = effectDetailAttribute.toVarying(
    'waterEffectDetail',
  );
  const shore = shoreAttribute.toVarying('waterShore');
  const surfStrength = surfStrengthAttribute.toVarying(
    'waterSurfStrength',
  );
  const waterDepth = waterDepthAttribute.toVarying('waterDepthValue');
  const radial = radialDirectionAttribute.normalize().toVar();
  const sunDirectionView = cameraViewMatrix
    .mul(vec4(uniforms.sunDirection, 0))
    .xyz.normalize()
    .toVarying('waterSunDirection');

  const wavePhaseA = dot(radial, vec3(0.73, -0.21, 0.65))
    .mul(uniforms.planetRadius)
    .div(18);
  const wavePhaseB = dot(radial, vec3(-0.37, 0.88, 0.29))
    .mul(uniforms.planetRadius)
    .div(31);
  const wave = sin(wavePhaseA.add(uniforms.time.mul(1.15)))
    .mul(0.46)
    .add(sin(wavePhaseB.sub(uniforms.time.mul(0.82))).mul(0.28));
  const waveAmplitude = mix(0.08, 0.72, effectDetailAttribute)
    .mul(float(1).sub(shoreAttribute.mul(0.72)));
  const animatedPosition = positionGeometry.add(
    radial.mul(wave).mul(waveAmplitude),
  );

  const fragment = Fn(() => {
    const viewDirection = positionView.negate().normalize().toVar();
    const facetNormal = directionToFaceDirection(
      positionView
        .dFdx()
        .cross(positionView.dFdy())
        .normalize(),
    ).toVar();
    const lightDirection = sunDirectionView.normalize().toVar();
    const facing = dot(viewDirection, facetNormal).max(0).toVar();
    const fresnel = float(1).sub(facing).pow(2.5).toVar();

    const diffuse = dot(lightDirection, facetNormal).max(0).toVar();
    const lightBand = floor(diffuse.mul(3).add(0.5)).div(3).toVar();
    const facetPhase = dot(
      facetColor,
      vec3(13.17, 21.73, 9.41),
    ).toVar();
    const shimmer = sin(
      uniforms.time.mul(0.65).add(facetPhase),
    )
      .mul(0.02)
      .add(0.98)
      .toVar();
    const scatter = facetColor
      .mul(lightBand.mul(0.36).add(0.64))
      .mul(shimmer)
      .toVar();
    const shallow = smoothstep(
      2,
      22,
      waterDepth.max(0),
    )
      .oneMinus()
      .toVar();
    const shallowTint = vec3(0.18, 0.54, 0.52);
    scatter.assign(
      mix(
        scatter,
        shallowTint.mul(lightBand.mul(0.28).add(0.72)),
        shallow.mul(0.3),
      ),
    );

    const halfDirection = lightDirection
      .add(viewDirection)
      .normalize()
      .toVar();
    const specular = step(
      0.965,
      dot(facetNormal, halfDirection).max(0),
    ).toVar();

    const color = mix(
      scatter,
      uniforms.skyColor,
      fresnel.mul(0.52),
    ).toVar();
    color.addAssign(uniforms.sunColor.mul(specular).mul(0.28));

    const barycentricWidth = fwidth(barycentric).toVar();
    const barycentricSmooth = smoothstep(
      barycentricWidth.mul(0.7),
      barycentricWidth.mul(1.9),
      barycentric,
    ).toVar();
    const facetEdge = barycentricSmooth.x
      .min(barycentricSmooth.y)
      .min(barycentricSmooth.z)
      .oneMinus()
      .toVar();
    const causticPulse = sin(
      uniforms.time.mul(0.7).add(facetPhase.mul(2)),
    )
      .mul(0.22)
      .add(0.78)
      .toVar();
    const caustic = facetEdge
      .mul(shallow)
      .mul(smoothstep(0.25, 0.8, shore).oneMinus())
      .mul(effectDetail)
      .toVar();
    color.assign(
      mix(
        color,
        vec3(0.46, 0.86, 0.78),
        caustic.mul(causticPulse).mul(0.24),
      ),
    );

    const foamThreshold = sin(
      uniforms.time.mul(0.85).add(facetPhase.mul(2.7)),
    )
      .mul(0.07)
      .add(0.48)
      .toVar();
    const foam = smoothstep(
      foamThreshold,
      foamThreshold.add(0.2),
      surfStrength,
    ).toVar();
    const foamBreakup = sin(
      barycentric.x
        .mul(1.7)
        .add(barycentric.y.mul(2.3))
        .mul(8)
        .add(facetPhase),
    )
      .mul(0.22)
      .add(0.78)
      .toVar();
    foam.mulAssign(foamBreakup.mul(effectDetail));
    const saturatedFoam = clamp(foam, 0, 1).toVar();
    color.assign(mix(color, vec3(0.94, 0.99, 1), saturatedFoam));

    const alpha = mix(0.86, 0.95, fresnel).toVar();
    alpha.assign(mix(alpha, 0.7, shallow.mul(0.42)));
    alpha.assign(mix(alpha, 0.98, saturatedFoam));
    return vec4(color, alpha);
  })();

  const material = new NodeMaterial();
  material.positionNode = animatedPosition;
  // outputNode, not fragmentNode: the gameplay scene pass renders MRT (color +
  // normal) for GTAO, and NodeMaterial only merges the renderer's MRT on the
  // `fragmentNode === null` path. A fragmentNode material emits one color and
  // fails pipeline validation with "targets[1] has no corresponding fragment
  // stage output".
  material.outputNode = fragment;
  material.depthWrite = false;
  material.depthTest = true;
  material.fog = true;
  material.side = THREE.FrontSide;
  material.transparent = true;
  material.blending = THREE.NormalBlending;

  return {
    material,
    setSkyColor(color) {
      uniforms.skyColor.value.copy(color);
    },
    setSunColor(color) {
      uniforms.sunColor.value.copy(color);
    },
    setSunDirection(direction) {
      uniforms.sunDirection.value.copy(direction).normalize();
    },
    setTime(seconds) {
      uniforms.time.value = seconds;
    },
    dispose() {
      material.dispose();
    },
  };
};
