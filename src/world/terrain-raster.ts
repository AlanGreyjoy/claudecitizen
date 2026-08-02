import { directionFromCubeFace } from './cube-sphere';
import { sampleSurfaceHeightDetails, type SurfaceHeightDetails } from './elevation';
import { RENDER_SURFACE_SEGMENTS } from './renderable-surface-constants';
// Function import only — hoisted, so it stays safe across the module cycle that
// `renderable-surface.ts` forms by importing the page table back.
import { renderableGridSampleSpacingMeters } from './renderable-surface';
import type { CubeFace, Planet, Vec3 } from '../types';

/**
 * Band-limited height field for one tile, materialized on the grid the whole
 * engine already agrees on.
 *
 * `renderableGridPoint` resolves every foot placement, vegetation probe and
 * water sample by evaluating `sampleSurfaceHeightDetails` at integer grid
 * coordinates for a level, and `buildTerrainGrid` evaluates the *same* function
 * at the *same* coordinates with the *same* band limit to build the mesh. The
 * two ran independently — the worker computed a tile's 625 corners, threw them
 * away after writing vertex buffers, and the main thread then recomputed all
 * 625 to answer foot and vegetation queries.
 *
 * A raster is that shared computation, kept. The worker emits one, the page
 * table installs it, and the samplers read it instead of re-deriving it. Mesh
 * and foot placement then agree because they are reading the same numbers, not
 * because two code paths were kept in sync by hand.
 */

/** Grid corners along one tile edge — one more than the cell count. */
export const TILE_RASTER_WIDTH = RENDER_SURFACE_SEGMENTS + 1;
export const TILE_RASTER_SAMPLES = TILE_RASTER_WIDTH * TILE_RASTER_WIDTH;

/**
 * Channel layout. Float64 rather than a packed integer format on purpose: this
 * has to reproduce `sampleSurfaceHeightDetails` bit-for-bit, because the
 * terrain validator asserts mesh-vs-foot agreement down to ~1e-9 m and any
 * quantization here would show up there as a regression. Quantization belongs
 * with the GPU-side raster, where the consumer is a texture.
 */
export const RASTER_CHANNEL_COUNT = 6;
const CHANNEL_HEIGHT = 0;
const CHANNEL_LAKE_MASK = 1;
const CHANNEL_MOUNTAIN_REGION = 2;
const CHANNEL_PRE_RIVER_ELEVATION = 3;
const CHANNEL_RIVER_STRENGTH = 4;
const CHANNEL_RIVER_WATER_LEVEL = 5;

export interface TileHeightRaster {
  face: CubeFace;
  level: number;
  /** Tile coordinates; grid origin is `x * RENDER_SURFACE_SEGMENTS`. */
  x: number;
  y: number;
  /** Interleaved `RASTER_CHANNEL_COUNT` channels per grid corner, row-major. */
  samples: Float64Array;
  /** Height envelope, for skirt depth and water/collider culling. */
  minHeightMeters: number;
  maxHeightMeters: number;
}

/**
 * `riverStrength` is `number | undefined` and `riverWaterLevelNormalized` is
 * `number | null | undefined`; both distinctions are load-bearing in
 * `interpolateHeightDetails` (a single absent corner disables river strength
 * for the whole cell, and absent water levels are excluded from the weighted
 * average rather than counted as zero). NaN round-trips through Float64Array
 * and structured clone, so it carries "absent" without a parallel mask array.
 */
function encodeOptional(value: number | null | undefined): number {
  return value == null ? Number.NaN : value;
}

export function rasterSampleIndex(column: number, row: number): number {
  return (row * TILE_RASTER_WIDTH + column) * RASTER_CHANNEL_COUNT;
}

export function readRasterHeight(raster: TileHeightRaster, offset: number): number {
  return raster.samples[offset + CHANNEL_HEIGHT];
}

/** Rebuilds the exact `SurfaceHeightDetails` the sampler would have produced. */
export function readRasterDetails(
  raster: TileHeightRaster,
  offset: number,
): SurfaceHeightDetails {
  const { samples } = raster;
  const riverStrength = samples[offset + CHANNEL_RIVER_STRENGTH];
  const riverWaterLevel = samples[offset + CHANNEL_RIVER_WATER_LEVEL];
  return {
    heightMeters: samples[offset + CHANNEL_HEIGHT],
    lakeMask: samples[offset + CHANNEL_LAKE_MASK],
    mountainRegion: samples[offset + CHANNEL_MOUNTAIN_REGION],
    preRiverElevationNormalized: samples[offset + CHANNEL_PRE_RIVER_ELEVATION],
    riverStrength: Number.isNaN(riverStrength) ? undefined : riverStrength,
    riverWaterLevelNormalized: Number.isNaN(riverWaterLevel) ? null : riverWaterLevel,
  };
}

/**
 * Whether a tile could contain any water surface. Conservative: `true` means
 * "build and find out", `false` is a proof that there is nothing to draw.
 *
 * Water tiles were built for *every* selected tile, each paying a full
 * `TILE_RASTER_SAMPLES` grid through a single serialised worker, even where the
 * terrain is nowhere near a water level. Most tiles on a continent are dry, and
 * the raster's height envelope settles that without reading a sample.
 *
 * Both standing-water tables are planet-wide constants — the ocean level, and
 * the inland lake plane, which is the authored lowland ceiling reused so that
 * classification, shoreline generation and rendering agree exactly. So terrain
 * whose lowest corner sits above the higher of the two, plus the shore padding
 * the mesh builder adds, cannot hold either.
 *
 * Rivers are the exception: they carry their own per-corner water level and can
 * run well above both tables, so those channels are still scanned. An early
 * version tested `lakeMask` instead of the envelope and was wrong — lakes also
 * arise from the `wetLowland` path, where the mask is below its threshold, so
 * it skipped real lake tiles. `terrain:validate` asserts against that.
 */
