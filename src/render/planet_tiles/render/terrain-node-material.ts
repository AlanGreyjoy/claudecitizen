import * as THREE from 'three';
import {
  MeshLambertNodeMaterial,
  type Node,
  type NodeBuilder,
  type StorageBufferAttribute,
} from 'three/webgpu';
import {
  Fn,
  clamp,
  diffuseColor,
  float,
  instanceIndex,
  int,
  mix,
  positionGeometry,
  sqrt,
  storage,
  varying,
  vec3,
  vec4,
} from 'three/tsl';
import { TILE_RASTER_SAMPLES } from '../../../world/terrain-raster';
import { TILE_SEGMENTS } from '../domain/constants';
import { TILE_VERTEX_WIDTH } from '../domain/tile-vertex';

/** Scalar node type; TSL's `Fn` needs its parameter tuple annotated. */
type FloatNode = ReturnType<typeof float>;

/**
 * Terrain material for the shared-grid path.
 *
 * The vertex stage is a transliteration of `domain/tile-vertex.ts`, which is
 * asserted against the CPU mesh builder in `npm run terrain:validate`. When
 * changing displacement, geomorph or edge-morph behaviour, change the pure
 * functions first, watch the assertion, then mirror it here — a GPU path has no
 * other way to be checked, and drift between the drawn surface and the sampled
 * one is exactly what breaks foot placement.
 *
 * Everything the shader reads that varies per tile lives in shared storage
 * buffers indexed by `instanceIndex`, never in per-mesh bindings. A per-mesh
 * binding would give each draw its own program cache key and therefore its own
 * synchronous pipeline compile.
 */

/** Floats per tile in the params buffer. Keep in sync with `writeTileParams`. */
export const TILE_PARAM_STRIDE = 16;

export interface TerrainNodeMaterialSources {
  /** Height per grid corner for every atlas slot. */
  heights: StorageBufferAttribute;
  /** Linear RGBA per grid corner for every atlas slot. */
  colors: StorageBufferAttribute;
  /** Per-instance tile parameters, `TILE_PARAM_STRIDE` floats each. */
  tileParams: StorageBufferAttribute;
  planetRadiusMeters: number;
}

/**
 * Terrain keeps its crushed-snow rescue: bright albedos ease toward a soft
 * moonlit grey only when lighting has flattened them to near black, never as a
 * constant emissive glow.
 */
class TerrainGridNodeMaterial extends MeshLambertNodeMaterial {
  override setupLighting(builder: NodeBuilder): Node {
    const terrainLit = super.setupLighting(builder);
    const terrainLitLum = terrainLit.r.max(terrainLit.g).max(terrainLit.b);
    const terrainAlbedoLum = diffuseColor.r.max(diffuseColor.g).max(diffuseColor.b);
    const terrainRescue = clamp(float(0.06).sub(terrainLitLum).mul(8), 0, 1)
      .mul(terrainAlbedoLum)
      .mul(terrainAlbedoLum)
      .mul(0.1);
    return terrainLit.add(diffuseColor.rgb.mul(terrainRescue));
  }
}

/**
 * Cube-face basis vectors, matching `cubeFaceBasis`. Face order is
 * CUBE_FACES / FACE_KEY_INDEX: px, nx, py, ny, pz, nz.
 */
const FACE_AXIS: readonly (readonly [number, number, number])[] = [
  [1, 0, 0],
  [-1, 0, 0],
  [0, 1, 0],
  [0, -1, 0],
  [0, 0, 1],
  [0, 0, -1],
];
const FACE_U_AXIS: readonly (readonly [number, number, number])[] = [
  [0, 0, -1],
  [0, 0, 1],
  [1, 0, 0],
  [1, 0, 0],
  [1, 0, 0],
  [-1, 0, 0],
];
const FACE_V_AXIS: readonly (readonly [number, number, number])[] = [
  [0, 1, 0],
  [0, 1, 0],
  [0, 0, -1],
  [0, 0, 1],
  [0, 1, 0],
  [0, 1, 0],
];

