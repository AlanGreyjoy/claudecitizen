import type { Biome } from "../../../types";

// Splat-map texture layers sampled by the terrain material. Order must match
// the layer order of the DataArrayTexture built in render/terrain_texture_array.ts.
export const TERRAIN_TEXTURE_LAYER_COUNT = 8;

export const enum TerrainTextureLayer {
  Water = 0,
  Beach = 1,
  Desert = 2,
  Grass = 3,
  Forest = 4,
  Rock = 5,
  SnowyGrass = 6,
  Snow = 7,
}

// World-space size of one texture repeat. Kept small enough for ground detail
// but large enough that tiling is not too obvious on foot.
export const TERRAIN_TEXTURE_REPEAT_METERS = 4;

export function terrainTextureLayerForBiome(biome: Biome): TerrainTextureLayer {
  switch (biome) {
    case "ocean":
      return TerrainTextureLayer.Water;
    case "lake":
      return TerrainTextureLayer.Rock;
    case "river":
      return TerrainTextureLayer.Beach;
    case "beach":
      return TerrainTextureLayer.Beach;
    case "desert":
      return TerrainTextureLayer.Desert;
    case "plains":
      return TerrainTextureLayer.Grass;
    case "forest":
      return TerrainTextureLayer.Forest;
    case "tundra":
      return TerrainTextureLayer.SnowyGrass;
    case "highlands":
      return TerrainTextureLayer.Rock;
    case "peak":
      return TerrainTextureLayer.Snow;
    default:
      return TerrainTextureLayer.Rock;
  }
}