export function rasterMayContainWater(
  raster: TileHeightRaster,
  highestStandingWaterLevelMeters: number,
  shorePaddingMeters: number,
): boolean {
  if (
    raster.minHeightMeters <
    highestStandingWaterLevelMeters + shorePaddingMeters
  ) {
    return true;
  }
  const { samples } = raster;
  for (let offset = 0; offset < samples.length; offset += RASTER_CHANNEL_COUNT) {
    const riverStrength = samples[offset + CHANNEL_RIVER_STRENGTH];
    if (!Number.isNaN(riverStrength) && riverStrength > 0) return true;
    if (!Number.isNaN(samples[offset + CHANNEL_RIVER_WATER_LEVEL])) return true;
  }
  return false;
}

function writeRasterSample(
  samples: Float64Array,
  offset: number,
  details: SurfaceHeightDetails,
): void {
  samples[offset + CHANNEL_HEIGHT] = details.heightMeters;
  samples[offset + CHANNEL_LAKE_MASK] = details.lakeMask;
  samples[offset + CHANNEL_MOUNTAIN_REGION] = details.mountainRegion;
  samples[offset + CHANNEL_PRE_RIVER_ELEVATION] = details.preRiverElevationNormalized;
  samples[offset + CHANNEL_RIVER_STRENGTH] = encodeOptional(details.riverStrength);
  samples[offset + CHANNEL_RIVER_WATER_LEVEL] = encodeOptional(
    details.riverWaterLevelNormalized,
  );
}

/**
 * Grid coordinate of a tile's raster origin. Grid coordinates are global across
 * a cube face at a given level, which is what lets a neighbouring tile's raster
 * answer for the shared edge column with identical values.
 */
export function rasterGridOriginX(x: number): number {
  return x * RENDER_SURFACE_SEGMENTS;
}

export function rasterGridOriginY(y: number): number {
  return y * RENDER_SURFACE_SEGMENTS;
}

export interface TileRasterCoordinates {
  face: CubeFace;
  level: number;
  x: number;
  y: number;
}

/**
 * Evaluates the band-limited field over a tile's grid corners.
 *
 * Mirrors `renderableGridPoint`'s coordinate math exactly — the same
 * `-1 + gridCoordinate * 2 / cellsPerFace` parameterisation and the same
 * per-level `sampleSpacingMeters`. Do not "simplify" this to the tile-bounds
 * interpolation used elsewhere: the two are algebraically equal but not
 * bit-equal, and the difference lands directly in the mesh-vs-foot budget.
 */
export function buildTileHeightRaster(
  coordinates: TileRasterCoordinates,
  planet: Planet,
  seed: number,
): TileHeightRaster {
  const { face, level, x, y } = coordinates;
  const samples = new Float64Array(TILE_RASTER_SAMPLES * RASTER_CHANNEL_COUNT);
  const cellsPerFace = 2 ** level * RENDER_SURFACE_SEGMENTS;
  // One options object and one band limit for the whole tile: every vertex a
  // tile introduces must share the octave cutoff or the field grows spikes.
  const sampleOptions = {
    sampleSpacingMeters: renderableGridSampleSpacingMeters(planet, level),
  };
  const samplePosition: Vec3 = { x: 0, y: 0, z: 0 };
  const originX = rasterGridOriginX(x);
  const originY = rasterGridOriginY(y);

  let minHeightMeters = Number.POSITIVE_INFINITY;
  let maxHeightMeters = Number.NEGATIVE_INFINITY;
  let offset = 0;
  for (let row = 0; row < TILE_RASTER_WIDTH; row += 1) {
    const v = -1 + ((originY + row) * 2) / cellsPerFace;
    for (let column = 0; column < TILE_RASTER_WIDTH; column += 1) {
      const u = -1 + ((originX + column) * 2) / cellsPerFace;
      const direction = directionFromCubeFace(face, u, v);
      samplePosition.x = direction.x * planet.radiusMeters;
      samplePosition.y = direction.y * planet.radiusMeters;
      samplePosition.z = direction.z * planet.radiusMeters;
      const details = sampleSurfaceHeightDetails(
        planet,
        seed,
        samplePosition,
        sampleOptions,
      );
      writeRasterSample(samples, offset, details);
      if (details.heightMeters < minHeightMeters) minHeightMeters = details.heightMeters;
      if (details.heightMeters > maxHeightMeters) maxHeightMeters = details.heightMeters;
      offset += RASTER_CHANNEL_COUNT;
    }
  }

  return {
    face,
    level,
    x,
    y,
    samples,
    minHeightMeters,
    maxHeightMeters,
  };
}

export function isValidTileHeightRaster(
  raster: TileHeightRaster | null | undefined,
): raster is TileHeightRaster {
  return (
    !!raster &&
    raster.samples instanceof Float64Array &&
    raster.samples.length === TILE_RASTER_SAMPLES * RASTER_CHANNEL_COUNT
  );
}
