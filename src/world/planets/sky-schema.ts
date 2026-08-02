import {
  readBoolean,
  readClampedNumber,
  readHexColor,
  readNumber,
  readRecord,
} from './read-values';

/**
 * Authorable sky: the day/night cycle, scattering, sun, moon, stars, clouds,
 * and the night palette.
 *
 * This is the presentation half of a planet document — nothing here feeds
 * terrain generation, so editing it never invalidates a terrain or vegetation
 * cache (`terrainFingerprint` deliberately hashes only biomes + probed
 * heights).
 *
 * The defaults are the engine's "beautiful Earth" preset. Fantasy worlds are
 * meant to move off them: a wide amber sun, a violet 6-degree moon, a dense
 * teal atmosphere, and a bright nebula band are all reachable from the Planet
 * Authoring panel without touching code.
 */

export interface PlanetAtmosphereRecipe {
  /**
   * Per-channel Rayleigh scattering tint. This is the sky's hue: the default
   * is the sRGB encoding of Bruneton's Earth coefficients, so leaving it alone
   * reproduces the physical model exactly.
   */
  rayleighColor: string;
  /** Scales Rayleigh density — higher is a deeper, more saturated sky. */
  rayleighStrength: number;
  /** Aerosol tint. Drives haze color near the horizon and around the sun. */
  mieColor: string;
  /** Aerosol density — higher is hazier, with a wider glow around the sun. */
  mieStrength: number;
  /** Mie phase asymmetry (0..0.95). Higher pushes light forward into a halo. */
  mieAnisotropy: number;
  /** Bounce color from the ground back into the atmosphere. */
  groundAlbedo: string;
  /** Overall sky luminance multiplier. */
  skyBrightness: number;
}

export interface PlanetSunRecipe {
  /** Directional light color and solar irradiance tint. */
  color: string;
  /** Directional light intensity at local noon. */
  intensity: number;
  /** Apparent size of the sun disc. Sol is 0.53 from Earth. */
  angularDiameterDegrees: number;
  /** Brightness of the disc itself, independent of the light it casts. */
  discBrightness: number;
}

export interface PlanetMoonRecipe {
  enabled: boolean;
  /** Highland (bright terrain) albedo tint. */
  color: string;
  /** Mare (dark plains) tint. Blended in by the procedural surface map. */
  mariaColor: string;
  /** Apparent size of the moon disc. Luna is 0.52 from Earth. */
  angularDiameterDegrees: number;
  /** Disc brightness multiplier. */
  brightness: number;
  /**
   * Days for the moon to cycle back to the same phase. 1 pins it opposite the
   * sun (permanent full moon at midnight); larger values walk it through
   * crescents. One "day" is `dayLengthSeconds`.
   */
  synodicPeriodDays: number;
  /** Phase at t=0, in degrees. 0 is full, 180 is new. */
  phaseOffsetDegrees: number;
  /** Tilt of the orbit plane against the equator. */
  orbitTiltDegrees: number;
  /** Moonlight color for the shadow-casting night directional light. */
  lightColor: string;
  /** Moonlight intensity at zenith on a full moon. */
  lightIntensity: number;
  /** 0 = smooth disc, 1 = heavily cratered. */
  crateredness: number;
  /** Fraction of the surface covered by dark maria. */
  mariaCoverage: number;
  /** Varies the procedural surface map without touching the planet seed. */
  surfaceSeed: number;
}

export interface PlanetStarsRecipe {
  /** Star field brightness at full night. */
  intensity: number;
  /** Point size in pixels before pixel-ratio scaling. */
  pointSize: number;
  /** Brightest visible magnitude — lower shows fewer, brighter stars. */
  magnitudeMin: number;
  /** Faintest visible magnitude — higher shows a denser field. */
  magnitudeMax: number;
}

