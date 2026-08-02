import * as THREE from 'three';
import { StorageBufferAttribute } from 'three/webgpu';
import type { TileHeightRaster } from '../../../world/terrain-raster';
import type { Planet, TileInfo, Vec3 } from '../../../types';
import { tileKey } from '../domain/tile-info';
import { terrainSkirtDepthMeters } from '../domain/tile-vertex';
import { createTerrainGridGeometry } from './grid-geometry';
import {
  ATLAS_SLOT_COUNT,
  ATLAS_SLOT_NONE,
  createTerrainHeightAtlas,
  type TerrainHeightAtlas,
} from './height-atlas';
import {
  TILE_PARAM_STRIDE,
  createTerrainGridNodeMaterial,
} from './terrain-node-material';

/**
 * Draws every visible terrain tile as instances of one shared grid.
 *
 * Replaces per-tile geometry entirely: a tile is now sixteen floats in a params
 * buffer plus a slot in the height atlas. Bringing one online costs a buffer
 * write, not a `BufferGeometry`, three `BufferAttribute`s, a bounding-sphere
 * computation and a scene-graph insertion — and taking one offline costs a
 * slot release rather than a geometry dispose.
 *
 * Tiles also stop being separate draw calls. Two hundred draws collapse to one
 * instanced draw against one pipeline.
 */

const FACE_INDEX: Record<string, number> = {
  px: 0,
  nx: 1,
  py: 2,
  ny: 3,
  pz: 4,
  nz: 5,
};

/** Seconds a tile takes to blend from its parent's surface to its own. */
const GEOMORPH_SECONDS = 0.35;

export interface TerrainGridTile {
  info: TileInfo;
  key: string;
  /** Level delta to the neighbour across each edge: top, right, bottom, left. */
  edgeDeltas: readonly [number, number, number, number];
}

export interface TerrainGridRenderer {
  readonly object: THREE.Object3D;
  installTile(info: TileInfo, raster: TileHeightRaster, gridColors: Float32Array): void;
  releaseTile(info: TileInfo): void;
  hasTile(key: string): boolean;
  /**
   * Sets the tiles drawn this frame and advances their geomorph.
   *
   * `focus` is the planet-space position the tile group is centred on. Tile
   * centres are differenced against it here, in float64, because float32 cannot
   * hold a planet-radius coordinate to better than half a metre.
   */
  setVisibleTiles(
    tiles: readonly TerrainGridTile[],
    deltaSeconds: number,
    focus: Vec3,
  ): void;
  residentTiles(): number;
  dispose(): void;
}

