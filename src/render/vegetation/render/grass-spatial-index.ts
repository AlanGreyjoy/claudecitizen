/**
 * Uniform-grid index over one grass variant's instance matrices.
 *
 * Grass is repacked every metre walked (`GRASS_RADIUS_UPDATE_MIN_MOVE_METERS`),
 * and the pack keeps only instances inside `getGrassDistanceMeters()` — 20 m by
 * default. It was scanning every matrix of every eligible tile to find them,
 * twice: once to size the mesh and once to write it.
 *
 * The eligibility test is much wider than the pack radius. `shouldShowGrassOnTile`
 * admits a tile whose centre is within `grassDistance + spanMeters`, using the
 * full tile diagonal so a player on a far corner still keeps the tile. So most
 * admitted tiles have no instance within 20 m at all, and paid two full scans
 * over thousands of matrices to produce zero output — every metre, for every
 * such tile.
 *
 * Instances never move, so their spatial layout can be decided once. Sorting
 * them into cells at build time turns the repack into a visit of the cells the
 * radius actually touches, and lets a tile that cannot contribute say so from
 * its bounds without reading a matrix.
 *
 * The grid is built on tile-local coordinates (matrix translations are already
 * anchor-relative), so it stays in small numbers and needs no planet-scale math.
 */

/** Target cell edge. Grown automatically if a tile's extent would over-subdivide. */
const BASE_CELL_METERS = 6;
/** Ceiling on cells per variant, so a tall or stretched tile cannot blow up memory. */
const MAX_CELLS = 4096;

export interface GrassSpatialIndex {
  /** Instance matrices reordered so each cell's instances are contiguous. */
  matrices: Float32Array;
  /**
   * Instance offset of each cell's first instance; length `cellCount + 1`, so
   * cell `c` spans `[cellStart[c], cellStart[c + 1])`.
   */
  cellStart: Int32Array;
  minX: number;
  minY: number;
  minZ: number;
  dimX: number;
  dimY: number;
  dimZ: number;
  cellSize: number;
  /**
   * Reused output for `collectGrassCandidateRanges` — pairs of float offsets
   * into `matrices`. Owned by the index so a per-metre query allocates nothing.
   */
  rangeScratch: Int32Array;
}

function cellCoordinate(value: number, min: number, cellSize: number, dim: number): number {
  const cell = Math.floor((value - min) / cellSize);
  if (cell < 0) return 0;
  if (cell >= dim) return dim - 1;
  return cell;
}

interface InstanceBounds {
  minX: number;
  minY: number;
  minZ: number;
  spanX: number;
  spanY: number;
  spanZ: number;
}

function instanceTranslationBounds(matrices: Float32Array): InstanceBounds {
  let minX = Number.POSITIVE_INFINITY;
  let minY = Number.POSITIVE_INFINITY;
  let minZ = Number.POSITIVE_INFINITY;
  let maxX = Number.NEGATIVE_INFINITY;
  let maxY = Number.NEGATIVE_INFINITY;
  let maxZ = Number.NEGATIVE_INFINITY;
  for (let offset = 0; offset < matrices.length; offset += 16) {
    const x = matrices[offset + 12];
    const y = matrices[offset + 13];
    const z = matrices[offset + 14];
    if (x < minX) minX = x;
    if (y < minY) minY = y;
    if (z < minZ) minZ = z;
    if (x > maxX) maxX = x;
    if (y > maxY) maxY = y;
    if (z > maxZ) maxZ = z;
  }
  return {
    minX,
    minY,
    minZ,
    spanX: maxX - minX,
    spanY: maxY - minY,
    spanZ: maxZ - minZ,
  };
}

/**
 * Smallest cell size at or above the base that keeps the grid under `MAX_CELLS`,
 * so an unusually tall or stretched tile cannot subdivide without bound.
 */
function fitGridDimensions(bounds: InstanceBounds): {
  cellSize: number;
  dimX: number;
  dimY: number;
  dimZ: number;
} {
  let cellSize = BASE_CELL_METERS;
  for (;;) {
    const dimX = Math.max(1, Math.floor(bounds.spanX / cellSize) + 1);
    const dimY = Math.max(1, Math.floor(bounds.spanY / cellSize) + 1);
    const dimZ = Math.max(1, Math.floor(bounds.spanZ / cellSize) + 1);
    if (dimX * dimY * dimZ <= MAX_CELLS) return { cellSize, dimX, dimY, dimZ };
    cellSize *= 2;
  }
}

/**
 * Sorts a variant's matrices into a uniform grid.
 *
 * Returns `null` for an empty variant so callers can skip it without a branch
 * on every access. The reordering is a counting sort: one pass to size the
 * cells, one to scatter. That is the same work one repack used to do, so the
 * index pays for itself the first time the player moves a metre.
 */
