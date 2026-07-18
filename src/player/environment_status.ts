/**
 * Personal-device environment readouts derived from planet + surface sample.
 * Pure presentation helper — no DOM / Three.js.
 */

import type { Planet, PlanetSurfaceSample } from '../types';

export interface EnvironmentStatus {
  /** Local gravity in g (Earth = 1). */
  gravityG: number;
  /** Atmosphere safety label. */
  atmosphereLabel: string;
  /** Atmosphere factor 1 = dense surface air, 0 = vacuum. */
  atmosphere01: number;
  /** Approximate pressure in hPa. */
  pressureHpa: number;
  /** Ambient temperature °C. */
  temperatureC: number;
  /** Radiation Rem/s (placeholder until a real source exists). */
  radiationRemS: number;
}

const EARTH_G = 9.80665;
const SEA_LEVEL_HPA = 1013;

/**
 * Map PlanetSurfaceSample.temperature (roughly 0..1 biome factor) to °C.
 * Mid values land near temperate; cold biomes / altitude cool further.
 */
function temperatureCFromSample(
  sample: PlanetSurfaceSample,
  atmosphere01: number,
): number {
  const base = lerp(-35, 42, clamp01(sample.temperature));
  const altitudeCool = Math.min(40, Math.max(0, sample.altitudeMeters / 500)) * 0.35;
  const vacuumCool = (1 - atmosphere01) * 55;
  return base - altitudeCool - vacuumCool;
}

function clamp01(value: number): number {
  return Math.min(1, Math.max(0, value));
}

function lerp(a: number, b: number, t: number): number {
  return a + (b - a) * t;
}

export function atmosphere01FromAltitude(
  altitudeMeters: number,
  atmosphereHeightMeters: number,
): number {
  if (atmosphereHeightMeters <= 0) return 0;
  return clamp01(1 - Math.max(0, altitudeMeters) / atmosphereHeightMeters);
}

export function deriveEnvironmentStatus(
  planet: Planet,
  sample: PlanetSurfaceSample,
): EnvironmentStatus {
  const gravityMps2 = planet.gravityMetersPerSecond2 ?? EARTH_G;
  const atmosphere01 = atmosphere01FromAltitude(
    sample.altitudeMeters,
    planet.atmosphereHeightMeters,
  );
  const atmosphereLabel =
    atmosphere01 >= 0.55 ? 'Safe' : atmosphere01 >= 0.2 ? 'Thin' : 'Vacuum';

  return {
    gravityG: gravityMps2 / EARTH_G,
    atmosphereLabel,
    atmosphere01,
    pressureHpa: SEA_LEVEL_HPA * atmosphere01 * atmosphere01,
    temperatureC: temperatureCFromSample(sample, atmosphere01),
    radiationRemS: 0,
  };
}
