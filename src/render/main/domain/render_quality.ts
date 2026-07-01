export type RenderQualityPreset = 'performance' | 'balanced' | 'high';

export interface RenderQualitySettings {
  preset: RenderQualityPreset;
  maxPixelRatio: number;
  antialias: boolean;
  useSmaa: boolean;
  shadowMapSize: number;
  minProjectedError: number;
  fogRaySteps: number;
  cloudResolutionScale: number;
  cloudQualityPreset: 'low' | 'medium' | 'high';
  cloudShadowCascades: number;
  cloudShadowMapSize: number;
  aerialPerspectiveShadowSamples: number;
  bloomMipmapBlur: boolean;
  grassSampleCount: number;
  treeSampleCount: number;
  vegetationTileDistanceMeters: number;
}

const QUALITY_PRESETS: Record<RenderQualityPreset, RenderQualitySettings> = {
  performance: {
    preset: 'performance',
    maxPixelRatio: 1,
    antialias: true,
    useSmaa: false,
    shadowMapSize: 512,
    minProjectedError: 1.8,
    fogRaySteps: 8,
    cloudResolutionScale: 0.35,
    cloudQualityPreset: 'low',
    cloudShadowCascades: 0,
    cloudShadowMapSize: 256,
    aerialPerspectiveShadowSamples: 4,
    bloomMipmapBlur: false,
    grassSampleCount: 120,
    treeSampleCount: 64,
    vegetationTileDistanceMeters: 32_000,
  },
  balanced: {
    preset: 'balanced',
    maxPixelRatio: 1.25,
    antialias: true,
    useSmaa: false,
    shadowMapSize: 1024,
    minProjectedError: 1.35,
    fogRaySteps: 12,
    cloudResolutionScale: 0.5,
    cloudQualityPreset: 'medium',
    cloudShadowCascades: 1,
    cloudShadowMapSize: 384,
    aerialPerspectiveShadowSamples: 8,
    bloomMipmapBlur: false,
    grassSampleCount: 220,
    treeSampleCount: 120,
    vegetationTileDistanceMeters: 48_000,
  },
  high: {
    preset: 'high',
    maxPixelRatio: 2,
    antialias: true,
    useSmaa: true,
    shadowMapSize: 2048,
    minProjectedError: 0.9,
    fogRaySteps: 20,
    cloudResolutionScale: 0.8,
    cloudQualityPreset: 'high',
    cloudShadowCascades: 3,
    cloudShadowMapSize: 512,
    aerialPerspectiveShadowSamples: 16,
    bloomMipmapBlur: true,
    grassSampleCount: 500,
    treeSampleCount: 500,
    vegetationTileDistanceMeters: 72_000,
  },
};

function parseQualityPreset(): RenderQualityPreset {
  if (typeof window === 'undefined') return 'balanced';
  const raw = new URLSearchParams(window.location.search).get('quality');
  if (raw === 'performance' || raw === 'balanced' || raw === 'high') {
    return raw;
  }
  return 'balanced';
}

export function resolveRenderQuality(): RenderQualitySettings {
  return { ...QUALITY_PRESETS[parseQualityPreset()] };
}