export function buildGrassSpatialIndex(
  matrices: Float32Array,
): GrassSpatialIndex | null {
  if (matrices.length === 0) return null;

  const bounds = instanceTranslationBounds(matrices);
  const { minX, minY, minZ } = bounds;
  const { cellSize, dimX, dimY, dimZ } = fitGridDimensions(bounds);

  const cellCount = dimX * dimY * dimZ;
  // One extra entry so the last cell has an end offset; also lets the counting
  // pass write into `[cell + 1]` and become a prefix sum in place.
  const cellStart = new Int32Array(cellCount + 1);
  for (let offset = 0; offset < matrices.length; offset += 16) {
    const cx = cellCoordinate(matrices[offset + 12], minX, cellSize, dimX);
    const cy = cellCoordinate(matrices[offset + 13], minY, cellSize, dimY);
    const cz = cellCoordinate(matrices[offset + 14], minZ, cellSize, dimZ);
    cellStart[(cz * dimY + cy) * dimX + cx + 1] += 1;
  }
  for (let cell = 0; cell < cellCount; cell += 1) {
    cellStart[cell + 1] += cellStart[cell];
  }

  const cursor = Int32Array.from(cellStart.subarray(0, cellCount));
  const sorted = new Float32Array(matrices.length);
  for (let offset = 0; offset < matrices.length; offset += 16) {
    const cx = cellCoordinate(matrices[offset + 12], minX, cellSize, dimX);
    const cy = cellCoordinate(matrices[offset + 13], minY, cellSize, dimY);
    const cz = cellCoordinate(matrices[offset + 14], minZ, cellSize, dimZ);
    const cell = (cz * dimY + cy) * dimX + cx;
    const base = cursor[cell] * 16;
    cursor[cell] += 1;
    // Element-wise rather than `set(subarray(...))`: a subarray view per
    // instance would allocate once per grass blade on every tile build.
    for (let component = 0; component < 16; component += 1) {
      sorted[base + component] = matrices[offset + component];
    }
  }

  return {
    cellSize,
    cellStart,
    dimX,
    dimY,
    dimZ,
    matrices: sorted,
    minX,
    minY,
    minZ,
    // One pair per (y, z) column of cells: x is the fastest-varying axis, so a
    // whole x-run is contiguous in `matrices` and needs a single range.
    rangeScratch: new Int32Array(dimY * dimZ * 2),
  };
}

/**
 * Fills `index.rangeScratch` with the float ranges of `index.matrices` that can
 * hold an instance within `radiusMeters` of a tile-local point, and returns how
 * many ranges were written.
 *
 * Ranges are conservative — the caller still applies the exact distance test —
 * but they exclude the bulk of a tile, and return 0 outright when the radius
 * misses the instance bounds entirely.
 */
export function collectGrassCandidateRanges(
  index: GrassSpatialIndex,
  localX: number,
  localY: number,
  localZ: number,
  radiusMeters: number,
): number {
  const { cellSize, dimX, dimY, dimZ, minX, minY, minZ } = index;
  const maxX = minX + dimX * cellSize;
  const maxY = minY + dimY * cellSize;
  const maxZ = minZ + dimZ * cellSize;
  // Clamping alone would silently pull an edge cell into range for a focus far
  // outside the tile, which is exactly the case worth rejecting outright.
  if (localX + radiusMeters < minX || localX - radiusMeters > maxX) return 0;
  if (localY + radiusMeters < minY || localY - radiusMeters > maxY) return 0;
  if (localZ + radiusMeters < minZ || localZ - radiusMeters > maxZ) return 0;

  const x0 = cellCoordinate(localX - radiusMeters, minX, cellSize, dimX);
  const x1 = cellCoordinate(localX + radiusMeters, minX, cellSize, dimX);
  const y0 = cellCoordinate(localY - radiusMeters, minY, cellSize, dimY);
  const y1 = cellCoordinate(localY + radiusMeters, minY, cellSize, dimY);
  const z0 = cellCoordinate(localZ - radiusMeters, minZ, cellSize, dimZ);
  const z1 = cellCoordinate(localZ + radiusMeters, minZ, cellSize, dimZ);

  const { cellStart, rangeScratch } = index;
  let pairs = 0;
  for (let cz = z0; cz <= z1; cz += 1) {
    for (let cy = y0; cy <= y1; cy += 1) {
      const rowBase = (cz * dimY + cy) * dimX;
      const start = cellStart[rowBase + x0];
      const end = cellStart[rowBase + x1 + 1];
      if (start === end) continue;
      rangeScratch[pairs * 2] = start * 16;
      rangeScratch[pairs * 2 + 1] = end * 16;
      pairs += 1;
    }
  }
  return pairs;
}
