import type { CloudLayerConfig } from '../types';

export const CLOUD_LAYER_CONFIGS: CloudLayerConfig[] = [
  {
    altitudeMeters: 900,
    opacity: 0.85,
    radiusOffsetMeters: 0,
    rotationRate: 0.00004,
    scale: 1,
  },
  {
    altitudeMeters: 3_200,
    opacity: 0.55,
    radiusOffsetMeters: 900,
    rotationRate: -0.000025,
    scale: 1.85,
  },
];

export function phaseFromSeed(seed: number, layerIndex: number): number {
  return (((seed + layerIndex * 131) % 997) / 997) * Math.PI * 2;
}

function clamp01(value: number): number {
  return Math.max(0, Math.min(1, value));
}

/** Unit direction from equirectangular lon/lat (Y-up sphere). */
function directionFromLonLat(
  lonRadians: number,
  latRadians: number,
): { x: number; y: number; z: number } {
  const cosLat = Math.cos(latRadians);
  return {
    x: cosLat * Math.cos(lonRadians),
    y: Math.sin(latRadians),
    z: cosLat * Math.sin(lonRadians),
  };
}

/**
 * Sample cloud coverage on the unit sphere.
 *
 * Noise is evaluated in Cartesian space so lat/lon singularities (the classic
 * zenith "hurricane") cannot appear — neighboring directions stay continuous
 * through the poles.
 *
 * NOTE: the 2D cloud shell samples this exact recipe in GLSL
 * (src/render/effects/clouds/shell.ts `cloudCoverage`). Keep the constants in
 * sync when tuning.
 */
export function sampleCloudCoverage(
  seed: number,
  lonRadians: number,
  latRadians: number,
  layerIndex = 0,
): number {
  const config = CLOUD_LAYER_CONFIGS[layerIndex] ?? CLOUD_LAYER_CONFIGS[0];
  const phase = phaseFromSeed(seed, layerIndex);
  const dir = directionFromLonLat(lonRadians, latRadians);
  const s = config.scale;
  const x = dir.x * s;
  const y = dir.y * s;
  const z = dir.z * s;

  // Low-frequency banks via oriented waves (dot products on the sphere).
  const continental =
    Math.sin(x * 2.8 + y * 1.1 + phase * 0.7) * 0.48 +
    Math.cos(y * 3.2 - z * 1.4 - phase * 0.4) * 0.3 +
    Math.sin(x * 1.6 + z * 2.1 + y * 1.3 + phase * 1.2) * 0.18;
  const billow =
    Math.sin(x * 9.2 - y * 6.4 + z * 4.1 + phase * 1.5) * 0.15 +
    Math.cos(x * 14.5 + y * 8.2 - z * 11.3 - phase * 0.85) * 0.12 +
    Math.sin(x * 22.1 + y * 18.4 + z * 15.7 + phase * 2.1) * 0.07;
  const ridges =
    1 -
    Math.abs(
      Math.sin(x * 7.1 + y * 5.3 + phase * 0.55) * Math.cos(z * 6.8 - y * 4.2 - phase * 0.95),
    );

  const density = continental * 0.62 + (ridges * 2 - 1) * 0.18 + billow;
  return clamp01((density + 0.28) / 1.18);
}

export function sampleCloudAlpha(
  seed: number,
  lonRadians: number,
  latRadians: number,
  layerIndex = 0,
): number {
  const coverage = sampleCloudCoverage(seed, lonRadians, latRadians, layerIndex);
  // Keep a clear sky/cloud break so patches read as clouds, not a solid wash.
  return clamp01((coverage - 0.28) / 0.42);
}