export interface PlanetNightRecipe {
  /** Zenith airglow. Lifts the sky off pure black once the sun has set. */
  airglowColor: string;
  airglowStrength: number;
  /** Residual glow ringing the horizon at night. */
  horizonColor: string;
  /** Galactic band color. The fantasy knob — set strength to 0 for realism. */
  nebulaColor: string;
  nebulaStrength: number;
  /** Tilt of the nebula band against the equator. */
  nebulaTiltDegrees: number;
  /** Hemisphere-light sky color at night. */
  ambientSkyColor: string;
  /** Hemisphere-light ground bounce at night. */
  ambientGroundColor: string;
  /** Floor under the night ambient so terrain never reads as pure black. */
  ambientIntensity: number;
  /** Distance fog color at night. */
  fogColor: string;
}

export interface PlanetCloudLayerRecipe {
  altitudeMeters: number;
  /** 0 = clear sky, 1 = overcast. */
  coverage: number;
  opacity: number;
  /** Noise frequency. Higher is smaller, busier cells. */
  scale: number;
  /**
   * Wind speed along the deck, in meters per second. Negative blows the other
   * way, which is how you get high cloud shearing against low cloud.
   *
   * Metric, not angular, on purpose: the renderer divides by the shell radius
   * to get a rotation rate, so the same value reads the same on any planet.
   * For reference, a brisk day is ~12 and the jet stream tops out near 100.
   */
  windMetersPerSecond: number;
}

export interface PlanetCloudsRecipe {
  enabled: boolean;
  layers: PlanetCloudLayerRecipe[];
  /**
   * Width of the density ramp above the coverage threshold, in the same 0..1
   * units as `coverage`. **Low is crisp, high is soft** — ~0.1 is hard-edged
   * cumulus, ~0.6 is cirrus. The renderer contrast-stretches the coverage
   * field first, so the whole range is usable.
   */
  sharpness: number;
  /** Octaves of detail noise folded onto the base coverage. */
  detail: number;
  /** Sunlit top color. */
  litColor: string;
  /** Self-shadowed underside color. */
  shadowColor: string;
  /** Tint applied to lit edges as the sun approaches the horizon. */
  sunsetColor: string;
  /** Color the deck falls to at night, before moonlight. */
  nightColor: string;
  /** Forward-scatter rim brightness when looking toward the sun. */
  silverLining: number;
}

export interface PlanetSkyRecipe {
  /** Full sun cycle (day + night) in seconds. */
  dayLengthSeconds: number;
  atmosphere: PlanetAtmosphereRecipe;
  sun: PlanetSunRecipe;
  moon: PlanetMoonRecipe;
  stars: PlanetStarsRecipe;
  clouds: PlanetCloudsRecipe;
  night: PlanetNightRecipe;
}

/**
 * sRGB encoding of Bruneton's Rayleigh coefficients (5.802e-6, 1.3558e-5,
 * 3.31e-5). The render layer divides the authored color by this one, so
 * leaving the field untouched multiplies the physical defaults by exactly 1.
 */
export const NEUTRAL_RAYLEIGH_COLOR = '#75acff';

export const DEFAULT_ATMOSPHERE_RECIPE: PlanetAtmosphereRecipe = Object.freeze({
  rayleighColor: NEUTRAL_RAYLEIGH_COLOR,
  rayleighStrength: 1,
  mieColor: '#ffffff',
  mieStrength: 1,
  mieAnisotropy: 0.8,
  groundAlbedo: '#56704b',
  skyBrightness: 1,
});

export const DEFAULT_SUN_RECIPE: PlanetSunRecipe = Object.freeze({
  // A star's color drives both its light and the sky's hue, so the default is
  // a near-white sun. Strongly tinted values are a deliberate world choice —
  // an amber star gives an amber sky, not a blue sky with an amber dot.
  color: '#fff4e8',
  intensity: 1.75,
  angularDiameterDegrees: 0.53,
  discBrightness: 1,
});

