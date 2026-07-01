import type { VegetationLayerSettings, VegetationSettings } from "../../types";

function clamp(value: number, min: number, max: number): number {
  return Math.max(min, Math.min(max, value));
}

interface LayerLimits {
  density: [number, number];
  gapMeters: [number, number];
  scale: [number, number];
}

function normalizeLayer(
  layer: Partial<VegetationLayerSettings> | undefined,
  defaults: VegetationLayerSettings,
  limits: LayerLimits,
): VegetationLayerSettings {
  const density = clamp(
    Number.isFinite(layer?.density)
      ? (layer?.density as number)
      : defaults.density,
    limits.density[0],
    limits.density[1],
  );
  const gapMeters = clamp(
    Number.isFinite(layer?.gapMeters)
      ? (layer?.gapMeters as number)
      : defaults.gapMeters,
    limits.gapMeters[0],
    limits.gapMeters[1],
  );
  const minScale = clamp(
    Number.isFinite(layer?.minScale)
      ? (layer?.minScale as number)
      : defaults.minScale,
    limits.scale[0],
    limits.scale[1],
  );
  const maxScale = clamp(
    Number.isFinite(layer?.maxScale)
      ? (layer?.maxScale as number)
      : defaults.maxScale,
    limits.scale[0],
    limits.scale[1],
  );

  return {
    density,
    gapMeters,
    minScale: Math.min(minScale, maxScale),
    maxScale: Math.max(minScale, maxScale),
  };
}

export const DEFAULT_VEGETATION_SETTINGS: VegetationSettings = Object.freeze({
  grass: Object.freeze({
    density: 1,
    gapMeters: 0,
    minScale: 0.1,
    maxScale: 0.5,
  }),
  tree: Object.freeze({
    density: 1,
    gapMeters: 0,
    minScale: 1.1,
    maxScale: 3.5,
  }),
});

export function normalizeVegetationSettings(
  settings: Partial<VegetationSettings> = DEFAULT_VEGETATION_SETTINGS,
): VegetationSettings {
  return {
    grass: normalizeLayer(settings.grass, DEFAULT_VEGETATION_SETTINGS.grass, {
      density: [0, 4],
      gapMeters: [0, 24],
      scale: [0.15, 6],
    }),
    tree: normalizeLayer(settings.tree, DEFAULT_VEGETATION_SETTINGS.tree, {
      density: [0, 4],
      gapMeters: [0, 80],
      scale: [0.25, 8],
    }),
  };
}
