export interface StoredVegetationInstance {
  matrix: Float32Array;
  variantIndex: number;
}

export interface StoredVegetationTile {
  anchor: { x: number; y: number; z: number };
  grass: StoredVegetationInstance[];
  trees: StoredVegetationInstance[];
}
