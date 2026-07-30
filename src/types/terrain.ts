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
  //
  // Colors and normals carry a **fourth, unused component**. WebGPU defines no
  // 3-wide 8/16-bit vertex format (only x2 and x4) and requires every vertex
  // buffer's arrayStride to be a multiple of 4, so `unorm8x3` / `snorm16x3`
  // fail pipeline creation outright. Padding to x4 is the standard fix.
  positions: Float32Array;
  colors: Uint8Array;
  normals: Int16Array;
}

export interface SurfaceWaterBuffers {
  // Water mirrors the terrain's faceted layout: triangles do not share vertices,
  // so each face keeps one palette color and one flat geometric normal. The
  // radial directions let the shader animate the surface without making it
  // conform to terrain height. The remaining attributes drive shallow caustics
  // and the shoreline foam ribbon.
  //
  // The packed 8-bit attributes are 4 components wide, and the three scalar
  // factors share one attribute, because WebGPU defines no 3-wide or 1-wide
  // 8-bit vertex format and requires every vertex buffer's arrayStride to be a
  // multiple of 4. `barycentrics.w` and `colors.w` are unused padding.
  positions: Float32Array;
  barycentrics: Uint8Array;
  colors: Uint8Array;
  /**
   * [effectDetail, shore, surfStrength, unused] per vertex.
   *
   * Surf strength is ocean-only; inland lakes and rivers intentionally pack zero.
   */
  waterFactors: Uint8Array;
  radialDirections: Float32Array;
  waterDepths: Float32Array;
}
