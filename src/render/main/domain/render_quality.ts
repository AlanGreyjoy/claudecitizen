export type RenderQualityPreset = 'performance' | 'balanced' | 'high';

/**
 * User-facing sun/moon shadow override. 'auto' follows the active quality
 * preset's shadowMapSize; the rest pin the shadow map to a fixed size (or off).
 */
export type ShadowQualitySetting = 'auto' | 'off' | 'low' | 'medium' | 'high';

const SHADOW_QUALITY_MAP_SIZES: Record<Exclude<ShadowQualitySetting, 'auto'>, number> = {
  off: 0,
  low: 512,
  medium: 1024,
  high: 2048,
};

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
  ambientOcclusionEnabled: boolean;
  ambientOcclusionSamples: number;
  ambientOcclusionResolutionScale: number;
  ambientOcclusionIntensity: number;
  localLightShadowsEnabled: boolean;
  localLightShadowMapSize: number;
  bloomMipmapBlur: boolean;
  grassSampleCount: number;
  treeSampleCount: number;
  vegetationTileDistanceMeters: number;
  motionBlurEnabled: boolean;
  motionBlurSamples: number;
}

const QUALITY_PRESETS: Record<RenderQualityPreset, RenderQualitySettings> = {
  // Note: `antialias` requests MSAA on the canvas context, which has no effect
  // when rendering goes through the EffectComposer's offscreen buffers — SMAA
  // is the AA path that actually shows up on screen.
  performance: {
    preset: 'performance',
    maxPixelRatio: 1,
    antialias: false,
    useSmaa: false,
    shadowMapSize: 512,
    minProjectedError: 1.8,
    fogRaySteps: 8,
    cloudResolutionScale: 0.35,
    cloudQualityPreset: 'low',
    cloudShadowCascades: 0,
    cloudShadowMapSize: 256,
    aerialPerspectiveShadowSamples: 4,
    ambientOcclusionEnabled: false,
    ambientOcclusionSamples: 7,
    ambientOcclusionResolutionScale: 0.45,
    ambientOcclusionIntensity: 2.0,
    localLightShadowsEnabled: false,
    localLightShadowMapSize: 0,
    bloomMipmapBlur: false,
    grassSampleCount: 280,
    treeSampleCount: 64,
    vegetationTileDistanceMeters: 32_000,
    motionBlurEnabled: false,
    motionBlurSamples: 4,
  },
  balanced: {
    preset: 'balanced',
    maxPixelRatio: 1.25,
    antialias: false,
    useSmaa: true,
    shadowMapSize: 1024,
    minProjectedError: 1.35,
    // Clamped to SURFACE_FOG_RAY_STEPS at composer build; keep preset ≤ that.
    fogRaySteps: 8,
    cloudResolutionScale: 0.5,
    cloudQualityPreset: 'medium',
    cloudShadowCascades: 1,
    cloudShadowMapSize: 384,
    aerialPerspectiveShadowSamples: 8,
    ambientOcclusionEnabled: true,
    ambientOcclusionSamples: 12,
    ambientOcclusionResolutionScale: 0.5,
    ambientOcclusionIntensity: 2.5,
    localLightShadowsEnabled: false,
    localLightShadowMapSize: 0,
    bloomMipmapBlur: true,
    grassSampleCount: 400,
    treeSampleCount: 120,
    vegetationTileDistanceMeters: 48_000,
    motionBlurEnabled: true,
    motionBlurSamples: 8,
  },
  high: {
    preset: 'high',
    maxPixelRatio: 2,
    antialias: false,
    useSmaa: true,
    shadowMapSize: 2048,
    minProjectedError: 0.9,
    fogRaySteps: 8,
    cloudResolutionScale: 0.8,
    cloudQualityPreset: 'high',
    cloudShadowCascades: 3,
    cloudShadowMapSize: 512,
    aerialPerspectiveShadowSamples: 16,
    ambientOcclusionEnabled: true,
    ambientOcclusionSamples: 18,
    ambientOcclusionResolutionScale: 0.55,
    ambientOcclusionIntensity: 3.0,
    localLightShadowsEnabled: true,
    localLightShadowMapSize: 256,
    bloomMipmapBlur: true,
    // Near-field grass only (L16+ / distance cull); L17 carries underfoot carpet.
    grassSampleCount: 480,
    treeSampleCount: 220,
    vegetationTileDistanceMeters: 72_000,
    motionBlurEnabled: true,
    motionBlurSamples: 16,
  },
};

