import * as THREE from 'three';
import type { Node } from 'three/webgpu';
import {
  Fn,
  If,
  abs,
  float,
  floor,
  fract,
  fwidth,
  mix,
  smoothstep,
  uniform,
  uv,
  vec2,
  vec3,
  vec4,
} from 'three/tsl';
import type { PlanetSkyRecipe } from '../../../world/planets/sky-schema';
import { resolveSkyPalette } from '../domain/sky-recipe';
import { fbm3, hash31 } from '../../materials/tsl-noise';
import type { MainPostEnvironmentFrame } from './types';

/**
 * Airglow, horizon glow, and the galactic band, added onto sky pixels.
 *
 * Bruneton's solver is physically honest, and physically an overcast-free
 * night with the sun 40 degrees below the horizon is *black* — no airglow, no
 * zodiacal light, no galaxy, because none of those are in the model. That is
 * why the atmosphere alone gives a night sky with nothing in it but stars.
 *
 * This node adds them back as an authored layer. It only ever touches pixels
 * with no geometry behind them (depth == 1), only while the atmosphere's
 * SkyNode owns those pixels, and it fades out with altitude so the orbital
 * view keeps its real black.
 *
 * Cloud attenuation is intentionally omitted while the sky←cloud composite is
 * parked: the cloud-pass clear still reads a≈1 on empty air, which would zero
 * this whole lift and leave a pitch-black night over lit terrain.
 */

const NEBULA_OCTAVES = 3;

export interface MainNightSkyNode {
  node: Node;
  update: (frame: MainPostEnvironmentFrame) => void;
}

