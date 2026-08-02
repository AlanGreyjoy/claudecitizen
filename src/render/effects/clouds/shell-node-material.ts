import * as THREE from 'three';
import { NodeMaterial } from 'three/webgpu';
import {
  Fn,
  cameraProjectionMatrix,
  cameraViewMatrix,
  clamp,
  cos,
  exp,
  float,
  max,
  mix,
  modelWorldMatrix,
  positionGeometry,
  sin,
  smoothstep,
  sqrt,
  uniform,
  vec3,
  vec4,
} from 'three/tsl';
import { fbm3 } from '../../materials/tsl-noise';
import type { CloudShellMaterialFactory } from './shell';

/**
 * Lit cloud deck.
 *
 * Two things make this read as sky rather than as a texture:
 *
 * 1. **Shape.** Coverage is domain-warped fBm, not a sum of sine waves. Sines
 *    tile visibly and produce the regular quilted banding the old deck had;
 *    warping the sample point by a second noise field is what gives banks
 *    their torn, wind-sheared edges.
 * 2. **Light.** The deck responds to the sun. Thin edges transmit and go
 *    bright, thick cores self-shadow and go blue-grey, looking toward the sun
 *    lights a silver rim, a low sun washes the lit side with the authored
 *    sunset color, and at night the whole deck falls to the night color plus
 *    whatever the moon gives back. The old deck was a constant near-white in
 *    every one of those conditions, which is what made midday look flat and
 *    sunsets look wrong.
 *
 * Coverage is sampled from the planet-fixed direction so banks stay over their
 * geography; see `shell.ts`.
 */

const WARP_OCTAVES = 2;

/**
 * Diameter of a base-octave cloud cell at `layer.scale === 1`.
 *
 * Coverage is sampled from a *unit* direction, so the frequency has to be
 * derived from the planet's radius or the field's metric size changes with the
 * world. The old deck sampled `direction * 1` — roughly one cell per planet,
 * which across the ~130 km of visible sky is a single smooth gradient.
 *
 * Judge this against the *layer altitude*, not against the horizon distance:
 * perspective is brutal overhead, where a cell of size D on a deck at altitude
 * h subtends `2·atan(D/2h)`. At a 1.4 km deck, a 12 km cell covers ~80 degrees
 * of sky — one cloud, horizon to horizon. 3 km lands a base cell near category
 * cumulus, and the detail octaves break it up from there.
 */
const CLOUD_CELL_METERS = 3_000;

/**
 * Standard deviation of `fbm3`'s 0..1 output.
 *
 * A sum of value-noise octaves is not uniform — it piles up around 0.5 and only
 * ever reaches about ±0.27 at the extremes. Both authored knobs are compared
 * against that field, so without a stretch `coverage` and `sharpness` each
 * operate inside a ~0.09-wide slice of their nominal 0..1 range: coverage 0.46
 * clouded far less than half the sky, and any sharpness past ~0.3 washed the
 * whole dome into one translucent veil that never reached an opaque core.
 */
const COVERAGE_FIELD_SPREAD = 0.09;

/** Maps ±2.5σ of the raw field onto 0..1, so both knobs mean what they say. */
const COVERAGE_CONTRAST = 1 / (2.5 * COVERAGE_FIELD_SPREAD);

/**
 * Optical depth of a fully dense deck viewed straight up.
 *
 * Alpha is Beer–Lambert rather than the density value itself: a linear alpha
 * ramp puts the visible silhouette wherever the discard threshold happens to
 * cut, which is what gave the deck its torn-paper edges. An exponential rolls
 * off asymptotically, so the edge is where the cloud thins, not where the
 * shader stops drawing.
 */
const CLOUD_OPTICAL_DEPTH = 3.2;

/** Longest slant path through the sheet, as a multiple of the vertical one. */
const MAX_SLANT_PATH = 4;

