import type { StoredVegetationInstance } from './storage';

/** One 4x4 instance matrix. */
export const VEGETATION_MATRIX_STRIDE = 16;

/**
 * Flat transfer form for a tile's instances. A lush L17 tile produces tens of
 * thousands of placements, and structured-cloning that many individual
 * Float32Arrays costs more than the two buffers below, which move by transfer.
 */
export interface PackedVegetationInstances {
  matrices: Float32Array;
  variantIndices: Uint16Array;
}

export function packVegetationInstances(
  entries: readonly StoredVegetationInstance[],
): PackedVegetationInstances {
  const matrices = new Float32Array(entries.length * VEGETATION_MATRIX_STRIDE);
  const variantIndices = new Uint16Array(entries.length);
  for (let index = 0; index < entries.length; index += 1) {
    matrices.set(entries[index].matrix, index * VEGETATION_MATRIX_STRIDE);
    variantIndices[index] = entries[index].variantIndex;
  }
  return { matrices, variantIndices };
}

/**
 * Views into the transferred buffer rather than copies. Consumers only read the
 * matrix or blit it into an InstancedMesh, and structured clone stores the
 * shared buffer once when the tile is later written to the disk cache.
 */
export function unpackVegetationInstances(
  packed: PackedVegetationInstances,
): StoredVegetationInstance[] {
  const count = packed.variantIndices.length;
  const entries: StoredVegetationInstance[] = new Array(count);
  for (let index = 0; index < count; index += 1) {
    const offset = index * VEGETATION_MATRIX_STRIDE;
    entries[index] = {
      matrix: packed.matrices.subarray(offset, offset + VEGETATION_MATRIX_STRIDE),
      variantIndex: packed.variantIndices[index],
    };
  }
  return entries;
}
