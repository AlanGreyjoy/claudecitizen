import * as THREE from 'three';
import { getActivePlanetConfig } from '../../../world/planets/runtime';
import {
  NEUTRAL_RAYLEIGH_COLOR,
  type PlanetSkyRecipe,
} from '../../../world/planets/sky-schema';

/**
 * Render-side view of the authored sky.
 *
 * The planet document owns hex strings and degrees because that is what an
 * author edits; the renderer needs linear `THREE.Color`s, radians, and
 * Bruneton scattering coefficients. This module is the single conversion
 * point, memoized on the recipe's object identity — `activatePlanetDocument`
 * replaces the whole config object, so identity is an exact staleness check
 * and the per-frame lookup costs one WeakMap hit.
 */

/** Bruneton's Earth coefficients — the physical baseline the recipe scales. */
const BASE_RAYLEIGH_SCATTERING = new THREE.Vector3(5.802e-6, 1.3558e-5, 3.31e-5);
const BASE_MIE_SCATTERING = 3.996e-6;
const BASE_MIE_EXTINCTION = 4.44e-6;

/** Bruneton's top-of-atmosphere solar irradiance, per `AtmosphereParameters`. */
const BASE_SOLAR_IRRADIANCE = new THREE.Vector3(1.474, 1.8504, 1.91198);

/** Reflectance of a thick sunlit cloud top. */
const CLOUD_ALBEDO = 0.75;

function linearColor(hex: string): THREE.Color {
  return new THREE.Color().setStyle(hex, THREE.SRGBColorSpace);
}

/**
 * Linear RGB of the hex that encodes the unmodified Rayleigh coefficients.
 * Authored tints divide through this, so the default color is exactly 1×.
 */
const NEUTRAL_RAYLEIGH_LINEAR = linearColor(NEUTRAL_RAYLEIGH_COLOR);

export interface SkyPalette {
  sun: THREE.Color;
  /**
   * `sun` renormalized to unit luminance.
   *
   * Multiplying the solar spectrum by the raw color would also change how much
   * total energy the star emits, so a merely warm sun would darken the whole
   * planet. Dividing out its luminance keeps the tint and leaves the exposure
   * to `sun.intensity` and `atmosphere.skyBrightness`.
   */
  sunSpectrum: THREE.Vector3;
  moonSurface: THREE.Color;
  moonMaria: THREE.Color;
  moonLight: THREE.Color;
  groundAlbedo: THREE.Color;
  nightAirglow: THREE.Color;
  nightHorizon: THREE.Color;
  nebula: THREE.Color;
  nightAmbientSky: THREE.Color;
  nightAmbientGround: THREE.Color;
  nightFog: THREE.Color;
  cloudLit: THREE.Color;
  cloudShadow: THREE.Color;
  cloudSunset: THREE.Color;
  cloudNight: THREE.Color;
  /**
   * Multiplier that puts the authored cloud colors in the atmosphere's
   * luminance units.
   *
   * The deck used to be composited in the beauty pass, where its near-white
   * `litColor` sat in the same 0..1 artistic range as everything else. It now
   * composites onto `SkyNode`'s output instead, which is physical luminance
   * normalized by `1 / luma(sunRadianceToLuminance)` — so a Lambertian surface
   * of albedo `a` under the solar irradiance `E` lands at `a·luma(E)/π` there,
   * not at `a`.
   *
   * Sanity check on the scale: this gives a sunlit deck ≈ 0.42, and three's
   * Lambert response puts an albedo-0.8 surface facing the scene's
   * intensity-1.75 sun at `1.75·0.8/π` ≈ 0.45. Clouds and terrain agree.
   */
  cloudLuminanceScale: number;
  /**
   * Broadband extinction near sea level, per meter, for the cloud deck's own
   * aerial perspective.
   *
   * The deck no longer writes gameplay depth, so `AerialPerspectiveNode` cannot
   * haze it — a horizon bank 130 km out would otherwise composite at full
   * contrast against a sky that has been correctly hazed around it. Fading the
   * deck's *alpha* along the path reproduces the limit case exactly: as
   * coverage goes to zero the composite converges on pure sky, which is what
   * total inscattering looks like.
   */
  hazeExtinctionPerMeter: number;
  /** Per-channel Rayleigh scattering, in inverse meters. */
  rayleighScattering: THREE.Vector3;
  mieScattering: THREE.Vector3;
  mieExtinction: THREE.Vector3;
  /** Half-angle of the sun disc, in radians. */
  sunAngularRadius: number;
  /** Half-angle of the moon disc, in radians. */
  moonAngularRadius: number;
  /** Orbit-plane tilt of the moon, in radians. */
  moonOrbitTilt: number;
  /** Moon phase offset at t = 0, in radians. */
  moonPhaseOffset: number;
  /** Tilt of the nebula band, in radians. */
  nebulaTilt: number;
}

