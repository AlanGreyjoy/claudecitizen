import * as THREE from 'three';
import type { Node } from 'three/webgpu';
import {
  Break,
  Fn,
  If,
  Loop,
  cameraFar,
  cameraNear,
  dot,
  float,
  floor,
  fract,
  int,
  logarithmicDepthToViewZ,
  mix,
  smoothstep,
  uniform,
  uv,
  vec3,
  vec4,
} from 'three/tsl';
import type { FogSettings, Planet } from '../../../types';
import { SURFACE_FOG_RAY_STEPS } from '../domain/constants';
import type { MainPostEnvironmentFrame } from './types';

const DEFAULT_FOG_SETTINGS: FogSettings = {
  density: 0.006,
  maxHeight: 4000,
  heightFalloff: 350,
  noiseStrength: 0.4,
};

export interface MainVolumetricFogNode {
  node: Node;
  setSettings: (settings: FogSettings) => void;
  update: (frame: MainPostEnvironmentFrame, renderScale: number) => void;
}

/** Value-noise hash from the GLSL original, kept bit-for-bit in structure. */
const hash31 = Fn(([p]: [ReturnType<typeof vec3>]) => {
  const q = fract(p.mul(0.1031)).toVar();
  q.addAssign(dot(q, q.yzx.add(33.33)));
  return fract(q.x.add(q.y).mul(q.z));
});

const noise3 = Fn(([p]: [ReturnType<typeof vec3>]) => {
  const i = floor(p).toVar();
  const f = fract(p).toVar();
  f.assign(f.mul(f).mul(float(3).sub(f.mul(2))));
  const n000 = hash31(i.add(vec3(0, 0, 0)));
  const n100 = hash31(i.add(vec3(1, 0, 0)));
  const n010 = hash31(i.add(vec3(0, 1, 0)));
  const n110 = hash31(i.add(vec3(1, 1, 0)));
  const n001 = hash31(i.add(vec3(0, 0, 1)));
  const n101 = hash31(i.add(vec3(1, 0, 1)));
  const n011 = hash31(i.add(vec3(0, 1, 1)));
  const n111 = hash31(i.add(vec3(1, 1, 1)));
  const nx00 = mix(n000, n100, f.x);
  const nx10 = mix(n010, n110, f.x);
  const nx01 = mix(n001, n101, f.x);
  const nx11 = mix(n011, n111, f.x);
  return mix(mix(nx00, nx10, f.y), mix(nx01, nx11, f.y), f.z);
});

/**
 * TSL port of `VolumetricFogEffect` — the depth-aware planet fog raymarch.
 *
 * `NodeMaterial`'s built-in fog is per-material and distance-based; it cannot
 * reproduce this, which marches the camera-to-surface ray and samples an
 * altitude-banded density field so fog pools in valleys and thins with height.
 * That is why the WebGPU stack needs its own node rather than reusing scene fog.
 *
 * Depth is linearized with `logarithmicDepthToViewZ` to match the gameplay
 * renderer's `logarithmicDepthBuffer`, mirroring the original's `LOG_DEPTH`
 * define.
 */