export const createWebGpuCloudShellMaterial: CloudShellMaterialFactory = ({
  cameraSimPosition,
  invRenderScale,
  phase,
  layer,
  clouds,
  luminanceScale,
  hazeExtinctionPerMeter,
  planetRadiusMeters,
}) => {
  const uniforms = {
    cameraSimPosition: uniform(cameraSimPosition),
    renderScale: uniform(1 / invRenderScale),
    luminanceScale: uniform(luminanceScale),
    hazeExtinction: uniform(hazeExtinctionPerMeter),
    shellRadius: uniform(planetRadiusMeters + layer.altitudeMeters),
    driftAngle: uniform(0),
    frequency: uniform(
      (planetRadiusMeters * layer.scale) / CLOUD_CELL_METERS,
    ),
    phase: uniform(phase),
    opacity: uniform(0),
    coverage: uniform(layer.coverage),
    sharpness: uniform(clouds.sharpness),
    silverLining: uniform(clouds.silverLining),
    sunDirection: uniform(new THREE.Vector3(0, 1, 0)),
    moonDirection: uniform(new THREE.Vector3(0, -1, 0)),
    daylightFactor: uniform(1),
    moonlight: uniform(0),
    litColor: uniform(
      new THREE.Color().setStyle(clouds.litColor, THREE.SRGBColorSpace),
    ),
    shadowColor: uniform(
      new THREE.Color().setStyle(clouds.shadowColor, THREE.SRGBColorSpace),
    ),
    sunsetColor: uniform(
      new THREE.Color().setStyle(clouds.sunsetColor, THREE.SRGBColorSpace),
    ),
    nightColor: uniform(
      new THREE.Color().setStyle(clouds.nightColor, THREE.SRGBColorSpace),
    ),
  };

  /**
   * Domain-warped fBm coverage in 0..1.
   *
   * The warp offset is deliberately large (0.55 of a cell): a subtle warp just
   * blurs the field, while this much shears whole banks sideways and is what
   * produces long streaks instead of round blobs.
   */
  const cloudCoverage = Fn(([direction]: [ReturnType<typeof vec3>]) => {
    const p = direction.mul(uniforms.frequency).toVar();
    const drift = vec3(uniforms.phase, uniforms.phase.mul(0.37), 0);
    const warp = vec3(
      fbm3(p.add(vec3(11.3, 4.7, 2.1)).add(drift), WARP_OCTAVES),
      fbm3(p.add(vec3(2.9, 17.5, 8.3)).add(drift), WARP_OCTAVES),
      fbm3(p.add(vec3(7.1, 3.3, 21.7)).add(drift), WARP_OCTAVES),
    )
      .sub(0.5)
      .mul(1.1)
      .toVar();
    // Stretched to a usable dynamic range; see `COVERAGE_FIELD_SPREAD`.
    return clamp(
      fbm3(p.add(warp).add(drift), clouds.detail)
        .sub(0.5)
        .mul(COVERAGE_CONTRAST)
        .add(0.5),
      0,
      1,
    );
  });

  /**
   * Distance in simulation meters from the camera to this layer's shell along
   * `direction`, or a negative sentinel where the ray misses it.
   *
   * The dome sphere is only a direction carrier. Rendering it at its authored
   * radius would put every cloud the same distance away, which is wrong twice
   * over: the deck overhead is ~1.4 km up while the deck at the horizon is
   * ~130 km out, and it is that distance which drives how much aerial
   * perspective the atmosphere pass adds. Solving the ray/shell intersection
   * gives real distances, real parallax as the player travels, and correct haze
   * for free.
   */
  const shellDistance = Fn(([direction]: [ReturnType<typeof vec3>]) => {
    const cameraRadius = uniforms.cameraSimPosition.length().toVar();
    const up = uniforms.cameraSimPosition.div(cameraRadius.max(0.0001)).toVar();
    const cosElevation = direction.dot(up).toVar();
    const along = cameraRadius.mul(cosElevation).negate().toVar();
    const discriminant = uniforms.shellRadius
      .pow2()
      .sub(cameraRadius.pow2().mul(cosElevation.pow2().oneMinus()))
      .toVar();
    const root = sqrt(discriminant.max(0)).toVar();
    // Below the deck the far root is the underside overhead; above it, the
    // near root is the top surface seen looking down.
    const below = cameraRadius.lessThan(uniforms.shellRadius).toVar();
    const distance = below.select(along.add(root), along.sub(root)).toVar();
    const valid = below.or(discriminant.greaterThan(0)).and(
      distance.greaterThan(0),
    );
    return valid.select(distance, float(-1));
  });

  /**
   * Interpolated dome direction, renormalized per fragment.
   *
   * Only the *direction* may cross the rasterizer. Interpolating the solved
   * shell position instead — which is what this did — is a straight chord
   * through a curve whose length changes ninefold across a single 5.6-degree
   * latitude band near the horizon, so the reconstructed sample point drifted
   * tens of cloud cells off the shell mid-triangle and the noise field showed
   * the dome's own triangulation as long straight-edged shards. Re-solving the
   * intersection below from this direction costs a handful of ALU and is exact
   * everywhere.
   */
  const domeDirection = positionGeometry
    .normalize()
    .toVarying('cloudDomeDirection');

  const vertex = Fn(() => {
    const direction = positionGeometry.normalize().toVar();
    const distance = shellDistance(direction).toVar();
    // Looking up from above the deck never hits it. Park those vertices behind
    // the camera so they clip instead of stretching across the sky; the
    // altitude fade in `shell.ts` has already begun taking the layer out.
    const scenePosition = direction.mul(
      distance
        .greaterThan(0)
        .select(distance.mul(uniforms.renderScale), float(-0.001)),
    );
    return cameraProjectionMatrix
      .mul(cameraViewMatrix)
      .mul(modelWorldMatrix)
      .mul(vec4(scenePosition, 1));
  })();

  const fragment = Fn(() => {
    const viewDirection = domeDirection.normalize().toVar();
    const distance = shellDistance(viewDirection).toVar();
    distance.lessThan(0).discard();
    const cameraRadius = uniforms.cameraSimPosition.length().toVar();
    const cameraUp = uniforms.cameraSimPosition
      .div(cameraRadius.max(0.0001))
      .toVar();
    // Grazing angle against the deck, measured from whichever side the camera
    // is on — looking down at a deck from above has to fade at its horizon too,
    // or flying over the weather shows a hard-edged disc.
    const grazing = cameraRadius
      .lessThan(uniforms.shellRadius)
      .select(viewDirection.dot(cameraUp), viewDirection.dot(cameraUp).negate())
      .toVar();
    // Soften into the horizon ring so the deck edge doesn't read as a hard cut.
    const elevationFade = smoothstep(0.015, 0.13, grazing).toVar();

    const simulationPosition = uniforms.cameraSimPosition
      .add(viewDirection.mul(distance))
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
    // The stretched field is centred on 0.5 and spans 0..1, so `1 - coverage`
    // as the threshold means coverage 0.46 really does cloud about 46% of the
    // sky. Sharpness is the width of the ramp above it in the same units —
    // wispy cirrus at 0.6, hard-edged cumulus at 0.1.
    const threshold = uniforms.coverage.oneMinus().toVar();
    const density = clamp(
      coverage.sub(threshold).div(uniforms.sharpness.max(0.02)),
      0,
      1,
    ).toVar();
    // Looking along the deck crosses far more of it than looking through it,
    // which is why a real overcast piles up into a solid lid at the horizon
    // while the same cover overhead still shows gaps.
    const slantPath = float(1)
      .div(max(grazing.abs(), 1 / MAX_SLANT_PATH))
      .toVar();
    const opticalDepth = density
      .mul(slantPath)
      .mul(CLOUD_OPTICAL_DEPTH)
      .toVar();
    // Transmission through the sheet. Doubles as the shading term below: thin
    // edges transmit and stay bright, thick cores go opaque and self-shadow.
    const throughput = exp(opticalDepth.negate()).toVar();
    // Aerial perspective, applied to coverage rather than colour. See
    // `SkyPalette.hazeExtinctionPerMeter` — the deck is composited inside the
    // sky, so dissolving it is what "hazed into the distance" means here.
    const aerial = exp(distance.mul(uniforms.hazeExtinction).negate()).toVar();
    const alpha = throughput
      .oneMinus()
      .mul(elevationFade)
      .mul(aerial)
      .mul(uniforms.opacity)
      .toVar();
    // Low enough that the cut lands where the exponential has already faded
    // out, so the discard contour is never the visible silhouette.
    alpha.lessThan(0.006).discard();

    // --- shading -----------------------------------------------------------
    const sunElevation = uniforms.sunDirection.dot(cameraUp).toVar();
    const towardSun = max(viewDirection.dot(uniforms.sunDirection), 0).toVar();
    const towardMoon = max(viewDirection.dot(uniforms.moonDirection), 0).toVar();

    // The lit floor is high on purpose — a sunlit cumulus top is near-white,
    // and only its underside goes grey, so biasing all the way to `shadowColor`
    // at full density reads as smog rather than as cloud.
    const dayColor = mix(
      uniforms.shadowColor,
      uniforms.litColor,
      throughput.mul(0.5).add(0.5),
    ).toVar();
    // A low sun reddens what it still reaches, and only the lit fraction. Both
    // edges run low-to-high: `smoothstep(hi, lo, x)` is undefined when
    // edge0 > edge1, so the falling edge is written as an inverted rise.
    const sunsetAmount = smoothstep(-0.02, 0.28, sunElevation)
      .oneMinus()
      .mul(smoothstep(-0.14, 0.06, sunElevation))
      .toVar();
    dayColor.assign(
      mix(dayColor, uniforms.sunsetColor, sunsetAmount.mul(throughput.mul(0.85).add(0.15))),
    );
    // Forward scatter: the rim you see when a cloud passes in front of the sun.
    const rim = towardSun
      .pow(14)
      .mul(uniforms.silverLining)
      .mul(throughput)
      .toVar();
    dayColor.addAssign(uniforms.litColor.mul(rim));

    // How much sunlight actually lands on the deck. A Lambertian top scales
    // with the cosine of the sun's zenith angle, so a 10-degree sun delivers a
    // sixth of what a noon sun does; without this the deck stayed at full
    // midday brightness right up to the moment it snapped to `nightColor`.
    dayColor.mulAssign(smoothstep(-0.09, 0.25, sunElevation).mul(0.86).add(0.14));

    const nightBase = mix(
      uniforms.nightColor,
      uniforms.litColor,
      uniforms.moonlight.mul(towardMoon.pow(6).mul(0.5).add(0.18)),
    ).toVar();

    const color = mix(
      nightBase,
      dayColor,
      smoothstep(0, 0.35, uniforms.daylightFactor),
    ).toVar();
    // Into the atmosphere's luminance units; see `SkyPalette.cloudLuminanceScale`.
    color.mulAssign(uniforms.luminanceScale);

    // Night decks stay translucent: an opaque black lid would hide the stars
    // and the moon the sky pass just went to the trouble of drawing.
    const nightTransparency = mix(
      float(0.62),
      float(1),
      smoothstep(0, 0.3, uniforms.daylightFactor),
    );

    return vec4(color, alpha.mul(nightTransparency));
  })();

  const material = new NodeMaterial();
  material.vertexNode = vertex;
  // outputNode keeps this compatible with the gameplay scene's MRT pass; see
  // the note in lake_water/render/node-material.ts.
  material.outputNode = fragment;
  // The deck renders into its own pass (`cloud-deck` in the post stack) and is
  // composited into `SkyNode`, so it neither tests nor writes the gameplay
  // depth buffer. It used to do both, and that was the single worst thing about
  // the daytime sky: `AerialPerspectiveNode` only paints sky where depth is
  // still 1, so *every* cloud pixel — down to a five-percent-alpha wisp —
  // suppressed the solved sky in favour of the flat `SKY_LOW_COLOR` fallback,
  // and then took a full volumetric-fog raymarch that the clear sky next to it
  // skipped. Terrain occlusion is not lost by dropping the depth test: the
  // composite only runs where the gameplay depth is 1, which is exactly where
  // nothing is in front of the deck.
  material.depthWrite = false;
  material.depthTest = false;
  material.side = THREE.BackSide;
  material.transparent = true;
  // Premultiplied over-blend against a transparent-black clear, so the pass
  // accumulates `Σ colorᵢ·αᵢ` in rgb and true coverage in alpha across layers.
  // Plain `NormalBlending` squares the source alpha into the alpha channel
  // (`srcA·srcA + dstA·(1-srcA)`), which would under-report coverage and let
  // the sky bleed through solid overcast.
  material.blending = THREE.CustomBlending;
  material.blendSrc = THREE.SrcAlphaFactor;
  material.blendDst = THREE.OneMinusSrcAlphaFactor;
  material.blendSrcAlpha = THREE.OneFactor;
  material.blendDstAlpha = THREE.OneMinusSrcAlphaFactor;
  material.fog = false;

  return {
    material,
    setDriftAngle(value) {
      uniforms.driftAngle.value = value;
    },
    setOpacity(value) {
      uniforms.opacity.value = value;
    },
    setLighting(lighting) {
      uniforms.sunDirection.value.copy(lighting.sunDirection);
      uniforms.moonDirection.value.copy(lighting.moonDirection);
      uniforms.daylightFactor.value = lighting.daylightFactor;
      uniforms.moonlight.value = lighting.moonlight;
    },
    setShape(nextLayer, nextClouds) {
      uniforms.coverage.value = nextLayer.coverage;
      uniforms.frequency.value =
        (planetRadiusMeters * nextLayer.scale) / CLOUD_CELL_METERS;
      uniforms.shellRadius.value =
        planetRadiusMeters + nextLayer.altitudeMeters;
      uniforms.sharpness.value = nextClouds.sharpness;
      uniforms.silverLining.value = nextClouds.silverLining;
      uniforms.litColor.value.setStyle(
        nextClouds.litColor,
        THREE.SRGBColorSpace,
      );
      uniforms.shadowColor.value.setStyle(
        nextClouds.shadowColor,
        THREE.SRGBColorSpace,
      );
      uniforms.sunsetColor.value.setStyle(
        nextClouds.sunsetColor,
        THREE.SRGBColorSpace,
      );
      uniforms.nightColor.value.setStyle(
        nextClouds.nightColor,
        THREE.SRGBColorSpace,
      );
    },
    dispose() {
      material.dispose();
    },
  };
};