export function createTerrainGridRenderer(planet: Planet): TerrainGridRenderer {
  const atlas: TerrainHeightAtlas = createTerrainHeightAtlas();
  const heights = new StorageBufferAttribute(atlas.heights, 1);
  const colors = new StorageBufferAttribute(atlas.colors, 4);
  const tileParams = new StorageBufferAttribute(
    new Float32Array(ATLAS_SLOT_COUNT * TILE_PARAM_STRIDE),
    1,
  );

  const geometry = createTerrainGridGeometry();
  const material = createTerrainGridNodeMaterial({
    heights,
    colors,
    tileParams,
    planetRadiusMeters: planet.radiusMeters,
  });

  const mesh = new THREE.Mesh(geometry, material);
  mesh.name = 'terrain-grid';
  // Positions come from the shader, so three cannot derive a meaningful bound
  // and must not try; visibility is decided by tile selection.
  mesh.frustumCulled = false;
  mesh.receiveShadow = true;
  mesh.castShadow = false;
  // Cancels the anchor the shader's per-instance offsets are relative to. The
  // tile group already sits at `-focus * scale`, so with the anchor equal to the
  // focus the two annihilate in float64 on the CPU and the GPU only ever sees
  // small numbers — the same reason per-tile meshes could carry an absolute
  // `mesh.position` and still render cleanly.
  mesh.position.set(0, 0, 0);
  // `InstancedBufferGeometry` defaults `instanceCount` to Infinity, which would
  // be handed straight to `drawIndexed` on any frame that renders before the
  // first selection lands.
  geometry.instanceCount = 0;
  mesh.visible = false;

  const params = tileParams.array as Float32Array;
  // Morph progress survives a tile leaving and re-entering the visible set, so
  // stepping back and forth across a boundary does not restart the blend.
  const morphByKey = new Map<string, number>();
  // Drives the atlas's reclaim order; advanced once per selection, not per
  // render pass, so a shadow pass cannot skew it.
  let frameNumber = 0;

  function writeTileParams(
    instance: number,
    tile: TerrainGridTile,
    morph: number,
    focus: Vec3,
    slot: number,
  ): void {
    const base = instance * TILE_PARAM_STRIDE;
    const { info } = tile;
    const parentKey =
      info.level > 0
        ? tileKey(info.face, info.level - 1, info.x >> 1, info.y >> 1)
        : null;
    params[base] = slot;
    params[base + 1] = parentKey ? atlas.slotFor(parentKey) : ATLAS_SLOT_NONE;
    params[base + 2] = morph;
    params[base + 3] = terrainSkirtDepthMeters(info);
    params[base + 4] = info.centerPosition.x - focus.x;
    params[base + 5] = info.centerPosition.y - focus.y;
    params[base + 6] = info.centerPosition.z - focus.z;
    params[base + 7] = FACE_INDEX[info.face] ?? 0;
    params[base + 8] = info.level;
    params[base + 9] = info.x;
    params[base + 10] = info.y;
    params[base + 11] = tile.edgeDeltas[0];
    params[base + 12] = tile.edgeDeltas[1];
    params[base + 13] = tile.edgeDeltas[2];
    params[base + 14] = tile.edgeDeltas[3];
    params[base + 15] = 0;
  }

  /**
   * Uploads only the atlas slots written since the last frame.
   *
   * Both buffers cover every resident tile, so a blanket `needsUpdate` would
   * push ~5 MB for a single arriving tile — several times a frame while
   * streaming.
   */
  function uploadAtlasWrites(): void {
    const dirty = atlas.consumeDirtyRanges();
    for (const range of dirty.heights) {
      heights.addUpdateRange(range.start, range.count);
    }
    for (const range of dirty.colors) {
      colors.addUpdateRange(range.start, range.count);
    }
    if (dirty.heights.length > 0) heights.needsUpdate = true;
    if (dirty.colors.length > 0) colors.needsUpdate = true;
  }

  return {
    object: mesh,
    installTile(info, raster, gridColors) {
      const key = tileKey(info.face, info.level, info.x, info.y);
      const slot = atlas.acquireSlot(key);
      if (slot === ATLAS_SLOT_NONE) return;
      atlas.writeHeights(slot, raster);
      atlas.writeColors(slot, gridColors);
    },
    releaseTile(info) {
      const key = tileKey(info.face, info.level, info.x, info.y);
      atlas.releaseSlot(key);
      morphByKey.delete(key);
    },
    hasTile(key) {
      return atlas.slotFor(key) !== ATLAS_SLOT_NONE;
    },
    setVisibleTiles(tiles, deltaSeconds, focus) {
      uploadAtlasWrites();
      frameNumber += 1;
      const step = GEOMORPH_SECONDS > 0 ? deltaSeconds / GEOMORPH_SECONDS : 1;
      let instance = 0;
      for (const tile of tiles) {
        if (instance >= ATLAS_SLOT_COUNT) break;
        const slot = atlas.slotFor(tile.key);
        if (slot === ATLAS_SLOT_NONE) continue;
        // Marks the slot live for this frame so the atlas never reclaims a page
        // out from under a tile that is about to be drawn.
        atlas.touchSlot(slot, frameNumber);
        // A tile with no resident parent has nothing to blend from, so it must
        // start fully refined rather than collapsing to a flat sphere.
        const parentKey =
          tile.info.level > 0
            ? tileKey(
                tile.info.face,
                tile.info.level - 1,
                tile.info.x >> 1,
                tile.info.y >> 1,
              )
            : null;
        const hasParent = parentKey != null && atlas.slotFor(parentKey) !== ATLAS_SLOT_NONE;
        const previous = morphByKey.get(tile.key) ?? (hasParent ? 0 : 1);
        const morph = Math.min(1, previous + step);
        morphByKey.set(tile.key, morph);
        writeTileParams(instance, tile, morph, focus, slot);
        instance += 1;
      }
      tileParams.needsUpdate = true;
      geometry.instanceCount = instance;
      mesh.visible = instance > 0;
      mesh.position.set(focus.x, focus.y, focus.z);
    },
    residentTiles() {
      return atlas.residentSlots();
    },
    dispose() {
      geometry.dispose();
      material.dispose();
      mesh.removeFromParent();
      atlas.clear();
      morphByKey.clear();
    },
  };
}