export const DEFAULT_MOON_RECIPE: PlanetMoonRecipe = Object.freeze({
  enabled: true,
  color: '#d8d4cc',
  mariaColor: '#6a6f80',
  // Larger than Luna on purpose: a 1.6-degree moon reads as a moon on screen
  // instead of a bright dot, and this is a fantasy sim.
  angularDiameterDegrees: 1.6,
  brightness: 1.1,
  synodicPeriodDays: 6,
  phaseOffsetDegrees: 25,
  orbitTiltDegrees: 15,
  lightColor: '#8ba3d9',
  lightIntensity: 0.75,
  crateredness: 0.55,
  mariaCoverage: 0.35,
  surfaceSeed: 1337,
});

export const DEFAULT_STARS_RECIPE: PlanetStarsRecipe = Object.freeze({
  intensity: 1,
  pointSize: 1.6,
  magnitudeMin: -1.5,
  magnitudeMax: 6.5,
});

export const DEFAULT_NIGHT_RECIPE: PlanetNightRecipe = Object.freeze({
  airglowColor: '#16244d',
  airglowStrength: 1,
  horizonColor: '#243a63',
  nebulaColor: '#6d5ba8',
  nebulaStrength: 0.55,
  nebulaTiltDegrees: 32,
  ambientSkyColor: '#6e86bd',
  ambientGroundColor: '#1f2740',
  ambientIntensity: 0.34,
  fogColor: '#0b1526',
});

export const DEFAULT_CLOUDS_RECIPE: PlanetCloudsRecipe = Object.freeze({
  enabled: true,
  layers: Object.freeze([
    Object.freeze({
      altitudeMeters: 1_400,
      coverage: 0.46,
      opacity: 0.9,
      scale: 1,
      windMetersPerSecond: 11,
    }),
    Object.freeze({
      altitudeMeters: 5_200,
      coverage: 0.32,
      opacity: 0.45,
      scale: 2.1,
      windMetersPerSecond: -26,
    }),
  ]) as unknown as PlanetCloudLayerRecipe[],
  sharpness: 0.12,
  detail: 4,
  litColor: '#fbfaf6',
  shadowColor: '#9aa9bf',
  sunsetColor: '#ffb27a',
  nightColor: '#2b3550',
  silverLining: 0.7,
});

export const DEFAULT_DAY_LENGTH_SECONDS = 3600;

function readAtmosphere(raw: unknown): PlanetAtmosphereRecipe {
  const src = readRecord(raw);
  return {
    rayleighColor: readHexColor(
      src.rayleighColor,
      DEFAULT_ATMOSPHERE_RECIPE.rayleighColor,
    ),
    rayleighStrength: readClampedNumber(
      src.rayleighStrength,
      DEFAULT_ATMOSPHERE_RECIPE.rayleighStrength,
      0,
      8,
    ),
    mieColor: readHexColor(src.mieColor, DEFAULT_ATMOSPHERE_RECIPE.mieColor),
    mieStrength: readClampedNumber(
      src.mieStrength,
      DEFAULT_ATMOSPHERE_RECIPE.mieStrength,
      0,
      12,
    ),
    mieAnisotropy: readClampedNumber(
      src.mieAnisotropy,
      DEFAULT_ATMOSPHERE_RECIPE.mieAnisotropy,
      0,
      0.95,
    ),
    groundAlbedo: readHexColor(
      src.groundAlbedo,
      DEFAULT_ATMOSPHERE_RECIPE.groundAlbedo,
    ),
    skyBrightness: readClampedNumber(
      src.skyBrightness,
      DEFAULT_ATMOSPHERE_RECIPE.skyBrightness,
      0.05,
      8,
    ),
  };
}

function readSun(raw: unknown): PlanetSunRecipe {
  const src = readRecord(raw);
  return {
    color: readHexColor(src.color, DEFAULT_SUN_RECIPE.color),
    intensity: readClampedNumber(
      src.intensity,
      DEFAULT_SUN_RECIPE.intensity,
      0,
      16,
    ),
    angularDiameterDegrees: readClampedNumber(
      src.angularDiameterDegrees,
      DEFAULT_SUN_RECIPE.angularDiameterDegrees,
      0.02,
      30,
    ),
    discBrightness: readClampedNumber(
      src.discBrightness,
      DEFAULT_SUN_RECIPE.discBrightness,
      0,
      16,
    ),
  };
}

