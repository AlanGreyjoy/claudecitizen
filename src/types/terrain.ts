import type { Vec3 } from './math';

export type CubeFace = 'px' | 'nx' | 'py' | 'ny' | 'pz' | 'nz';

export interface TileBounds {
  u0: number;
  u1: number;
  v0: number;
  v1: number;
}

export interface TileInfo {
  face: CubeFace;
  level: number;
  x: number;
  y: number;
  bounds: TileBounds;
  centerDirection: Vec3;
  centerPosition: Vec3;
  spanMeters: number;
}

export interface TerrainTileBuffers {
  positions: Float32Array;
  colors: Float32Array;
  normals: Float32Array;
  // Tile-local texture coordinates (2 floats per vertex), continuous across
  // tile borders modulo whole texture repeats.
  uvs: Float32Array;
  // Splat weights for texture layers 0-3 and 4-7 (4 floats per vertex each).
  weights0: Float32Array;
  weights1: Float32Array;
}

export interface LakeWaterBuffers {
  positions: Float32Array;
  uvs: Float32Array;
  indices: Uint32Array;
}