function parseQualityPreset(): RenderQualityPreset {
  if (typeof window === 'undefined') return 'balanced';
  const raw = new URLSearchParams(window.location.search).get('quality');
  if (raw === 'performance' || raw === 'balanced' || raw === 'high') {
    return raw;
  }
  try {
    const stored = localStorage.getItem('claudecitizen-game-settings');
    if (stored) {
      const parsed = JSON.parse(stored) as { renderQuality?: unknown };
      if (
        parsed.renderQuality === 'performance' ||
        parsed.renderQuality === 'balanced' ||
        parsed.renderQuality === 'high'
      ) {
        return parsed.renderQuality;
      }
    }
  } catch {
    // Ignore malformed local settings.
  }
  return 'balanced';
}

/**
 * Reads the user's ambient-occlusion toggle from saved game settings. Returns
 * `undefined` when unset so the active quality preset controls AO by default.
 */
function parseAmbientOcclusionOverride(): boolean | undefined {
  if (typeof window === 'undefined') return undefined;
  try {
    const stored = localStorage.getItem('claudecitizen-game-settings');
    if (!stored) return undefined;
    const parsed = JSON.parse(stored) as { ambientOcclusion?: unknown };
    if (typeof parsed.ambientOcclusion === 'boolean') return parsed.ambientOcclusion;
  } catch {
    // Ignore malformed local settings.
  }
  return undefined;
}

function parseMotionBlurOverride(): boolean | undefined {
  if (typeof window === 'undefined') return undefined;
  try {
    const stored = localStorage.getItem('claudecitizen-game-settings');
    if (!stored) return undefined;
    const parsed = JSON.parse(stored) as { motionBlur?: unknown };
    if (typeof parsed.motionBlur === 'boolean') return parsed.motionBlur;
  } catch {
    // Ignore malformed local settings.
  }
  return undefined;
}

/**
 * Reads the user's shadow-quality override from saved game settings. Returns
 * `undefined` when unset or 'auto' so the active quality preset controls the
 * sun/moon shadow map size by default.
 */
function parseShadowQualityOverride(): Exclude<ShadowQualitySetting, 'auto'> | undefined {
  if (typeof window === 'undefined') return undefined;
  try {
    const stored = localStorage.getItem('claudecitizen-game-settings');
    if (!stored) return undefined;
    const parsed = JSON.parse(stored) as { shadowQuality?: unknown };
    if (
      parsed.shadowQuality === 'off' ||
      parsed.shadowQuality === 'low' ||
      parsed.shadowQuality === 'medium' ||
      parsed.shadowQuality === 'high'
    ) {
      return parsed.shadowQuality;
    }
  } catch {
    // Ignore malformed local settings.
  }
  return undefined;
}

export function resolveRenderQuality(): RenderQualitySettings {
  const settings = { ...QUALITY_PRESETS[parseQualityPreset()] };
  const ambientOcclusionOverride = parseAmbientOcclusionOverride();
  if (ambientOcclusionOverride !== undefined) {
    settings.ambientOcclusionEnabled = ambientOcclusionOverride;
  }
  const motionBlurOverride = parseMotionBlurOverride();
  if (motionBlurOverride !== undefined) {
    settings.motionBlurEnabled = motionBlurOverride;
  }
  const shadowQualityOverride = parseShadowQualityOverride();
  if (shadowQualityOverride !== undefined) {
    settings.shadowMapSize = SHADOW_QUALITY_MAP_SIZES[shadowQualityOverride];
    if (settings.shadowMapSize === 0) {
      settings.localLightShadowsEnabled = false;
      settings.localLightShadowMapSize = 0;
    }
  }
  return settings;
}
