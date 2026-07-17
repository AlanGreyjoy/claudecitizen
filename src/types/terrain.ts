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
  // Low-poly terrain is non-indexed: each triangle owns three vertices so its
  // normal and palette color stay perfectly flat across the face. Colors and
  // normals use normalized packed attributes to offset the duplicated vertices.
  positions: Float32Array;
  colors: Uint8Array;
  normals: Int16Array;
}

export interface LakeWaterBuffers {
  // Water mirrors the terrain's faceted layout: triangles do not share vertices,
  // so each face keeps one palette color and one flat geometric normal. The
  // remaining attributes drive shallow caustics and the shoreline foam ribbon.
  positions: Float32Array;
  barycentrics: Uint8Array;
  colors: Uint8Array;
  effectDetails: Uint8Array;
  normals: Int16Array;
  shores: Uint8Array;
  waterDepths: Float32Array;
}