function buildRayleighScattering(recipe: PlanetSkyRecipe): THREE.Vector3 {
  const tint = linearColor(recipe.atmosphere.rayleighColor);
  const strength = recipe.atmosphere.rayleighStrength;
  return new THREE.Vector3(
    (BASE_RAYLEIGH_SCATTERING.x * tint.r * strength) / NEUTRAL_RAYLEIGH_LINEAR.r,
    (BASE_RAYLEIGH_SCATTERING.y * tint.g * strength) / NEUTRAL_RAYLEIGH_LINEAR.g,
    (BASE_RAYLEIGH_SCATTERING.z * tint.b * strength) / NEUTRAL_RAYLEIGH_LINEAR.b,
  );
}

/** Rec. 709 luminance — the same weighting the tone mapper sees. */
function luminance(value: THREE.Color | THREE.Vector3): number {
  const [r, g, b] =
    value instanceof THREE.Color
      ? [value.r, value.g, value.b]
      : [value.x, value.y, value.z];
  return 0.2126 * r + 0.7152 * g + 0.0722 * b;
}

function buildSunSpectrum(sun: THREE.Color): THREE.Vector3 {
  const sunLuminance = Math.max(luminance(sun), 0.0001);
  return new THREE.Vector3(
    sun.r / sunLuminance,
    sun.g / sunLuminance,
    sun.b / sunLuminance,
  );
}

function buildPalette(recipe: PlanetSkyRecipe): SkyPalette {
  const sun = linearColor(recipe.sun.color);
  const mieTint = linearColor(recipe.atmosphere.mieColor);
  const mieStrength = recipe.atmosphere.mieStrength;
  const scaleMie = (base: number) =>
    new THREE.Vector3(
      base * mieTint.r * mieStrength,
      base * mieTint.g * mieStrength,
      base * mieTint.b * mieStrength,
    );
  const degreesToRadians = Math.PI / 180;
  const rayleighScattering = buildRayleighScattering(recipe);
  const mieExtinction = scaleMie(BASE_MIE_EXTINCTION);
  return {
    sun,
    sunSpectrum: buildSunSpectrum(sun),
    moonSurface: linearColor(recipe.moon.color),
    moonMaria: linearColor(recipe.moon.mariaColor),
    moonLight: linearColor(recipe.moon.lightColor),
    groundAlbedo: linearColor(recipe.atmosphere.groundAlbedo),
    nightAirglow: linearColor(recipe.night.airglowColor),
    nightHorizon: linearColor(recipe.night.horizonColor),
    nebula: linearColor(recipe.night.nebulaColor),
    nightAmbientSky: linearColor(recipe.night.ambientSkyColor),
    nightAmbientGround: linearColor(recipe.night.ambientGroundColor),
    nightFog: linearColor(recipe.night.fogColor),
    cloudLit: linearColor(recipe.clouds.litColor),
    cloudShadow: linearColor(recipe.clouds.shadowColor),
    cloudSunset: linearColor(recipe.clouds.sunsetColor),
    cloudNight: linearColor(recipe.clouds.nightColor),
    // `skyBrightness` scales `luminanceScale` on the atmosphere parameters, so
    // the deck has to ride the same trim or it drifts off the sky it sits on.
    cloudLuminanceScale:
      (luminance(BASE_SOLAR_IRRADIANCE) * CLOUD_ALBEDO * recipe.atmosphere.skyBrightness) /
      Math.PI,
    hazeExtinctionPerMeter:
      luminance(rayleighScattering) + luminance(mieExtinction),
    rayleighScattering,
    mieScattering: scaleMie(BASE_MIE_SCATTERING),
    mieExtinction,
    sunAngularRadius: recipe.sun.angularDiameterDegrees * 0.5 * degreesToRadians,
    moonAngularRadius:
      recipe.moon.angularDiameterDegrees * 0.5 * degreesToRadians,
    moonOrbitTilt: recipe.moon.orbitTiltDegrees * degreesToRadians,
    moonPhaseOffset: recipe.moon.phaseOffsetDegrees * degreesToRadians,
    nebulaTilt: recipe.night.nebulaTiltDegrees * degreesToRadians,
  };
}

const paletteCache = new WeakMap<PlanetSkyRecipe, SkyPalette>();

/** The active planet's authored sky block. */
export function resolveSkyRecipe(): PlanetSkyRecipe {
  return getActivePlanetConfig().sky;
}

/** Linear colors and radians derived from `recipe`, cached per recipe object. */
export function resolveSkyPalette(recipe: PlanetSkyRecipe): SkyPalette {
  const cached = paletteCache.get(recipe);
  if (cached) return cached;
  const palette = buildPalette(recipe);
  paletteCache.set(recipe, palette);
  return palette;
}