/** Picks one of the six per-face constants without branching. */
function faceSelector(table: readonly (readonly [number, number, number])[]) {
  return Fn(([face]: [FloatNode]) => {
    const selected = vec3(table[0][0], table[0][1], table[0][2]).toVar();
    for (let index = 1; index < table.length; index += 1) {
      const entry = table[index];
      selected.assign(
        mix(selected, vec3(entry[0], entry[1], entry[2]), face.equal(float(index))),
      );
    }
    return selected;
  });
}

export function createTerrainGridNodeMaterial(
  sources: TerrainNodeMaterialSources,
): MeshLambertNodeMaterial {
  const material = new TerrainGridNodeMaterial({
    dithering: true,
    // Exact per-triangle normals from screen-space derivatives of the view
    // position — no normal attribute, no vertex duplication, and correct across
    // the geomorph because it follows the position actually drawn. three's own
    // `flatShading` path does precisely this and does it in view space, which
    // `material.normalNode` would not.
    flatShading: true,
    side: THREE.FrontSide,
    vertexColors: false,
  });

  const heights = storage(sources.heights, 'float', sources.heights.count).toReadOnly();
  const colors = storage(sources.colors, 'vec4', sources.colors.count).toReadOnly();
  const params = storage(
    sources.tileParams,
    'float',
    sources.tileParams.count,
  ).toReadOnly();

  const paramBase = instanceIndex.mul(int(TILE_PARAM_STRIDE));
  const param = (offset: number) => params.element(paramBase.add(int(offset)));

  const atlasSlot = param(0);
  const parentSlot = param(1);
  const morph = param(2);
  const skirtDepth = param(3);
  // Tile centre relative to the frame's render anchor, differenced on the CPU in
  // float64. The absolute centre is ~6.37e6 m, which float32 resolves to half a
  // metre; the difference is a few kilometres at most, which it resolves to a
  // tenth of a millimetre.
  const centerOffset = vec3(param(4), param(5), param(6));
  const cubeFace = param(7);
  const tileLevel = param(8);
  const tileX = param(9);
  const tileY = param(10);
  const edgeDelta = vec4(param(11), param(12), param(13), param(14));

  /** Height at a grid corner of a given atlas slot; flat when unpaged. */
  const sampleHeight = Fn(
    ([slot, column, row]: [FloatNode, FloatNode, FloatNode]) => {
      const clampedColumn = clamp(column, 0, float(TILE_SEGMENTS));
      const clampedRow = clamp(row, 0, float(TILE_SEGMENTS));
      const index = clampedRow.mul(float(TILE_VERTEX_WIDTH)).add(clampedColumn);
      // `ATLAS_SLOT_NONE` is -1, which would index the buffer negatively. The
      // caller multiplies an unpaged slot's result out, so any in-range slot
      // will do; what matters is not handing WGSL an out-of-bounds index.
      const offset = slot.max(float(0)).mul(float(TILE_RASTER_SAMPLES)).add(index);
      return heights.element(int(offset));
    },
  );

  /**
   * Edge morph, mirroring `edgeMorphedHeight`.
   *
   * A coarser neighbour resolves the shared edge with half the vertices, so its
   * surface there is the straight run between our even corners. Odd vertices
   * interpolate onto it; even ones are shared exactly and keep their height.
   */
  const applyEdgeMorph = Fn(
    ([slot, column, row, current, delta, along, isOnEdge, isHorizontal]: [
      FloatNode,
      FloatNode,
      FloatNode,
      FloatNode,
      FloatNode,
      FloatNode,
      FloatNode,
      FloatNode,
    ]) => {
      const stride = float(2).pow(delta);
      const lower = along.div(stride).floor().mul(stride);
      const upper = lower.add(stride).min(float(TILE_SEGMENTS));
      const span = upper.sub(lower).max(float(1e-6));
      const t = along.sub(lower).div(span);
      // `isHorizontal` picks which axis walks the edge; the other axis is
      // pinned to the vertex's own coordinate.
      const lowColumn = mix(column, lower, isHorizontal);
      const lowRow = mix(lower, row, isHorizontal);
      const highColumn = mix(column, upper, isHorizontal);
      const highRow = mix(upper, row, isHorizontal);
      const blended = mix(
        sampleHeight(slot, lowColumn, lowRow),
        sampleHeight(slot, highColumn, highRow),
        t,
      );
      return mix(
        current,
        blended,
        isOnEdge.mul(delta.greaterThan(float(0)).toFloat()),
      );
    },
  );

  const selectFaceAxis = faceSelector(FACE_AXIS);
  const selectFaceUAxis = faceSelector(FACE_U_AXIS);
  const selectFaceVAxis = faceSelector(FACE_V_AXIS);

  // `position` carries vertex identity, not a position: column, row, and the
  // skirt edge (0 for surface vertices). See `grid-geometry.ts`.
  const column = positionGeometry.x;
  const row = positionGeometry.y;
  const isSkirt = positionGeometry.z.greaterThan(float(0)).toFloat();

  // Apply each of the four edges in turn. A corner vertex sits on two edges and
  // is folded by both, which is correct: it is shared with both neighbours.
  const onTop = row.equal(float(0)).toFloat();
  const onRight = column.equal(float(TILE_SEGMENTS)).toFloat();
  const onBottom = row.equal(float(TILE_SEGMENTS)).toFloat();
  const onLeft = column.equal(float(0)).toFloat();
  const rawHeight = sampleHeight(atlasSlot, column, row);
  const afterTop = applyEdgeMorph(
    atlasSlot, column, row, rawHeight, edgeDelta.x, column, onTop, float(1),
  );
  const afterRight = applyEdgeMorph(
    atlasSlot, column, row, afterTop, edgeDelta.y, row, onRight, float(0),
  );
  const afterBottom = applyEdgeMorph(
    atlasSlot, column, row, afterRight, edgeDelta.z, column, onBottom, float(1),
  );
  const ownHeight = applyEdgeMorph(
    atlasSlot, column, row, afterBottom, edgeDelta.w, row, onLeft, float(0),
  );
  // Parent covers twice the span at the same segment count, so this tile's
  // corner sits at half the parent's grid coordinate, offset by which half of
  // the parent this tile occupies.
  const parentColumn = column.mul(0.5).add(tileX.mod(float(2)).mul(float(TILE_SEGMENTS * 0.5)));
  const parentRow = row.mul(0.5).add(tileY.mod(float(2)).mul(float(TILE_SEGMENTS * 0.5)));
  const parentHeight = sampleHeight(parentSlot, parentColumn, parentRow);
  const hasParent = parentSlot.greaterThanEqual(float(0)).toFloat();
  const blendedHeight = mix(
    ownHeight,
    mix(parentHeight, ownHeight, clamp(morph, 0, 1)),
    hasParent,
  );

  // Transliteration of `tileVertexRelativePosition`. Read its comment before
  // touching any of this: the ordering is what keeps the planet radius from
  // multiplying a float32 rounding error into half a metre of vertex jitter.
  const axis = selectFaceAxis(cubeFace);
  const uAxis = selectFaceUAxis(cubeFace);
  const vAxis = selectFaceVAxis(cubeFace);

  const cellsPerFace = float(2).pow(tileLevel).mul(float(TILE_SEGMENTS));
  const half = float(TILE_SEGMENTS * 0.5);
  const centerU = float(-1).add(
    tileX.mul(float(TILE_SEGMENTS)).add(half).mul(2).div(cellsPerFace),
  );
  const centerV = float(-1).add(
    tileY.mul(float(TILE_SEGMENTS)).add(half).mul(2).div(cellsPerFace),
  );
  const deltaU = column.sub(half).mul(2).div(cellsPerFace);
  const deltaV = row.sub(half).mul(2).div(cellsPerFace);

  const centerCube = axis.add(uAxis.mul(centerU)).add(vAxis.mul(centerV));
  const cubeOffset = uAxis.mul(deltaU).add(vAxis.mul(deltaV));

  const lengthSquared = centerCube.dot(centerCube);
  const inverseLength = lengthSquared.inverseSqrt();
  const s = centerCube
    .dot(cubeOffset)
    .mul(2)
    .add(cubeOffset.dot(cubeOffset))
    .div(lengthSquared);
  const r = sqrt(float(1).add(s));
  const q = r.reciprocal();
  // Algebraically `q - 1`, but written so it never subtracts two near-equal
  // numbers: `s = (r - 1)(r + 1)`, so this is exact where the direct form is
  // pure cancellation.
  const qMinusOne = s.negate().div(r.mul(r.add(1)));

  const centerDirection = centerCube.mul(inverseLength);
  const deltaDirection = centerCube
    .mul(qMinusOne)
    .add(cubeOffset.mul(q))
    .mul(inverseLength);
  const direction = centerDirection.add(deltaDirection);
  const surfaceRelative = deltaDirection
    .mul(float(sources.planetRadiusMeters))
    .add(direction.mul(blendedHeight));

  // Skirt vertices drop radially from their surface corner, mirroring
  // `tileSkirtPosition` — but only on edges that still need covering.
  //
  // An edge whose delta is exactly 0 has a same-level, same-face neighbour in
  // this frame's rendered set, so the seam is already closed: `terrain:validate`
  // measures that contact at 0.1 mm at L17 and 2 mm at L8, orders of magnitude
  // below a pixel. Its skirt can never be seen, and on an interior tile that is
  // all four of them — a third of the grid's triangles drawn for nothing.
  //
  // Leaving the vertices at their surface corner collapses those quads into
  // degenerate triangles, which rasterise no fragments. The index buffer,
  // vertex count and identity attribute are untouched, so the shared grid and
  // the disk cache both stay valid: this needs no `TERRAIN_CACHE_VERSION` bump.
  //
  // Every other case keeps its full-depth wall. `EDGE_NEIGHBOUR_ABSENT` (-1)
  // covers cross-face edges, neighbours past the search bound, and tiles that
  // are culled or still building; a positive delta is a coarser neighbour,
  // where the morph closes the active contact but the skirt is what covers the
  // moment before it does.
  const skirtEdgeIndex = positionGeometry.z.sub(float(1));
  const ownEdgeDelta = edgeDelta.x
    .mul(skirtEdgeIndex.equal(float(0)).toFloat())
    .add(edgeDelta.y.mul(skirtEdgeIndex.equal(float(1)).toFloat()))
    .add(edgeDelta.z.mul(skirtEdgeIndex.equal(float(2)).toFloat()))
    .add(edgeDelta.w.mul(skirtEdgeIndex.equal(float(3)).toFloat()));
  const skirtDrop = isSkirt.mul(ownEdgeDelta.notEqual(float(0)).toFloat());
  const skirted = surfaceRelative.sub(direction.mul(skirtDepth).mul(skirtDrop));

  // The shared grid is one mesh for every tile, so the tile centre the legacy
  // path carried in `mesh.position` has to be added here instead.
  material.positionNode = skirted.add(centerOffset);

  // Flat per-triangle colour without duplicating vertices: `@interpolate(flat)`
  // takes the provoking vertex's value, which is what the non-indexed mesh used
  // to achieve by writing the same colour to all three corners.
  const cornerIndex = row
    .mul(float(TILE_VERTEX_WIDTH))
    .add(column)
    .add(atlasSlot.mul(float(TILE_RASTER_SAMPLES)));
  const albedo = colors.element(int(cornerIndex)).xyz;
  // Skirts are crack covers seen edge-on; darkening them keeps a briefly
  // exposed wall from reading as a bright cliff.
  const shaded = albedo.mul(mix(float(1), float(0.36), isSkirt));
  material.colorNode = varying(shaded, 'vTerrainColor').setInterpolation('flat');

  return material;
}
