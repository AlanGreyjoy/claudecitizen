import {
  RASTER_CHANNEL_COUNT,
  TILE_RASTER_SAMPLES,
  readRasterHeight,
  type TileHeightRaster,
} from '../../../world/terrain-raster';
import { MAX_CACHED_TILES, TILE_CACHE_ACTIVE_HEADROOM } from '../domain/constants';

/**
 * GPU-visible height and colour pages for every resident terrain tile.
 *
 * One buffer for all tiles, not one per tile. That matters for more than
 * memory: a node graph that references a per-mesh binding gets a unique program
 * cache key (`Node.customCacheKey` returns the node id), so per-tile buffers
 * would mean per-tile shader compiles — the same trap that made streaming
 * vegetation hitch. A single shared buffer keeps terrain on exactly one
 * pipeline no matter how many tiles are live.
 *
 * Storage buffers rather than a texture array because vertices land exactly on
 * grid corners: there is nothing to filter, so the sampling hardware buys
 * nothing and the format constraints of array textures cost something.
 *
 * One buffer for everything does mean a naive upload rewrites the whole thing
 * for a single tile, so writes record the slot they touched and the renderer
 * turns those into update ranges. Without that, installing one tile would push
 * ~5 MB across the bus.
 */

/**
 * Slots are recycled, so this bounds *resident* tiles, not tiles ever seen.
 *
 * It must exceed the mesh cache's own ceiling, which is not `MAX_CACHED_TILES`
 * but `max(MAX_CACHED_TILES, selectedTiles + TILE_CACHE_ACTIVE_HEADROOM)` —
 * sizing the atlas to `MAX_CACHED_TILES` meant it ran dry during normal play and
 * ready tiles silently lost their pages. At ~12.5 KB per slot this is ~13 MB of
 * GPU buffer, which is cheap next to a hole in the ground. If that ever needs
 * cutting, pack the colours to one RGBA8 `u32` per corner instead of a `vec4`
 * — that is four fifths of the total.
 */
export const ATLAS_SLOT_COUNT = MAX_CACHED_TILES * 2 + TILE_CACHE_ACTIVE_HEADROOM * 2;
/** Sentinel for "this tile has no page"; the shader falls back to flat. */
export const ATLAS_SLOT_NONE = -1;

/** Colour components per grid corner. WGSL storage arrays align vec3 to 16 anyway. */
const COLOR_COMPONENTS = 4;

export interface AtlasDirtyRange {
  /** First array element written, inclusive. */
  start: number;
  /** Element count written. */
  count: number;
}

export interface TerrainHeightAtlas {
  /** `ATLAS_SLOT_COUNT * TILE_RASTER_SAMPLES` heights, in metres. */
  readonly heights: Float32Array;
  /** Matching linear RGBA per grid corner. */
  readonly colors: Float32Array;
  /** Slot ranges written since the last call, then cleared. */
  consumeDirtyRanges(): { heights: AtlasDirtyRange[]; colors: AtlasDirtyRange[] };
  acquireSlot(key: string): number;
  releaseSlot(key: string): void;
  slotFor(key: string): number;
  /** Marks a slot as drawn this frame so it is not the one reclaimed. */
  touchSlot(slot: number, frameNumber: number): void;
  writeHeights(slot: number, raster: TileHeightRaster): void;
  writeColors(slot: number, gridColors: Float32Array): void;
  residentSlots(): number;
  clear(): void;
}