function readMoon(raw: unknown): PlanetMoonRecipe {
  const src = readRecord(raw);
  return {
    enabled: readBoolean(src.enabled, DEFAULT_MOON_RECIPE.enabled),
    color: readHexColor(src.color, DEFAULT_MOON_RECIPE.color),
    mariaColor: readHexColor(src.mariaColor, DEFAULT_MOON_RECIPE.mariaColor),
    angularDiameterDegrees: readClampedNumber(
      src.angularDiameterDegrees,
      DEFAULT_MOON_RECIPE.angularDiameterDegrees,
      0.05,
      45,
    ),
    brightness: readClampedNumber(
      src.brightness,
      DEFAULT_MOON_RECIPE.brightness,
      0,
      16,
    ),
    // A zero period would divide by zero in the phase term.
    synodicPeriodDays: Math.max(
      0.05,
      readNumber(src.synodicPeriodDays, DEFAULT_MOON_RECIPE.synodicPeriodDays),
    ),
    phaseOffsetDegrees: readNumber(
      src.phaseOffsetDegrees,
      DEFAULT_MOON_RECIPE.phaseOffsetDegrees,
    ),
    orbitTiltDegrees: readClampedNumber(
      src.orbitTiltDegrees,
      DEFAULT_MOON_RECIPE.orbitTiltDegrees,
      -89,
      89,
    ),
    lightColor: readHexColor(src.lightColor, DEFAULT_MOON_RECIPE.lightColor),
    lightIntensity: readClampedNumber(
      src.lightIntensity,
      DEFAULT_MOON_RECIPE.lightIntensity,
      0,
      8,
    ),
    crateredness: readClampedNumber(
      src.crateredness,
      DEFAULT_MOON_RECIPE.crateredness,
      0,
      1,
    ),
    mariaCoverage: readClampedNumber(
      src.mariaCoverage,
      DEFAULT_MOON_RECIPE.mariaCoverage,
      0,
      1,
    ),
    surfaceSeed: Math.round(
      readNumber(src.surfaceSeed, DEFAULT_MOON_RECIPE.surfaceSeed),
    ),
  };
}

function readStars(raw: unknown): PlanetStarsRecipe {
  const src = readRecord(raw);
  const magnitudeMin = readClampedNumber(
    src.magnitudeMin,
    DEFAULT_STARS_RECIPE.magnitudeMin,
    -10,
    10,
  );
  const magnitudeMax = readClampedNumber(
    src.magnitudeMax,
    DEFAULT_STARS_RECIPE.magnitudeMax,
    -10,
    12,
  );
  return {
    intensity: readClampedNumber(
      src.intensity,
      DEFAULT_STARS_RECIPE.intensity,
      0,
      8,
    ),
    pointSize: readClampedNumber(
      src.pointSize,
      DEFAULT_STARS_RECIPE.pointSize,
      0.25,
      8,
    ),
    magnitudeMin: Math.min(magnitudeMin, magnitudeMax),
    magnitudeMax: Math.max(magnitudeMin, magnitudeMax),
  };
}

function readNight(raw: unknown): PlanetNightRecipe {
  const src = readRecord(raw);
  return {
    airglowColor: readHexColor(
      src.airglowColor,
      DEFAULT_NIGHT_RECIPE.airglowColor,
    ),
    airglowStrength: readClampedNumber(
      src.airglowStrength,
      DEFAULT_NIGHT_RECIPE.airglowStrength,
      0,
      8,
    ),
    horizonColor: readHexColor(
      src.horizonColor,
      DEFAULT_NIGHT_RECIPE.horizonColor,
    ),
    nebulaColor: readHexColor(
      src.nebulaColor,
      DEFAULT_NIGHT_RECIPE.nebulaColor,
    ),
    nebulaStrength: readClampedNumber(
      src.nebulaStrength,
      DEFAULT_NIGHT_RECIPE.nebulaStrength,
      0,
      4,
    ),
    nebulaTiltDegrees: readNumber(
      src.nebulaTiltDegrees,
      DEFAULT_NIGHT_RECIPE.nebulaTiltDegrees,
    ),
    ambientSkyColor: readHexColor(
      src.ambientSkyColor,
      DEFAULT_NIGHT_RECIPE.ambientSkyColor,
    ),
    ambientGroundColor: readHexColor(
      src.ambientGroundColor,
      DEFAULT_NIGHT_RECIPE.ambientGroundColor,
    ),
    ambientIntensity: readClampedNumber(
      src.ambientIntensity,
      DEFAULT_NIGHT_RECIPE.ambientIntensity,
      0,
      4,
    ),
    fogColor: readHexColor(src.fogColor, DEFAULT_NIGHT_RECIPE.fogColor),
  };
}

