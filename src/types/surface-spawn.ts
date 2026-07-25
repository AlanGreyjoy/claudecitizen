import type { Biome } from './planet';

export type SurfaceSpawnColliderShape = 'box' | 'capsule';

/** Collider dims in asset-local meters at scale = 1. */
export interface SurfaceSpawnCollider {
  shape: SurfaceSpawnColliderShape;
  /** Box half-extents [x, y, z]. */
  halfExtents?: [number, number, number];
  /** Capsule radius. */
  radius?: number;
  /** Capsule half-height (cylinder portion). */
  halfHeight?: number;
}

/**
 * One catalog entry (rock type, debris, fixture).
 * `SurfaceSpawnInstance.layerId` stores this entry's `id`.
 */
export interface PlanetSpawnEntry {
  id: string;
  name: string;
  assetUrl: string;
  enabled: boolean;
  /** Relative pick weight among entries that accept a probe. */
  weight: number;
  /**
   * Legacy per-entry density 0–1. Multiplies lottery weight and stochastic
   * accept; prefer catalog.density + weight going forward.
   */
  density: number;
  gapMeters: number;
  minScale: number;
  maxScale: number;
  /** Empty allowlist → no placements. */
  biomes: Biome[];
  minNormalizedHeight: number;
  maxNormalizedHeight: number;
  alignToNormal: boolean;
  /**
   * Signed offset along the surface normal in meters at scale = 1 (scaled by
   * instance scale). Negative sinks into the terrain; positive lifts above it.
   */
  terrainInsetMeters: number;
  collider: SurfaceSpawnCollider;
  seedOffset: number;
}

/** @deprecated Prefer PlanetSpawnEntry — alias kept for call-site churn. */
export type PlanetSpawnLayer = PlanetSpawnEntry;

/** Shared-probe surface spawn catalog on a planet document. */
export interface PlanetSpawnCatalog {
  /** Shared sample attempts per tile before density scaling. */
  samplesPerTile: number;
  /** Global density scale 0–1+ (scales shared sample count). */
  density: number;
  entries: PlanetSpawnEntry[];
}

export interface SurfaceSpawnInstance {
  /** Catalog entry id (historical field name). */
  layerId: string;
  position: { x: number; y: number; z: number };
  normal: { x: number; y: number; z: number };
  yawRadians: number;
  scale: number;
}