export function createTerrainHeightAtlas(): TerrainHeightAtlas {
  const heights = new Float32Array(ATLAS_SLOT_COUNT * TILE_RASTER_SAMPLES);
  const colors = new Float32Array(
    ATLAS_SLOT_COUNT * TILE_RASTER_SAMPLES * COLOR_COMPONENTS,
  );
  const slotByKey = new Map<string, number>();
  const keyBySlot: (string | null)[] = new Array(ATLAS_SLOT_COUNT).fill(null);
  const lastDrawnFrame = new Int32Array(ATLAS_SLOT_COUNT).fill(-1);
  const freeSlots: number[] = [];
  for (let slot = ATLAS_SLOT_COUNT - 1; slot >= 0; slot -= 1) freeSlots.push(slot);
  let currentFrame = 0;
  let reportedFull = false;

  // Slot indices rather than element ranges: a tile writes one contiguous slot
  // in each buffer, and coalescing at slot granularity keeps the range list
  // short when several tiles land in the same frame.
  const dirtyHeightSlots = new Set<number>();
  const dirtyColorSlots = new Set<number>();

  /** Oldest slot not drawn this frame, or `ATLAS_SLOT_NONE` if all are live. */
  function reclaimStalestSlot(): number {
    let victim = ATLAS_SLOT_NONE;
    let oldest = currentFrame;
    for (let slot = 0; slot < ATLAS_SLOT_COUNT; slot += 1) {
      if (lastDrawnFrame[slot] >= oldest) continue;
      oldest = lastDrawnFrame[slot];
      victim = slot;
    }
    if (victim === ATLAS_SLOT_NONE) return ATLAS_SLOT_NONE;
    const key = keyBySlot[victim];
    if (key !== null) slotByKey.delete(key);
    keyBySlot[victim] = null;
    return victim;
  }

  function toRanges(slots: Set<number>, elementsPerSlot: number): AtlasDirtyRange[] {
    if (slots.size === 0) return [];
    const ordered = [...slots].sort((a, b) => a - b);
    const ranges: AtlasDirtyRange[] = [];
    let runStart = ordered[0];
    let runEnd = ordered[0];
    for (let index = 1; index < ordered.length; index += 1) {
      if (ordered[index] === runEnd + 1) {
        runEnd = ordered[index];
        continue;
      }
      ranges.push({
        start: runStart * elementsPerSlot,
        count: (runEnd - runStart + 1) * elementsPerSlot,
      });
      runStart = ordered[index];
      runEnd = ordered[index];
    }
    ranges.push({
      start: runStart * elementsPerSlot,
      count: (runEnd - runStart + 1) * elementsPerSlot,
    });
    slots.clear();
    return ranges;
  }

  return {
    heights,
    colors,
    consumeDirtyRanges() {
      return {
        heights: toRanges(dirtyHeightSlots, TILE_RASTER_SAMPLES),
        colors: toRanges(dirtyColorSlots, TILE_RASTER_SAMPLES * COLOR_COMPONENTS),
      };
    },
    acquireSlot(key) {
      const existing = slotByKey.get(key);
      if (existing !== undefined) return existing;
      let slot = freeSlots.pop();
      if (slot === undefined) {
        // Reclaim the slot drawn longest ago rather than refusing the tile.
        // Refusing leaves a ready tile with no page, and the manager skips
        // tiles it cannot draw — so the failure mode is a hole in the ground
        // that persists until the cache evicts the entry.
        slot = reclaimStalestSlot();
      }
      if (slot === ATLAS_SLOT_NONE) {
        // Only reachable if every slot was drawn this very frame, which means
        // the atlas is genuinely smaller than the visible set.
        if (!reportedFull) {
          reportedFull = true;
          console.warn(
            `ClaudeCitizen terrain height atlas exhausted at ${ATLAS_SLOT_COUNT} slots;` +
              ' raise ATLAS_SLOT_COUNT. Further occurrences suppressed.',
          );
        }
        return ATLAS_SLOT_NONE;
      }
      slotByKey.set(key, slot);
      keyBySlot[slot] = key;
      lastDrawnFrame[slot] = currentFrame;
      return slot;
    },
    touchSlot(slot, frameNumber) {
      currentFrame = frameNumber;
      if (slot >= 0) lastDrawnFrame[slot] = frameNumber;
    },
    releaseSlot(key) {
      const slot = slotByKey.get(key);
      if (slot === undefined) return;
      slotByKey.delete(key);
      keyBySlot[slot] = null;
      lastDrawnFrame[slot] = -1;
      freeSlots.push(slot);
    },
    slotFor(key) {
      return slotByKey.get(key) ?? ATLAS_SLOT_NONE;
    },
    writeHeights(slot, raster) {
      if (slot < 0) return;
      const base = slot * TILE_RASTER_SAMPLES;
      for (let index = 0; index < TILE_RASTER_SAMPLES; index += 1) {
        // Raster samples are interleaved by channel; height is channel 0.
        heights[base + index] = readRasterHeight(
          raster,
          index * RASTER_CHANNEL_COUNT,
        );
      }
      dirtyHeightSlots.add(slot);
    },
    writeColors(slot, gridColors) {
      if (slot < 0) return;
      const base = slot * TILE_RASTER_SAMPLES * COLOR_COMPONENTS;
      for (let index = 0; index < TILE_RASTER_SAMPLES; index += 1) {
        const source = index * 3;
        const target = base + index * COLOR_COMPONENTS;
        colors[target] = gridColors[source];
        colors[target + 1] = gridColors[source + 1];
        colors[target + 2] = gridColors[source + 2];
        colors[target + 3] = 1;
      }
      dirtyColorSlots.add(slot);
    },
    residentSlots() {
      return slotByKey.size;
    },
    clear() {
      slotByKey.clear();
      keyBySlot.fill(null);
      freeSlots.length = 0;
      for (let slot = ATLAS_SLOT_COUNT - 1; slot >= 0; slot -= 1) freeSlots.push(slot);
      lastDrawnFrame.fill(-1);
      heights.fill(0);
      colors.fill(0);
      dirtyHeightSlots.clear();
      dirtyColorSlots.clear();
    },
  };
}
