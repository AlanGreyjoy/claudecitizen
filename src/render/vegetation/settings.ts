import type { VegetationLayerSettings, VegetationSettings } from "../../types";

function clamp(value: number, min: number, max: number): number {
  return Math.max(min, Math.min(max, value));
}

interface LayerLimits {
  density: [number, number];
  gapMeters: [number, number];
  scale: [number, number];
}

function isTreeAssetUrl(value: unknown): value is string {
  return (
    typeof value === "string" &&
    value.startsWith("/") &&
    /\.(glb|gltf)(\?|$)/i.test(value)
  );
}

function isGrassAssetUrl(value: unknown): value is string {
  return (
    typeof value === "string" &&
    value.startsWith("/") &&
    /\.(png|jpe?g|webp)(\?|$)/i.test(value)
  );
}

const HEX_COLOR_PATTERN = /^#[0-9a-fA-F]{6}$/;

export const DEFAULT_GRASS_COLOR = "#7a9f42";

/**
 * Average authored scale at which density=1 is tuned as a full carpet.
 * Smaller min/max scale needs more instances for the same ground coverage.
 */
export const GRASS_CARPET_REFERENCE_SCALE = 0.95;

/**
 * Sample-count multiplier so density stays “coverage” when authors shrink
 * grass scale (e.g. 0.1–0.5). Area-like: (ref / avgScale)².
 */
export function grassScaleCoverageMultiplier(
  minScale: number,
  maxScale: number,
): number {
  const lo = Number.isFinite(minScale) ? minScale : GRASS_CARPET_REFERENCE_SCALE;
  const hi = Number.isFinite(maxScale) ? maxScale : GRASS_CARPET_REFERENCE_SCALE;
  const avg = Math.max(0.05, (lo + hi) * 0.5);
  const linear = GRASS_CARPET_REFERENCE_SCALE / avg;
  return linear * linear;
}

export function sanitizeGrassColor(
  value: unknown,
  fallback = DEFAULT_GRASS_COLOR,
): string {
  if (typeof value !== "string") return fallback;
  const trimmed = value.trim();
  if (!HEX_COLOR_PATTERN.test(trimmed)) return fallback;
  return trimmed.toLowerCase();
}

export function sanitizeVegetationAssetUrls(
  urls: readonly string[] | undefined,
  kind: "grass" | "tree" = "tree",
): string[] {
  if (!urls || urls.length === 0) return [];
  const accept = kind === "grass" ? isGrassAssetUrl : isTreeAssetUrl;
  const out: string[] = [];
  for (const entry of urls) {
    if (!accept(entry)) continue;
    const trimmed = entry.trim();
    if (trimmed.length === 0) continue;
    out.push(trimmed);
  }
  return out;
}

function normalizeLayer(
  layer: Partial<VegetationLayerSettings> | undefined,
  defaults: VegetationLayerSettings,
  limits: LayerLimits,
  kind: "grass" | "tree",
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

  const normalized: VegetationLayerSettings = {
    density,
    gapMeters,
    minScale: Math.min(minScale, maxScale),
    maxScale: Math.max(minScale, maxScale),
    assetUrls: sanitizeVegetationAssetUrls(
      layer?.assetUrls ?? defaults.assetUrls,
      kind,
    ),
  };
  if (kind === "grass") {
    normalized.color = sanitizeGrassColor(
      layer?.color ?? defaults.color,
      DEFAULT_GRASS_COLOR,
    );
  }
  return normalized;
}

export const DEFAULT_VEGETATION_SETTINGS: VegetationSettings = Object.freeze({
  grass: Object.freeze({
    density: 1,
    gapMeters: 0,
    minScale: 0.55,
    maxScale: 1.35,
    assetUrls: Object.freeze([]) as unknown as string[],
    color: DEFAULT_GRASS_COLOR,
  }),
  tree: Object.freeze({
    density: 1,
    gapMeters: 0,
    minScale: 1.1,
    maxScale: 3.5,
    assetUrls: Object.freeze([]) as unknown as string[],
  }),
});

export function normalizeVegetationSettings(
  settings: Partial<VegetationSettings> = DEFAULT_VEGETATION_SETTINGS,
): VegetationSettings {
  return {
    grass: normalizeLayer(
      settings.grass,
      DEFAULT_VEGETATION_SETTINGS.grass,
      {
        density: [0, 12],
        gapMeters: [0, 24],
        scale: [0.15, 6],
      },
      "grass",
    ),
    tree: normalizeLayer(
      settings.tree,
      DEFAULT_VEGETATION_SETTINGS.tree,
      {
        density: [0, 12],
        gapMeters: [0, 80],
        scale: [0.25, 8],
      },
      "tree",
    ),
  };
}

export function vegetationAssetUrlsEqual(
  a: readonly string[],
  b: readonly string[],
): boolean {
  if (a.length !== b.length) return false;
  for (let i = 0; i < a.length; i += 1) {
    if (a[i] !== b[i]) return false;
  }
  return true;
}
