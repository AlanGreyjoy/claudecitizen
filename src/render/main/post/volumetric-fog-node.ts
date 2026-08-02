import * as THREE from 'three';
import type { Node } from 'three/webgpu';
import {
  Break,
  Fn,
  If,
  Loop,
  cameraFar,
  cameraNear,
  float,
  int,
  logarithmicDepthToViewZ,
  mix,
  smoothstep,
  uniform,
  uv,
  vec2,
  vec3,
  vec4,
} from 'three/tsl';
import type { FogSettings, Planet } from '../../../types';
import { SURFACE_FOG_RAY_STEPS } from '../domain/constants';
import { noise3 } from '../../materials/tsl-noise';
import type { MainPostEnvironmentFrame } from './types';

/**
 * Ground-pooling haze only — the atmosphere owns real distance falloff.
 *
 * `density` is extinction per meter, so the old 0.006 was an extinction length
 * of ~256 m: geometry a kilometre out came back 96% fog color, and because the
 * raymarch runs on every `depth < 1` pixel it hit the cloud deck too, replacing
 * a horizon deck with flat `fogColorDay` on the *first* of eight steps. Takram's
 * aerial perspective already integrates the whole air column with the real
 * Bruneton solve; this pass exists on top of it purely to let fog settle in
 * valleys, so it has to be thin enough not to double-count. 1e-4 is ~15 km of
 * ground-level extinction length, a few percent of haze at a kilometre.
 */
const DEFAULT_FOG_SETTINGS: FogSettings = {
  density: 0.0001,
  maxHeight: 4000,
  heightFalloff: 350,
  noiseStrength: 0.4,
};

export interface MainVolumetricFogNode {
  node: Node;
  setSettings: (settings: FogSettings) => void;
  update: (frame: MainPostEnvironmentFrame, renderScale: number) => void;
}

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
  // `planetFogActive` was computed in `update/environment.ts` and passed in the
  // frame from the day this node landed, but nothing here ever read it, so
  // surface fog also ran inside stations and under solid/skybox backgrounds.
  const planetFogEnabled = uniform(1);

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
    const planetMask = smoothstep(0.2, 0.85, spaceFactor)
      .oneMinus()
      .mul(planetFogEnabled)
      .toVar();
    const depth = float(depthNode).toVar();

    If(planetMask.greaterThan(0.001).and(depth.lessThan(1)), () => {
      const viewZ = logarithmicDepthToViewZ(
        depth,
        cameraNear,
        cameraFar,
      ).toVar();
      // `uv()` on three's post quad has v = 0 at the *top* — its uv attribute
      // is flipped against the NDC positions so render-target sampling lines
      // up. Unprojecting it raw mirrors the ray vertically, so the marched
      // altitude band no longer matches the pixel it shades. three's own
      // `getViewPosition` undoes the flip the same way.
      //
      // Join as four scalars — `vec4(vec2, float, float)` is legal GLSL but
      // TSL's JoinNode has tripped over that shape in this stack before.
      const screenUv = uv();
      const ndc = vec2(screenUv.x, screenUv.y.oneMinus()).mul(2).sub(1);
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
      planetFogEnabled.value = frame.planetFogActive ? 1 : 0;
    },
  };
}
