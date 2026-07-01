import type { CloudLayerConfig } from '../types';

export const CLOUD_LAYER_CONFIGS: CloudLayerConfig[] = [
  {
    altitudeMeters: 1_200,
    opacity: 0.7,
    radiusOffsetMeters: 0,
    rotationRate: 0.00004,
    scale: 1,
  },
  {
    altitudeMeters: 4_200,
    opacity: 0.38,
    radiusOffsetMeters: 900,
    rotationRate: -0.000025,
    scale: 1.85,
  },
];

function phaseFromSeed(seed: number, layerIndex: number): number {
  return (((seed + layerIndex * 131) % 997) / 997) * Math.PI * 2;
}

function clamp01(value: number): number {
  return Math.max(0, Math.min(1, value));
}

export function sampleCloudCoverage(
  seed: number,
  lonRadians: number,
  latRadians: number,
  layerIndex = 0,
): number {
  const config = CLOUD_LAYER_CONFIGS[layerIndex] ?? CLOUD_LAYER_CONFIGS[0];
  const phase = phaseFromSeed(seed, layerIndex);
  const scaledLon = lonRadians * config.scale;
  const scaledLat = latRadians * config.scale;

  const continental =
    Math.sin(scaledLon * 1.4 + phase * 0.7) * 0.48 +
    Math.cos(scaledLat * 2.1 - phase * 0.4) * 0.3 +
    Math.sin((scaledLon + scaledLat * 0.65) * 3.8 + phase * 1.2) * 0.18;
  const billow =
    Math.sin(scaledLon * 11.5 - scaledLat * 7.2 + phase * 1.5) * 0.15 +
    Math.cos(scaledLon * 18.2 + scaledLat * 13.6 - phase * 0.85) * 0.12 +
    Math.sin(scaledLon * 33.5 + scaledLat * 28.3 + phase * 2.1) * 0.07;
  const ridges =
    1 -
    Math.abs(
      Math.sin(scaledLat * 9.4 + phase * 0.55) * Math.cos(scaledLon * 8.6 - phase * 0.95),
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
  return clamp01((coverage - 0.34) / 0.28);
}
