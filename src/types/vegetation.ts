export interface VegetationLayerSettings {
  density: number;
  gapMeters: number;
  minScale: number;
  maxScale: number;
  /**
   * Absolute `/src/assets/...` paths.
   * Grass: `.png` / `.jpg` / `.webp` billboard textures (empty → procedural).
   * Trees: `.glb` / `.gltf` meshes.
   */
  assetUrls: string[];
  /**
   * CSS hex tint for grass billboards (procedural + PNG). Ignored on trees.
   */
  color?: string;
}

export interface VegetationSettings {
  grass: VegetationLayerSettings;
  tree: VegetationLayerSettings;
}