export function createMainVolumetricFogNode(
  inputNode: Node,
  depthNode: Node,
  planet: Planet,
  renderScale: number,
): MainVolumetricFogNode {
  const projectionMatrixInverse = uniform(new THREE.Matrix4());
  const cameraMatrixWorld = uniform(new THREE.Matrix4());
  const planetCenter = uniform(new THREE.Vector3());
  const planetRadius = uniform(planet.radiusMeters);
  const renderScaleUniform = uniform(renderScale);
  const fogColorDay = uniform(new THREE.Color(0xb8daf2));
  const fogColorNight = uniform(new THREE.Color(0x0b1526));
  const time = uniform(0);
  const daylightFactor = uniform(1);
  const fogDensity = uniform(DEFAULT_FOG_SETTINGS.density);
  const fogMaxHeight = uniform(DEFAULT_FOG_SETTINGS.maxHeight);
  const fogHeightFalloff = uniform(DEFAULT_FOG_SETTINGS.heightFalloff);
  const noiseStrength = uniform(DEFAULT_FOG_SETTINGS.noiseStrength);
  const spaceFactor = uniform(0);

  const fogDensityAt = Fn(([worldPos]: [ReturnType<typeof vec3>]) => {
    const scale = renderScaleUniform.max(0.000001);
    const altitude = worldPos
      .sub(planetCenter)
      .length()
      .sub(planetRadius)
      .div(scale)
      .toVar();
    const density = float(0).toVar();
    If(
      altitude.greaterThanEqual(-200).and(altitude.lessThanEqual(fogMaxHeight)),
      () => {
        const heightTerm = altitude
          .max(0)
          .negate()
          .div(fogHeightFalloff.max(1))
          .exp()
          .toVar();
        heightTerm.mulAssign(
          altitude
            .smoothstep(fogMaxHeight.mul(0.65), fogMaxHeight)
            .oneMinus(),
        );
        const noisePos = worldPos
          .div(scale)
          .mul(0.00008)
          .add(vec3(time.mul(0.004), time.mul(0.003), time.mul(0.002)));
        const noiseTerm = mix(
          float(1),
          noise3(noisePos).mul(0.65).add(0.35),
          noiseStrength,
        );
        density.assign(fogDensity.mul(heightTerm).mul(noiseTerm));
      },
    );
    return density;
  });

  const node = Fn(() => {
    const output = vec4(inputNode).toVar();
    const planetMask = smoothstep(0.2, 0.85, spaceFactor).oneMinus().toVar();
    const depth = float(depthNode).toVar();

    If(planetMask.greaterThan(0.001).and(depth.lessThan(1)), () => {
      const viewZ = logarithmicDepthToViewZ(
        depth,
        cameraNear,
        cameraFar,
      ).toVar();
      // Join as four scalars — `vec4(vec2, float, float)` is legal GLSL but
      // TSL's JoinNode has tripped over that shape in this stack before.
      const ndc = uv().mul(2).sub(1);
      const rayClip = vec4(ndc.x, ndc.y, 1, 1);
      const rayEye = projectionMatrixInverse.mul(rayClip).toVar();
      const eyeDir = rayEye.xyz.div(rayEye.w.abs().max(0.00001)).toVar();
      const surfaceView = eyeDir.mul(viewZ.negate().div(eyeDir.z)).toVar();
      const surfaceWorld = cameraMatrixWorld
        .mul(vec4(surfaceView, 1))
        .xyz.toVar();
      const cameraWorld = cameraMatrixWorld[3].xyz.toVar();

      const toSurface = surfaceWorld.sub(cameraWorld).toVar();
      const maxDist = toSurface.length().toVar();
      const rayDir = toSurface.normalize().toVar();
      const fogColor = mix(fogColorNight, fogColorDay, daylightFactor).toVar();

      const stepLength = maxDist.div(float(SURFACE_FOG_RAY_STEPS)).toVar();
      const stepSizeMeters = stepLength
        .div(renderScaleUniform.max(0.000001))
        .toVar();
      const transmittance = float(1).toVar();
      const scattered = vec3(0).toVar();

      Loop(
        {
          start: int(0),
          end: int(SURFACE_FOG_RAY_STEPS),
          type: 'int',
          condition: '<',
        },
        ({ i }) => {
          const t = float(i).add(0.5).mul(stepLength);
          const samplePos = cameraWorld.add(rayDir.mul(t));
          const density = fogDensityAt(samplePos).mul(planetMask).toVar();
          If(density.greaterThan(0), () => {
            const absorb = density.mul(stepSizeMeters).mul(0.65).negate().exp();
            scattered.addAssign(
              transmittance.mul(absorb.oneMinus()).mul(fogColor),
            );
            transmittance.mulAssign(absorb);
            If(transmittance.lessThan(0.02), () => {
              Break();
            });
          });
        },
      );

      output.assign(
        vec4(output.rgb.mul(transmittance).add(scattered), output.a),
      );
    });

    return output;
  })();

  return {
    node,
    setSettings(settings) {
      fogDensity.value = settings.density;
      fogMaxHeight.value = settings.maxHeight;
      fogHeightFalloff.value = settings.heightFalloff;
      noiseStrength.value = settings.noiseStrength;
    },
    update(frame, nextRenderScale) {
      projectionMatrixInverse.value.copy(frame.camera.projectionMatrixInverse);
      cameraMatrixWorld.value.copy(frame.camera.matrixWorld);
      planetCenter.value.copy(frame.planetCenter);
      planetRadius.value = frame.planetRadiusMeters;
      renderScaleUniform.value = nextRenderScale;
      fogColorDay.value.copy(frame.fogColorDay);
      fogColorNight.value.copy(frame.fogColorNight);
      time.value = frame.nowSeconds;
      daylightFactor.value = frame.daylightFactor;
      spaceFactor.value = frame.spaceFactor;
    },
  };
}
