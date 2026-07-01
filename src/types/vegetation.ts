export interface VegetationLayerSettings {
  density: number;
  gapMeters: number;
  minScale: number;
  maxScale: number;
}

export interface VegetationSettings {
  grass: VegetationLayerSettings;
  tree: VegetationLayerSettings;
}
