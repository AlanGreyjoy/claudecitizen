import type { Vec3 } from './math';

export interface Planet {
  name?: string;
  radiusMeters: number;
  gravityMetersPerSecond2?: number;
  atmosphereHeightMeters: number;
  terrainAmplitudeMeters: number;
  dragSeaLevel?: number;
}

export type Biome =
  | 'forest'
  | 'plains'
  | 'desert'
  | 'tundra'
  | 'highlands'
  | 'peak'
  | 'rock';

/** Hydrology is independent from the underlying land biome. */
export type WaterBody = 'ocean' | 'lake' | 'river';

export interface PlanetSurfaceSample {
  altitudeMeters: number;
  biome: Biome;
  fertility: number;
  grassDensity: number;
  heightMeters: number;
  lakeDepth: number;
  lakeStrength: number;
  lakeWaterLevelMeters: number | null;
  moisture: number;
  mountainRegion: number;
  normalizedHeight: number;
  riverWaterLevelMeters: number | null;
  surfaceRadiusMeters: number;
  temperature: number;
  treeDensity: number;
  /** Visible water covering this terrain sample, if any. */
  waterBody: WaterBody | null;
  /** Visible water-surface elevation for `waterBody`, in planet-local meters. */
  waterLevelMeters: number | null;
  normal?: Vec3;
}

export interface LandingSiteHint {
  latRadians: number;
  lonRadians: number;
}

export interface LandingSite {
  latRadians: number;
  lonRadians: number;
}

export interface CloudLayerConfig {
  altitudeMeters: number;
  opacity: number;
  radiusOffsetMeters: number;
  rotationRate: number;
  scale: number;
}