export function createMainNightSkyNode(
  inputNode: Node,
  depthNode: Node,
  recipe: PlanetSkyRecipe,
): MainNightSkyNode {
  const palette = resolveSkyPalette(recipe);
  const projectionMatrixInverse = uniform(new THREE.Matrix4());
  const cameraMatrixWorld = uniform(new THREE.Matrix4());
  const planetCenter = uniform(new THREE.Vector3());
  // Clone: the palette is a shared memoized object, and a uniform holds its
  // value by reference.
  const airglowColor = uniform(palette.nightAirglow.clone());
  const horizonColor = uniform(palette.nightHorizon.clone());
  const nebulaColor = uniform(palette.nebula.clone());
  const nebulaAxis = uniform(
    new THREE.Vector3(
      0,
      Math.cos(palette.nebulaTilt),
      Math.sin(palette.nebulaTilt),
    ).normalize(),
  );
  const airglowStrength = uniform(recipe.night.airglowStrength);
  const nebulaStrength = uniform(recipe.night.nebulaStrength);
  const nightFactor = uniform(0);
  const enabled = uniform(0);
  // Dome lift stays modest under AgX so night reads as dark blue, not a
  // lavender wash. Stars get their own brighter scale — sparse points need it.
  const domeLift = uniform(1.35);
  const starLift = uniform(14);
  const starIntensity = uniform(recipe.stars.intensity);

  const node = Fn(() => {
    const output = vec4(inputNode).toVar();
    const strength = nightFactor.mul(enabled).toVar();

    If(strength.greaterThan(0.001).and(float(depthNode).greaterThanEqual(1)), () => {
      // Reconstruct the view ray the same way the fog raymarch does: NDC
      // through the inverse projection, then into world space.
      //
      // `uv()` on three's post quad has v = 0 at the *top* — its uv attribute
      // is flipped against the NDC positions so render-target sampling lines
      // up. Unprojecting it raw mirrors the ray vertically, which pins the
      // horizon band and the galactic band to the screen and makes them swing
      // with camera pitch. three's own `getViewPosition` undoes the flip the
      // same way.
      const screenUv = uv();
      const ndc = vec2(screenUv.x, screenUv.y.oneMinus()).mul(2).sub(1);
      const rayClip = vec4(ndc.x, ndc.y, 1, 1);
      const rayEye = projectionMatrixInverse.mul(rayClip).toVar();
      const rayWorld = cameraMatrixWorld
        .mul(vec4(rayEye.xyz.div(rayEye.w.abs().max(0.00001)), 0))
        .xyz.normalize()
        .toVar();
      const cameraWorld = cameraMatrixWorld[3].xyz.toVar();
      const up = cameraWorld.sub(planetCenter).normalize().toVar();
      const elevation = rayWorld.dot(up).toVar();

      // Airglow sits highest overhead and thins toward the ground. Keep the
      // floor low — a high floor turned the whole dome into twilight haze.
      const zenith = elevation.max(0).toVar();
      const airglow = airglowColor
        .mul(zenith.pow(0.75).mul(0.85).add(0.12))
        .toVar();
      // A tight band hugging the horizon: residual scattered light plus the
      // last of the twilight, which is what makes a night landscape readable.
      const horizonBand = abs(elevation).oneMinus().pow(7).toVar();
      const glow = airglow.add(horizonColor.mul(horizonBand.mul(0.7))).toVar();

      // Galactic band: brightest on the great circle perpendicular to the
      // authored axis, broken up by noise so it is a cloudy river of light and
      // not a painted stripe.
      const bandDistance = abs(rayWorld.dot(nebulaAxis)).toVar();
      // Forward edges then inverted: `smoothstep(hi, lo, x)` is undefined when
      // edge0 > edge1, and silently differs between backends.
      const band = smoothstep(0, 0.42, bandDistance).oneMinus().toVar();
      const clumping = fbm3(rayWorld.mul(5.5), NEBULA_OCTAVES)
        .mul(1.35)
        .add(0.25)
        .toVar();
      const nebula = nebulaColor
        .mul(band.pow(2.2).mul(clumping).mul(nebulaStrength).mul(0.22))
        .mul(smoothstep(-0.15, 0.1, elevation))
        .toVar();

      // Stable celestial grid: one hashed point per direction cell. Continuous
      // fBm on the view ray swam under the threshold every mouse move and read
      // as violent twinkle. Cells are fixed in world direction space, so look
      // only slides stars across the screen.
      //
      // Sub-pixel discs vanish when the camera is still (miss the pixel centre)
      // and flash when it moves. Expand each disc by `fwidth` so it always
      // covers ~1 screen pixel — visible at rest, no swim.
      const starGrid = rayWorld.mul(160).toVar();
      const starCell = floor(starGrid).toVar();
      const starLocal = fract(starGrid).sub(0.5).toVar();
      const starRand = hash31(starCell).toVar();
      const starRandB = hash31(starCell.add(vec3(17.1, 31.7, 47.3))).toVar();
      const starRandC = hash31(starCell.add(vec3(91.2, 12.4, 63.8))).toVar();
      const starCenter = vec3(starRand, starRandB, starRandC)
        .sub(0.5)
        .mul(0.55)
        .toVar();
      const starDist = starLocal.sub(starCenter).length().toVar();
      const starAa = fwidth(starDist).max(0.001).toVar();
      const starRadius = float(0.045)
        .add(starRandB.mul(0.035))
        .add(starAa.mul(0.85))
        .toVar();
      // `smoothstep(hi, lo, x)` is undefined — keep edges ascending.
      const starDisc = float(1)
        .sub(smoothstep(starRadius.sub(starAa), starRadius.add(starAa), starDist))
        .toVar();
      const starPresent = smoothstep(0.978, 0.992, starRand)
        .mul(smoothstep(-0.02, 0.1, elevation))
        .toVar();
      const starBright = float(0.55).add(starRandC.mul(0.7)).toVar();
      const stars = vec3(0.82, 0.88, 1)
        .mul(starDisc.mul(starPresent).mul(starBright).mul(starIntensity).mul(starLift))
        .toVar();

      const dome = glow.mul(airglowStrength).add(nebula).mul(domeLift);
      const lift = mix(vec3(0), dome.add(stars), strength);
      output.assign(vec4(output.rgb.add(lift), output.a));
    });

    return output;
  })();

  return {
    node,
    update(frame) {
      projectionMatrixInverse.value.copy(frame.camera.projectionMatrixInverse);
      cameraMatrixWorld.value.copy(frame.camera.matrixWorld);
      planetCenter.value.copy(frame.planetCenter);
      // Ramps in as the sun drops through civil twilight and is fully on once
      // the atmosphere's own scattering has gone dark.
      const duskRamp = 1 - Math.min(1, Math.max(0, frame.daylightFactor / 0.34));
      const surfaceOnly = 1 - Math.min(1, Math.max(0, frame.spaceFactor / 0.6));
      nightFactor.value = duskRamp * duskRamp * surfaceOnly;
      enabled.value = frame.atmosphereSkyActive ? 1 : 0;
    },
  };
}