function readCloudLayer(
  raw: unknown,
  fallback: PlanetCloudLayerRecipe,
): PlanetCloudLayerRecipe {
  const src = readRecord(raw);
  return {
    altitudeMeters: readClampedNumber(
      src.altitudeMeters,
      fallback.altitudeMeters,
      0,
      80_000,
    ),
    coverage: readClampedNumber(src.coverage, fallback.coverage, 0, 1),
    opacity: readClampedNumber(src.opacity, fallback.opacity, 0, 1),
    scale: readClampedNumber(src.scale, fallback.scale, 0.05, 32),
    windMetersPerSecond: readClampedNumber(
      src.windMetersPerSecond,
      fallback.windMetersPerSecond,
      -400,
      400,
    ),
  };
}

/** Layers are capped at 4 — each one is a full-sky transparent dome pass. */
export const MAX_CLOUD_LAYERS = 4;

function readCloudLayers(raw: unknown): PlanetCloudLayerRecipe[] {
  const defaults = DEFAULT_CLOUDS_RECIPE.layers;
  if (!Array.isArray(raw)) return defaults.map((layer) => ({ ...layer }));
  return raw
    .slice(0, MAX_CLOUD_LAYERS)
    .map((entry, index) =>
      readCloudLayer(entry, defaults[index] ?? defaults[defaults.length - 1]),
    );
}

function readClouds(raw: unknown): PlanetCloudsRecipe {
  const src = readRecord(raw);
  return {
    enabled: readBoolean(src.enabled, DEFAULT_CLOUDS_RECIPE.enabled),
    layers: readCloudLayers(src.layers),
    sharpness: readClampedNumber(
      src.sharpness,
      DEFAULT_CLOUDS_RECIPE.sharpness,
      0.02,
      1,
    ),
    detail: Math.round(
      readClampedNumber(src.detail, DEFAULT_CLOUDS_RECIPE.detail, 1, 6),
    ),
    litColor: readHexColor(src.litColor, DEFAULT_CLOUDS_RECIPE.litColor),
    shadowColor: readHexColor(
      src.shadowColor,
      DEFAULT_CLOUDS_RECIPE.shadowColor,
    ),
    sunsetColor: readHexColor(
      src.sunsetColor,
      DEFAULT_CLOUDS_RECIPE.sunsetColor,
    ),
    nightColor: readHexColor(src.nightColor, DEFAULT_CLOUDS_RECIPE.nightColor),
    silverLining: readClampedNumber(
      src.silverLining,
      DEFAULT_CLOUDS_RECIPE.silverLining,
      0,
      3,
    ),
  };
}

/** Validates and normalizes the `sky` block of a planet document. */
export function readSky(raw: unknown): PlanetSkyRecipe {
  const src = readRecord(raw);
  return {
    dayLengthSeconds: Math.max(
      30,
      readNumber(src.dayLengthSeconds, DEFAULT_DAY_LENGTH_SECONDS),
    ),
    atmosphere: readAtmosphere(src.atmosphere),
    sun: readSun(src.sun),
    moon: readMoon(src.moon),
    stars: readStars(src.stars),
    clouds: readClouds(src.clouds),
    night: readNight(src.night),
  };
}

/** Fresh, mutable defaults for a newly created planet document. */
export function createDefaultSkyRecipe(): PlanetSkyRecipe {
  return readSky(undefined);
}
