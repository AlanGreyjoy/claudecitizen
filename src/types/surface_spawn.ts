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

export interface PlanetSpawnLayer {
  id: string;
  name: string;
  assetUrl: string;
  enabled: boolean;
  density: number;
  gapMeters: number;
  minScale: number;
  maxScale: number;
  /** Empty allowlist → no placements. */
  biomes: Biome[];
  minNormalizedHeight: number;
  maxNormalizedHeight: number;
  alignToNormal: boolean;
  collider: SurfaceSpawnCollider;
  seedOffset: number;
}

export interface SurfaceSpawnInstance {
  layerId: string;
  position: { x: number; y: number; z: number };
  normal: { x: number; y: number; z: number };
  yawRadians: number;
  scale: number;
}
