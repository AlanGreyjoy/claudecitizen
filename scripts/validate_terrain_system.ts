import assert from 'node:assert/strict';
import { performance } from 'node:perf_hooks';
import { normalize } from '../src/math/vec3';
import {
  SHORE_PADDING_METERS,
  buildSurfaceWaterGeometry,
} from '../src/render/effects/lake_water/build/buffers';
import { buildTerrainTileBuffers } from '../src/render/planet_tiles/build/terrain-buffers';
import { createTileMeshCache } from '../src/render/planet_tiles/cache/mesh-cache';
import { isValidTerrainTileBuffers } from '../src/render/planet_tiles/domain/buffer-validation';
import {
  TERRAIN_PACKED_COMPONENTS,
  TERRAIN_SKIRT_VERTICES_PER_SEGMENT,
  MAX_FALLBACK_SUPPRESSION_LEVELS,
  TERRAIN_SKIRT_MIN_DEPTH_METERS,
  TERRAIN_SURFACE_VERTEX_COUNT,
  TILE_SEGMENTS,
} from '../src/render/planet_tiles/domain/constants';
import {
  EDGE_NEIGHBOUR_ABSENT,
  resolveEdgeDeltas,
} from '../src/render/planet_tiles/domain/edge-deltas';
import {
  retainFallbackAncestors,
  selectedTileAncestorLevel,
} from '../src/render/planet_tiles/domain/tile-coverage';
import {
  cubeFaceBasis,
  edgeMorphedHeight,
  geomorphHeight,
  tileEdgeMask,
  tileVertexPosition,
  tileVertexRelativePosition,
} from '../src/render/planet_tiles/domain/tile-vertex';
import { visitSelectedTiles } from '../src/render/planet_tiles/domain/selection';
import {
  makeTileInfo,
  parentTileInfo,
  tileKey,
} from '../src/render/planet_tiles/domain/tile-info';
import { createTerrainGridRenderer } from '../src/render/planet_tiles/render/terrain-grid-renderer';
import type {
  CubeFace,
  SurfaceWaterBuffers,
  TerrainTileBuffers,
  TileInfo,
  Vec3,
  WaterBody,
} from '../src/types';
import { findSurfaceDestination } from '../src/world/biome-teleport';
import { sampleSurfaceClimate } from '../src/world/climate';
import {
  OCEAN_WATER_LEVEL_METERS,
  oceanWaterLevelMeters,
} from '../src/world/coastal-profile';
import { lakeWaterTableNormalized } from '../src/world/lakes';
import { cartesianFromLatLonAlt } from '../src/world/coordinates';
import {
  CUBE_FACES,
  directionFromCubeFace,
  faceUvFromDirection,
} from '../src/world/cube-sphere';
import { sampleSurfaceHeightDetails } from '../src/world/elevation';
import {
  CLAUDECITIZEN_PLANET,
  DEFAULT_PLANET_SEED,
} from '../src/world/planets/runtime';
import {
  RENDER_SURFACE_LEVEL,
  RENDER_SURFACE_SEGMENTS,
  renderableCellSampleSpacingMeters,
  renderableGridSampleSpacingMeters,
  resetRenderableHeightCache,
  sampleRenderableSurfaceHeight,
  sampleVisibleSurfaceFrame,
} from '../src/world/renderable-surface';
import { clearHeightPages, installHeightPage } from '../src/world/terrain-pages';
import {
  buildTileHeightRaster,
  isValidTileHeightRaster,
  rasterMayContainWater,
  rasterSampleIndex,
  readRasterDetails,
  readRasterHeight,
} from '../src/world/terrain-raster';
import { getRiverNetworkDiagnostics } from '../src/world/rivers';
import { terrainCellUsesNorthwestSoutheastDiagonal } from '../src/world/terrain-triangulation';

interface EdgeContact {
  axis: 'u' | 'v';
  edgeA: number;
  edgeB: number;
}

interface EdgeSampleLocation {
  coordinate: number;
  edgeIndex: number;
  parameterEnd: number;
  parameterStart: number;
  sideOffset?: 0 | 6;
}

interface CubeBoundaryEdge {
  edge: number;
  id: string;
  parameterEnd: number;
  parameterStart: number;
}

interface MeasuredEdgeContact {
  coarse: TileInfo;
  coarseEdgeIndex: number;
  coarseParameterEnd: number;
  coarseParameterStart: number;
  fine: TileInfo;
  fineEdgeIndex: number;
  fineParameterEnd: number;
  fineParameterStart: number;
}

interface SameLodSeamComparison {
  left: TileInfo;
  leftEdgeIndex: number;
  leftParameterEnd: number;
  leftParameterStart: number;
  right: TileInfo;
  rightEdgeIndex: number;
  rightParameterEnd: number;
  rightParameterStart: number;
}

interface SameLodBoundaryCandidate {
  descriptor: CubeBoundaryEdge;
  edgeIndex: number;
  info: TileInfo;
}

interface MeshTriangleSample {
  triangle: 0 | 1;
  weights: readonly [number, number, number];
}

interface TerrainValidationSummary {
  coastTeleportHeightMeters: number;
  coastTeleportOceanNeighbors: number;
  coastTeleportReliefMeters: number;
  coastTeleportWaterDepthMeters: number;
  coastWaterGeometryVertices: number;
  maxCoastWaterSurfaceLevelErrorMeters: number;
  coldCacheFallbackLevel: number;
  fallbackChainMinimumLevel: number;
  finestSelectedTiles: number;
  finestSkirtDepthMeters: number;
  finestTriangleSpanMeters: number;
  heightPageCheckedCorners: number;
  heightPageCheckedProbes: number;
  worstFallbackLevelGap: number;
  maxVertexPositionErrorMeters: number;
  maxEdgeMorphErrorMeters: number;
  maxFloat32VertexErrorMeters: number;
  naiveFloat32VertexErrorMeters: number;
  horizonTileCounts: number[];
  highlandProbeHeightMeters: number;
  highlandSelectedLevel: number;
  highlandSelectedTiles: number;
  hydrology: ReturnType<typeof getRiverNetworkDiagnostics>;
  lakeSurfaceLevelMeters: number;
  lakeSurfaceSamples: number;
  lakeUnderlyingBiome: string;
  maxLakeSurfStrength: number;
  maxLakeSurfaceLevelErrorMeters: number;
  maxMixedLodGapToSkirtRatio: number;
  /** Which contact produced the worst ratio — the skirt-depth tuning budget. */
  maxMixedLodGapContext: string;
  /** Worst gap and the depth covering it, per covering tile level. */
  skirtGapByLevel: Record<string, { gapMeters: number; depthMeters: number }>;
  /** Share of skirt edges the vertex shader collapses to degenerates. */
  suppressedSkirtEdgeFraction: number;
  suppressedSkirtEdges: number;
  skirtEdgesTotal: number;
  skirtEdgesCrossFace: number;
  maxGroundMeshFootHeightErrorMeters: number;
  maxMeshFootHeightErrorMeters: number;
  maxSameLodSeamErrorMeters: number;
  /**
   * Which same-LOD contact produced that error. Same-face contacts are
   * bit-identical; only cube-boundary contacts can be non-zero, and the skirt
   * suppression in `terrain-node-material.ts` depends on that staying true.
   */
  maxSameLodSeamContext: string;
  /** Same-face same-LOD seam error per level — the skirt-suppression budget. */
  sameLodSameFaceSeamErrorByLevel: Record<string, number>;
  maxVisibleFrameHeightErrorMeters: number;
  minimumSkirtFrontFacingDot: number;
  minimumGroundMeshFootNormalDot: number;
  mixedLodContacts: number;
  pinnedFallbackRoots: number;
  sameLodSeamContacts: number;
  selectedTiles: number;
  selectionMilliseconds: number;
  maxUniformLodSpacingErrorMeters: number;
}

/**
 * Surf strength lives in `waterFactors.z` (stride 4). The scalar factors share
 * one attribute because WebGPU has no 1-wide 8-bit vertex format.
 */
function maxSurfStrength(buffers: SurfaceWaterBuffers): number {
  let max = 0;
  for (let offset = 2; offset < buffers.waterFactors.length; offset += 4) {
    max = Math.max(max, buffers.waterFactors[offset]);
  }
  return max;
}

const planet = CLAUDECITIZEN_PLANET;
const seed = DEFAULT_PLANET_SEED;
const edgeEpsilon = 1e-12;
const validationTerrainBuffers = new Map<string, TerrainTileBuffers>();

function validationBuffersFor(info: TileInfo): TerrainTileBuffers {
  const key = tileKey(info.face, info.level, info.x, info.y);
  let buffers = validationTerrainBuffers.get(key);
  if (!buffers) {
    buffers = buildTerrainTileBuffers(info, planet, seed);
    assert.ok(isValidTerrainTileBuffers(buffers));
    validationTerrainBuffers.set(key, buffers);
  }
  return buffers;
}

function scaleDirection(direction: Vec3, radiusMeters: number): Vec3 {
  return {
    x: direction.x * radiusMeters,
    y: direction.y * radiusMeters,
    z: direction.z * radiusMeters,
  };
}

function validateLevelLakeSurfaces(): {
  lakeSurfaceLevelMeters: number;
  lakeSurfaceSamples: number;
  lakeUnderlyingBiome: string;
  maxLakeSurfStrength: number;
  maxLakeSurfaceLevelErrorMeters: number;
} {
  let lakeSurfaceLevelMeters: number | null = null;
  let lakeSurfaceSamples = 0;
  let lakeDirection: Vec3 | null = null;
  let lakeUnderlyingBiome: string | null = null;
  let maxLakeSurfaceLevelErrorMeters = 0;

  for (let latitudeIndex = 0; latitudeIndex < 36; latitudeIndex += 1) {
    const latitude = Math.PI / 2 - (Math.PI * (latitudeIndex + 0.5)) / 36;
    for (let longitudeIndex = 0; longitudeIndex < 72; longitudeIndex += 1) {
      const longitude = -Math.PI + (2 * Math.PI * (longitudeIndex + 0.5)) / 72;
      const direction = {
        x: Math.cos(latitude) * Math.cos(longitude),
        y: Math.sin(latitude),
        z: Math.cos(latitude) * Math.sin(longitude),
      };
      const position = scaleDirection(direction, planet.radiusMeters);
      const heightDetails = sampleSurfaceHeightDetails(planet, seed, position);
      const surface = sampleSurfaceClimate(
        planet,
        seed,
        position,
        heightDetails.heightMeters,
        heightDetails,
      );
      if (surface.waterBody !== 'lake' || surface.lakeWaterLevelMeters == null) continue;

      lakeSurfaceLevelMeters ??= surface.lakeWaterLevelMeters;
      lakeDirection ??= direction;
      lakeUnderlyingBiome ??= surface.biome;
      maxLakeSurfaceLevelErrorMeters = Math.max(
        maxLakeSurfaceLevelErrorMeters,
        Math.abs(surface.lakeWaterLevelMeters - lakeSurfaceLevelMeters),
      );
      lakeSurfaceSamples += 1;
    }
  }

  assert.ok(lakeSurfaceSamples > 0, 'lake plane validation did not find a lake sample');
  assert.ok(
    maxLakeSurfaceLevelErrorMeters <= Number.EPSILON,
    `lake water followed terrain by ${maxLakeSurfaceLevelErrorMeters.toFixed(6)} m`,
  );
  assert.ok(lakeDirection);
  assert.ok(lakeUnderlyingBiome);
  const faceUv = faceUvFromDirection(lakeDirection);
  const tileCount = 2 ** RENDER_SURFACE_LEVEL;
  const waterInfo = makeTileInfo(
    faceUv.face,
    RENDER_SURFACE_LEVEL,
    Math.max(0, Math.min(tileCount - 1, Math.floor(((faceUv.u + 1) * tileCount) / 2))),
    Math.max(0, Math.min(tileCount - 1, Math.floor(((faceUv.v + 1) * tileCount) / 2))),
    planet,
  );
  const waterBuffers = buildSurfaceWaterGeometry(waterInfo, planet, seed);
  assert.ok(waterBuffers, 'generated lake emitted no water geometry');
  assertWaterSkipAgrees(waterInfo, 'lake tile');
  const maxLakeSurfStrength = maxSurfStrength(waterBuffers);
  assert.equal(maxLakeSurfStrength, 0, 'inland lake emitted ocean surf');
  return {
    lakeSurfaceLevelMeters: lakeSurfaceLevelMeters!,
    lakeSurfaceSamples,
    lakeUnderlyingBiome,
    maxLakeSurfStrength,
    maxLakeSurfaceLevelErrorMeters,
  };
}

function validateHydrologyDestination(destination: 'lake' | 'river'): void {
  const location = findSurfaceDestination(planet, seed, destination);
  assert.ok(location, `${destination} destination was not found`);
  const center = sampleSurfaceClimate(
    planet,
    seed,
    cartesianFromLatLonAlt(location.latRadians, location.lonRadians, 0, planet.radiusMeters),
    sampleSurfaceHeightDetails(
      planet,
      seed,
      cartesianFromLatLonAlt(location.latRadians, location.lonRadians, 0, planet.radiusMeters),
    ).heightMeters,
  );
  assert.equal(center.waterBody, null, `${destination} destination was not on dry land`);

  let waterNeighbors = 0;
  for (const distanceMeters of [75, 150, 300, 600, 1_200]) {
    for (const [north, east] of [
      [1, 0],
      [-1, 0],
      [0, 1],
      [0, -1],
      [0.707, 0.707],
      [0.707, -0.707],
      [-0.707, 0.707],
      [-0.707, -0.707],
    ] as const) {
      const latitude = location.latRadians + (north * distanceMeters) / planet.radiusMeters;
      const longitude =
        location.lonRadians +
        (east * distanceMeters) /
          (planet.radiusMeters * Math.max(Math.cos(location.latRadians), 0.1));
      const position = cartesianFromLatLonAlt(latitude, longitude, 0, planet.radiusMeters);
      const details = sampleSurfaceHeightDetails(planet, seed, position);
      const surface = sampleSurfaceClimate(
        planet,
        seed,
        position,
        details.heightMeters,
        details,
      );
      if (surface.waterBody === (destination as WaterBody)) waterNeighbors += 1;
    }
  }
  assert.ok(waterNeighbors > 0, `${destination} destination had no nearby ${destination} water`);
}

function validateCoastDestination(): {
  coastTeleportHeightMeters: number;
  coastTeleportOceanNeighbors: number;
  coastTeleportReliefMeters: number;
  coastTeleportWaterDepthMeters: number;
  coastWaterGeometryVertices: number;
  maxCoastWaterSurfaceLevelErrorMeters: number;
} {
  const location = findSurfaceDestination(planet, seed, 'coast');
  assert.ok(location, 'coast destination did not find an ocean shoreline');
  const centerPosition = cartesianFromLatLonAlt(
    location.latRadians,
    location.lonRadians,
    0,
    planet.radiusMeters,
  );
  const centerDetails = sampleSurfaceHeightDetails(planet, seed, centerPosition);
  const center = sampleSurfaceClimate(
    planet,
    seed,
    centerPosition,
    centerDetails.heightMeters,
    centerDetails,
  );
  assert.equal(center.waterBody, null, 'coast destination was not on dry land');
  let maximumHeight = center.heightMeters;
  let minimumHeight = center.heightMeters;
  let oceanNeighbors = 0;
  let waterDepthMeters = 0;
  const directions = [
    [1, 0],
    [-1, 0],
    [0, 1],
    [0, -1],
    [0.707, 0.707],
    [0.707, -0.707],
    [-0.707, 0.707],
    [-0.707, -0.707],
  ] as const;

  for (const [north, east] of directions) {
    const sampleAtDistance = (distanceMeters: number) => {
      const latitude =
        location.latRadians + (north * distanceMeters) / planet.radiusMeters;
      const longitude =
        location.lonRadians +
        (east * distanceMeters) /
          (planet.radiusMeters * Math.max(Math.cos(location.latRadians), 0.1));
      const position = cartesianFromLatLonAlt(latitude, longitude, 0, planet.radiusMeters);
      const details = sampleSurfaceHeightDetails(planet, seed, position);
      return sampleSurfaceClimate(
        planet,
        seed,
        position,
        details.heightMeters,
        details,
      );
    };
    const nearby = sampleAtDistance(75);
    if (nearby.waterBody == null) {
      maximumHeight = Math.max(maximumHeight, nearby.heightMeters);
      minimumHeight = Math.min(minimumHeight, nearby.heightMeters);
    }
    if (sampleAtDistance(300).waterBody === 'ocean') oceanNeighbors += 1;
    const offshore = sampleAtDistance(1_000);
    waterDepthMeters = Math.max(
      waterDepthMeters,
      OCEAN_WATER_LEVEL_METERS - offshore.heightMeters,
    );
  }

  const reliefMeters = maximumHeight - minimumHeight;
  assert.ok(
    center.heightMeters >= OCEAN_WATER_LEVEL_METERS + 1.25,
    'coast destination landed inside wave height',
  );
  assert.ok(
    center.heightMeters <= OCEAN_WATER_LEVEL_METERS + 12,
    `coast destination landed ${(
      center.heightMeters - OCEAN_WATER_LEVEL_METERS
    ).toFixed(2)} m above the shoreline`,
  );
  assert.ok(oceanNeighbors > 0, 'coast destination selected an inland lowland');
  assert.ok(reliefMeters <= 20, `coast destination selected ${reliefMeters.toFixed(2)} m relief`);
  assert.ok(
    waterDepthMeters >= 10,
    `coast only reached ${waterDepthMeters.toFixed(2)} m water depth within 1 km`,
  );

  const faceUv = faceUvFromDirection(normalize(centerPosition));
  const tileCount = 2 ** RENDER_SURFACE_LEVEL;
  const tileX = Math.max(
    0,
    Math.min(tileCount - 1, Math.floor(((faceUv.u + 1) * tileCount) / 2)),
  );
  const tileY = Math.max(
    0,
    Math.min(tileCount - 1, Math.floor(((faceUv.v + 1) * tileCount) / 2)),
  );
  const waterInfo = makeTileInfo(
    faceUv.face,
    RENDER_SURFACE_LEVEL,
    tileX,
    tileY,
    planet,
  );
  const waterBuffers = buildSurfaceWaterGeometry(waterInfo, planet, seed);
  assert.ok(waterBuffers, 'raised shoreline emitted no water geometry');
  assertWaterSkipAgrees(waterInfo, 'ocean coast tile');
  assert.ok(maxSurfStrength(waterBuffers) > 0, 'ocean coast emitted no surf');
  let maxCoastWaterSurfaceLevelErrorMeters = 0;
  for (let offset = 0; offset < waterBuffers.positions.length; offset += 3) {
    const worldX = waterBuffers.positions[offset] + waterInfo.centerPosition.x;
    const worldY = waterBuffers.positions[offset + 1] + waterInfo.centerPosition.y;
    const worldZ = waterBuffers.positions[offset + 2] + waterInfo.centerPosition.z;
    const surfaceLevelMeters = Math.hypot(worldX, worldY, worldZ) - planet.radiusMeters;
    maxCoastWaterSurfaceLevelErrorMeters = Math.max(
      maxCoastWaterSurfaceLevelErrorMeters,
      Math.abs(surfaceLevelMeters - OCEAN_WATER_LEVEL_METERS),
    );
  }
  assert.ok(
    maxCoastWaterSurfaceLevelErrorMeters < 0.01,
    `coast water mesh missed its raised level by ${maxCoastWaterSurfaceLevelErrorMeters.toFixed(4)} m`,
  );
  return {
    coastTeleportHeightMeters: center.heightMeters,
    coastTeleportOceanNeighbors: oceanNeighbors,
    coastTeleportReliefMeters: reliefMeters,
    coastTeleportWaterDepthMeters: waterDepthMeters,
    coastWaterGeometryVertices: waterBuffers.positions.length / 3,
    maxCoastWaterSurfaceLevelErrorMeters,
  };
}

function bodyPositionAt(directionInput: Vec3, altitudeMeters: number): Vec3 {
  const direction = normalize(directionInput);
  const surfaceHeight = sampleVisibleSurfaceFrame(
    planet,
    seed,
    direction,
    RENDER_SURFACE_LEVEL,
  ).heightMeters;
  return scaleDirection(
    direction,
    planet.radiusMeters + surfaceHeight + altitudeMeters,
  );
}

function selectedTilesForBody(bodyPosition: Vec3, altitudeMeters: number): TileInfo[] {
  const selected: TileInfo[] = [];
  visitSelectedTiles(planet, bodyPosition, altitudeMeters, (info) => selected.push(info));
  return selected;
}

function selectedTilesAt(directionInput: Vec3, altitudeMeters: number): TileInfo[] {
  return selectedTilesForBody(
    bodyPositionAt(directionInput, altitudeMeters),
    altitudeMeters,
  );
}

function validateHorizonCoverage(): number[] {
  const axes = [
    { x: 1, y: 0, z: 0 },
    { x: -1, y: 0, z: 0 },
    { x: 0, y: 1, z: 0 },
    { x: 0, y: -1, z: 0 },
    { x: 0, y: 0, z: 1 },
    { x: 0, y: 0, z: -1 },
  ];
  const counts: number[] = [];
  for (const altitudeMeters of [2, 1_000]) {
    for (const axis of axes) {
      const count = selectedTilesAt(axis, altitudeMeters).length;
      assert.ok(count > 0, `horizon culling removed every tile at ${JSON.stringify(axis)}`);
      counts.push(count);
    }
  }
  return counts;
}

function validateFallbackCoverage(selected: TileInfo[]): {
  coldCacheFallbackLevel: number;
  fallbackChainMinimumLevel: number;
  pinnedFallbackRoots: number;
} {
  let minimumLevel = Number.POSITIVE_INFINITY;
  for (const target of selected) {
    let current: TileInfo | null = target;
    let chainLength = 0;
    while (current) {
      minimumLevel = Math.min(minimumLevel, current.level);
      chainLength += 1;
      current = parentTileInfo(current, planet);
    }
    assert.equal(
      chainLength,
      target.level + 1,
      `${tileKey(target.face, target.level, target.x, target.y)} fallback chain did not reach L0`,
    );
  }
  assert.equal(minimumLevel, 0, 'fallback coverage did not reach a root tile');

  const gridRenderer = createTerrainGridRenderer(planet);
  const cache = createTileMeshCache({ gridRenderer, planet, seed });
  try {
    const target = selected.find((info) => info.level === RENDER_SURFACE_LEVEL);
    assert.ok(target, 'fallback validation had no finest-level target');
    const coldFallback = cache.requestBestAvailableTile(target, { remaining: 0 });
    assert.ok(coldFallback.ready, 'cold cache returned a terrain hole');
    assert.equal(coldFallback.info.level, 0, 'cold cache did not resolve to a root tile');

    cache.setFrameNumber(10_000);
    cache.evictTileMeshes(new Set());
    const pinnedFallbackRoots = cache.countEntries('ready');
    assert.equal(pinnedFallbackRoots, CUBE_FACES.length, 'root fallback meshes were evicted');

    const oppositeTarget = makeTileInfo(
      target.face,
      target.level,
      2 ** target.level - 1 - target.x,
      2 ** target.level - 1 - target.y,
      planet,
    );
    const postEvictionFallback = cache.requestBestAvailableTile(oppositeTarget, {
      remaining: 0,
    });
    assert.ok(postEvictionFallback.ready, 'post-eviction cache returned a terrain hole');
    assert.equal(postEvictionFallback.info.level, 0);
    return {
      coldCacheFallbackLevel: coldFallback.info.level,
      fallbackChainMinimumLevel: minimumLevel,
      pinnedFallbackRoots,
    };
  } finally {
    cache.dispose();
    gridRenderer.dispose();
  }
}

function validateHighlandGroundDetail(): {
  heightMeters: number;
  selectedLevel: number;
  selectedTiles: number;
} {
  let highestDirection: Vec3 = { x: 1, y: 0, z: 0 };
  let heightMeters = Number.NEGATIVE_INFINITY;
  const candidates = 256;
  for (let index = 0; index < candidates; index += 1) {
    const y = 1 - (2 * (index + 0.5)) / candidates;
    const ringRadius = Math.sqrt(Math.max(0, 1 - y * y));
    const longitude = index * 2.399963229728653;
    const direction = {
      x: Math.cos(longitude) * ringRadius,
      y,
      z: Math.sin(longitude) * ringRadius,
    };
    const height = sampleVisibleSurfaceFrame(
      planet,
      seed,
      direction,
      RENDER_SURFACE_LEVEL,
    ).heightMeters;
    if (height <= heightMeters) continue;
    heightMeters = height;
    highestDirection = direction;
  }
  const selected = selectedTilesAt(highestDirection, 2);
  const selectedLevel = Math.max(...selected.map((info) => info.level));
  assert.ok(
    heightMeters > 450,
    `highland probe only reached ${heightMeters.toFixed(1)} m`,
  );
  assert.equal(
    selectedLevel,
    RENDER_SURFACE_LEVEL,
    `highland ground selection stopped at L${selectedLevel}`,
  );
  assert.ok(
    selected.length <= 340,
    `highland ground selection expanded to ${selected.length} tiles`,
  );
  return { heightMeters, selectedLevel, selectedTiles: selected.length };
}

function validateUniformLodSampleSpacing(): number {
  let maximumError = 0;
  for (let level = 0; level <= RENDER_SURFACE_LEVEL; level += 1) {
    const expected = renderableCellSampleSpacingMeters(planet, level);
    const actual = renderableGridSampleSpacingMeters(planet, level);
    maximumError = Math.max(maximumError, Math.abs(actual - expected));
  }
  assert.equal(maximumError, 0, 'terrain vertices within one LOD changed sample spacing');
  return maximumError;
}

function validateVisibleFrames(): number {
  const cells = 2 ** RENDER_SURFACE_LEVEL * RENDER_SURFACE_SEGMENTS;
  let maximumError = 0;
  for (let index = 0; index < 300; index += 1) {
    const face = CUBE_FACES[index % CUBE_FACES.length];
    const gridX = 1 + ((index * 8_191) % (cells - 2));
    const gridY = 1 + ((index * 4_093) % (cells - 2));
    const direction = directionFromCubeFace(
      face,
      -1 + (gridX * 2) / cells,
      -1 + (gridY * 2) / cells,
    );
    const analytic = sampleSurfaceHeightDetails(planet, seed, direction, {
      sampleSpacingMeters: renderableGridSampleSpacingMeters(
        planet,
        RENDER_SURFACE_LEVEL,
      ),
    });
    const frame = sampleVisibleSurfaceFrame(
      planet,
      seed,
      direction,
      RENDER_SURFACE_LEVEL,
    );
    maximumError = Math.max(
      maximumError,
      Math.abs(analytic.heightMeters - frame.heightMeters),
    );
    const analyticClimate = sampleSurfaceClimate(
      planet,
      seed,
      direction,
      analytic.heightMeters,
      analytic,
    );
    const visibleClimate = sampleSurfaceClimate(
      planet,
      seed,
      direction,
      frame.heightMeters,
      frame.heightDetails,
    );
    assert.equal(analyticClimate.biome, visibleClimate.biome);
  }
  assert.ok(maximumError < 1e-6, `visible frame height error was ${maximumError} m`);
  return maximumError;
}

function edgeContact(a: TileInfo, b: TileInfo): EdgeContact | null {
  if (a.face !== b.face) return null;
  const uOverlap = Math.min(a.bounds.u1, b.bounds.u1) - Math.max(a.bounds.u0, b.bounds.u0);
  const vOverlap = Math.min(a.bounds.v1, b.bounds.v1) - Math.max(a.bounds.v0, b.bounds.v0);
  if (Math.abs(a.bounds.u1 - b.bounds.u0) <= edgeEpsilon && vOverlap > edgeEpsilon) {
    return { axis: 'v', edgeA: 3, edgeB: 2 };
  }
  if (Math.abs(a.bounds.u0 - b.bounds.u1) <= edgeEpsilon && vOverlap > edgeEpsilon) {
    return { axis: 'v', edgeA: 2, edgeB: 3 };
  }
  if (Math.abs(a.bounds.v1 - b.bounds.v0) <= edgeEpsilon && uOverlap > edgeEpsilon) {
    return { axis: 'u', edgeA: 1, edgeB: 0 };
  }
  if (Math.abs(a.bounds.v0 - b.bounds.v1) <= edgeEpsilon && uOverlap > edgeEpsilon) {
    return { axis: 'u', edgeA: 0, edgeB: 1 };
  }
  return null;
}

function rawCubePoint(face: CubeFace, u: number, v: number): Vec3 {
  if (face === 'px') return { x: 1, y: v, z: -u };
  if (face === 'nx') return { x: -1, y: v, z: u };
  if (face === 'py') return { x: u, y: 1, z: -v };
  if (face === 'ny') return { x: u, y: -1, z: v };
  if (face === 'pz') return { x: u, y: v, z: 1 };
  return { x: -u, y: v, z: -1 };
}

function cubeBoundaryEdge(
  info: TileInfo,
  edge: number,
): CubeBoundaryEdge | null {
  const { u0, u1, v0, v1 } = info.bounds;
  const liesOnBoundary =
    (edge === 0 && Math.abs(v0 + 1) <= edgeEpsilon) ||
    (edge === 1 && Math.abs(v1 - 1) <= edgeEpsilon) ||
    (edge === 2 && Math.abs(u0 + 1) <= edgeEpsilon) ||
    (edge === 3 && Math.abs(u1 - 1) <= edgeEpsilon);
  if (!liesOnBoundary) return null;
  const start =
    edge === 0
      ? rawCubePoint(info.face, u0, v0)
      : edge === 1
        ? rawCubePoint(info.face, u0, v1)
        : edge === 2
          ? rawCubePoint(info.face, u0, v0)
          : rawCubePoint(info.face, u1, v0);
  const end =
    edge === 0
      ? rawCubePoint(info.face, u1, v0)
      : edge === 1
        ? rawCubePoint(info.face, u1, v1)
        : edge === 2
          ? rawCubePoint(info.face, u0, v1)
          : rawCubePoint(info.face, u1, v1);
  const axes = ['x', 'y', 'z'] as const;
  const fixed = axes.filter(
    (axis) =>
      Math.abs(start[axis] - end[axis]) <= edgeEpsilon &&
      Math.abs(Math.abs(start[axis]) - 1) <= edgeEpsilon,
  );
  assert.equal(fixed.length, 2);
  const variable = axes.find((axis) => !fixed.includes(axis));
  assert.ok(variable);
  const id = fixed
    .map((axis) => `${axis}${start[axis] > 0 ? '+' : '-'}`)
    .sort()
    .join(':');
  return {
    edge,
    id,
    parameterEnd: end[variable],
    parameterStart: start[variable],
  };
}

function cubeBoundaryEdges(info: TileInfo): CubeBoundaryEdge[] {
  const edges: CubeBoundaryEdge[] = [];
  for (let edge = 0; edge < 4; edge += 1) {
    const descriptor = cubeBoundaryEdge(info, edge);
    if (descriptor) edges.push(descriptor);
  }
  return edges;
}

function localPosition(buffers: TerrainTileBuffers, vertex: number): Vec3 {
  const offset = vertex * 3;
  return {
    x: buffers.positions[offset],
    y: buffers.positions[offset + 1],
    z: buffers.positions[offset + 2],
  };
}

function worldPosition(info: TileInfo, local: Vec3): Vec3 {
  return {
    x: info.centerPosition.x + local.x,
    y: info.centerPosition.y + local.y,
    z: info.centerPosition.z + local.z,
  };
}

function edgeTopPositions(
  info: TileInfo,
  buffers: TerrainTileBuffers,
  edge: number,
): Vec3[] {
  const firstVertex =
    TERRAIN_SURFACE_VERTEX_COUNT +
    edge * TILE_SEGMENTS * TERRAIN_SKIRT_VERTICES_PER_SEGMENT;
  const positions: Vec3[] = [];
  for (let segment = 0; segment < TILE_SEGMENTS; segment += 1) {
    positions.push(
      worldPosition(
        info,
        localPosition(
          buffers,
          firstVertex + segment * TERRAIN_SKIRT_VERTICES_PER_SEGMENT,
        ),
      ),
    );
  }
  const lastTriangleVertex =
    firstVertex +
    (TILE_SEGMENTS - 1) * TERRAIN_SKIRT_VERTICES_PER_SEGMENT;
  const lastCandidates = [1, 2].map((offset) =>
    worldPosition(info, localPosition(buffers, lastTriangleVertex + offset)),
  );
  lastCandidates.sort(
    (left, right) =>
      Math.hypot(right.x, right.y, right.z) - Math.hypot(left.x, left.y, left.z),
  );
  positions.push(lastCandidates[0]);
  return positions;
}

function edgeSkirtDepthMeters(
  info: TileInfo,
  buffers: TerrainTileBuffers,
  edge: number,
): number {
  const firstVertex =
    TERRAIN_SURFACE_VERTEX_COUNT +
    edge * TILE_SEGMENTS * TERRAIN_SKIRT_VERTICES_PER_SEGMENT;
  const top = worldPosition(info, localPosition(buffers, firstVertex));
  const topRadius = Math.hypot(top.x, top.y, top.z);
  const bottomCandidates = [4, 5].map((offset) =>
    worldPosition(info, localPosition(buffers, firstVertex + offset)),
  );
  bottomCandidates.sort((left, right) => {
    const leftRadius = Math.hypot(left.x, left.y, left.z);
    const rightRadius = Math.hypot(right.x, right.y, right.z);
    const leftFacing =
      (top.x * left.x + top.y * left.y + top.z * left.z) /
      Math.max(topRadius * leftRadius, 1e-9);
    const rightFacing =
      (top.x * right.x + top.y * right.y + top.z * right.z) /
      Math.max(topRadius * rightRadius, 1e-9);
    return rightFacing - leftFacing;
  });
  const bottom = bottomCandidates[0];
  return topRadius - Math.hypot(bottom.x, bottom.y, bottom.z);
}

function edgeSkirtNormalAtCoordinate(
  buffers: TerrainTileBuffers,
  location: EdgeSampleLocation,
): Vec3 {
  const {
    coordinate,
    edgeIndex,
    parameterEnd,
    parameterStart,
    sideOffset = 0,
  } = location;
  const scaled = Math.max(
    0,
    Math.min(
      TILE_SEGMENTS - 1e-9,
      ((coordinate - parameterStart) / (parameterEnd - parameterStart)) * TILE_SEGMENTS,
    ),
  );
  const segment = Math.floor(scaled);
  const vertex =
    TERRAIN_SURFACE_VERTEX_COUNT +
    (edgeIndex * TILE_SEGMENTS + segment) * TERRAIN_SKIRT_VERTICES_PER_SEGMENT +
    sideOffset;
  const offset = vertex * TERRAIN_PACKED_COMPONENTS;
  return normalize({
    x: buffers.normals[offset],
    y: buffers.normals[offset + 1],
    z: buffers.normals[offset + 2],
  });
}

function edgePositionAtCoordinate(
  edge: Vec3[],
  parameterStart: number,
  parameterEnd: number,
  coordinate: number,
): Vec3 {
  const scaled = Math.max(
    0,
    Math.min(
      TILE_SEGMENTS,
      ((coordinate - parameterStart) / (parameterEnd - parameterStart)) * TILE_SEGMENTS,
    ),
  );
  const segment = Math.min(TILE_SEGMENTS - 1, Math.floor(scaled));
  const t = scaled - segment;
  const start = edge[segment];
  const end = edge[segment + 1];
  return {
    x: start.x + (end.x - start.x) * t,
    y: start.y + (end.y - start.y) * t,
    z: start.z + (end.z - start.z) * t,
  };
}

function dotVectors(left: Vec3, right: Vec3): number {
  return left.x * right.x + left.y * right.y + left.z * right.z;
}

function directionFromTo(from: Vec3, to: Vec3): Vec3 {
  return normalize({
    x: to.x - from.x,
    y: to.y - from.y,
    z: to.z - from.z,
  });
}

function pointDistance(left: Vec3, right: Vec3): number {
  return Math.hypot(left.x - right.x, left.y - right.y, left.z - right.z);
}

function meshTriangleSample(
  globalCellX: number,
  globalCellY: number,
  fractionU: number,
  fractionV: number,
): MeshTriangleSample {
  if (terrainCellUsesNorthwestSoutheastDiagonal(globalCellX, globalCellY)) {
    return fractionV <= fractionU
      ? {
          triangle: 0,
          weights: [1 - fractionU, fractionU - fractionV, fractionV],
        }
      : {
          triangle: 1,
          weights: [1 - fractionV, fractionU, fractionV - fractionU],
        };
  }
  return fractionU + fractionV <= 1
    ? {
        triangle: 0,
        weights: [1 - fractionU - fractionV, fractionU, fractionV],
      }
    : {
        triangle: 1,
        weights: [1 - fractionV, fractionU + fractionV - 1, 1 - fractionU],
      };
}

function meshTriangleVertices(
  info: TileInfo,
  buffers: TerrainTileBuffers,
  cellX: number,
  cellY: number,
  triangle: 0 | 1,
): readonly [Vec3, Vec3, Vec3] {
  const firstVertex =
    (cellY * TILE_SEGMENTS + cellX) * 6 + triangle * 3;
  return [0, 1, 2].map((offset) =>
    worldPosition(info, localPosition(buffers, firstVertex + offset)),
  ) as unknown as readonly [Vec3, Vec3, Vec3];
}

function weightedPoint(
  vertices: readonly [Vec3, Vec3, Vec3],
  weights: readonly [number, number, number],
): Vec3 {
  return {
    x:
      vertices[0].x * weights[0] +
      vertices[1].x * weights[1] +
      vertices[2].x * weights[2],
    y:
      vertices[0].y * weights[0] +
      vertices[1].y * weights[1] +
      vertices[2].y * weights[2],
    z:
      vertices[0].z * weights[0] +
      vertices[1].z * weights[1] +
      vertices[2].z * weights[2],
  };
}

function outwardTriangleNormal(
  vertices: readonly [Vec3, Vec3, Vec3],
  radialDirection: Vec3,
): Vec3 {
  const ab = directionFromTo(vertices[0], vertices[1]);
  const ac = directionFromTo(vertices[0], vertices[2]);
  let normal = normalize({
    x: ab.y * ac.z - ab.z * ac.y,
    y: ab.z * ac.x - ab.x * ac.z,
    z: ab.x * ac.y - ab.y * ac.x,
  });
  if (dotVectors(normal, radialDirection) < 0) {
    normal = { x: -normal.x, y: -normal.y, z: -normal.z };
  }
  return normal;
}

function validateMeshFootAgreement(selected: TileInfo[]): {
  maximumGroundHeightErrorMeters: number;
  maximumHeightErrorMeters: number;
  minimumGroundNormalDot: number;
} {
  const finest = selected.find((info) => info.level === RENDER_SURFACE_LEVEL);
  assert.ok(finest);
  const tiles = [2, 8, RENDER_SURFACE_LEVEL].map((level) => {
    const divisor = 2 ** (RENDER_SURFACE_LEVEL - level);
    return makeTileInfo(
      finest.face,
      level,
      Math.floor(finest.x / divisor),
      Math.floor(finest.y / divisor),
      planet,
    );
  });
  let maximumGroundHeightErrorMeters = 0;
  let maximumHeightErrorMeters = 0;
  let minimumGroundNormalDot = 1;

  for (const info of tiles) {
    const buffers = validationBuffersFor(info);
    for (let index = 0; index < 200; index += 1) {
      const cellX = (index * 7) % TILE_SEGMENTS;
      const cellY = (index * 13) % TILE_SEGMENTS;
      const fractionU = (((index * 37) % 97) + 0.25) / 97;
      const fractionV = (((index * 53) % 89) + 0.35) / 89;
      const globalCellX = info.x * TILE_SEGMENTS + cellX;
      const globalCellY = info.y * TILE_SEGMENTS + cellY;
      const sample = meshTriangleSample(
        globalCellX,
        globalCellY,
        fractionU,
        fractionV,
      );
      const vertices = meshTriangleVertices(
        info,
        buffers,
        cellX,
        cellY,
        sample.triangle,
      );
      const point = weightedPoint(vertices, sample.weights);
      const u =
        info.bounds.u0 +
        ((cellX + fractionU) / TILE_SEGMENTS) *
          (info.bounds.u1 - info.bounds.u0);
      const v =
        info.bounds.v0 +
        ((cellY + fractionV) / TILE_SEGMENTS) *
          (info.bounds.v1 - info.bounds.v0);
      const direction = directionFromCubeFace(info.face, u, v);
      const frame = sampleVisibleSurfaceFrame(planet, seed, direction, info.level);
      const meshHeight = dotVectors(point, direction) - planet.radiusMeters;
      const heightError = Math.abs(meshHeight - frame.heightMeters);
      maximumHeightErrorMeters = Math.max(maximumHeightErrorMeters, heightError);
      if (info.level !== RENDER_SURFACE_LEVEL) continue;
      maximumGroundHeightErrorMeters = Math.max(
        maximumGroundHeightErrorMeters,
        heightError,
      );
      minimumGroundNormalDot = Math.min(
        minimumGroundNormalDot,
        dotVectors(outwardTriangleNormal(vertices, direction), frame.normal),
      );
    }
  }

  assert.ok(
    maximumHeightErrorMeters < 0.5,
    `packed terrain mesh diverged from its sampler by ${maximumHeightErrorMeters} m`,
  );
  assert.ok(
    maximumGroundHeightErrorMeters < 0.001,
    `L${RENDER_SURFACE_LEVEL} mesh/foot error reached ${maximumGroundHeightErrorMeters} m`,
  );
  assert.ok(
    minimumGroundNormalDot > 0.999_999,
    `L${RENDER_SURFACE_LEVEL} mesh/foot normal dot fell to ${minimumGroundNormalDot}`,
  );
  return {
    maximumGroundHeightErrorMeters,
    maximumHeightErrorMeters,
    minimumGroundNormalDot,
  };
}

function sameBoundaryInterval(
  left: CubeBoundaryEdge,
  right: CubeBoundaryEdge,
): boolean {
  return (
    Math.abs(
      Math.min(left.parameterStart, left.parameterEnd) -
        Math.min(right.parameterStart, right.parameterEnd),
    ) <= edgeEpsilon &&
    Math.abs(
      Math.max(left.parameterStart, left.parameterEnd) -
        Math.max(right.parameterStart, right.parameterEnd),
    ) <= edgeEpsilon
  );
}

function sameLodBoundaryCandidates(
  level: number,
  alongValues: readonly number[],
): SameLodBoundaryCandidate[] {
  return CUBE_FACES.flatMap((face) =>
    [0, 1, 2, 3].flatMap((edgeIndex) =>
      alongValues.map((along) => {
        const info = makeBoundaryTile(face, edgeIndex, level, along);
        const descriptor = cubeBoundaryEdge(info, edgeIndex);
        assert.ok(descriptor);
        return { descriptor, edgeIndex, info };
      }),
    ),
  );
}

function validateSameLodSeams(): {
  contacts: number;
  maximumErrorContext: string;
  maximumErrorMeters: number;
  sameFaceErrorByLevel: Record<string, number>;
} {
  let contacts = 0;
  let maximumErrorMeters = 0;
  let maximumErrorContext = '';
  // Tracked separately from the aggregate: skirt suppression only collapses
  // same-face, same-level edges, so it is that number — not the cube-boundary
  // one — that bounds the crack suppression can expose.
  const sameFaceErrorByLevel = new Map<number, number>();

  const compare = (comparison: SameLodSeamComparison): void => {
    const {
      left,
      leftEdgeIndex,
      leftParameterEnd,
      leftParameterStart,
      right,
      rightEdgeIndex,
      rightParameterEnd,
      rightParameterStart,
    } = comparison;
    contacts += 1;
    const leftEdge = edgeTopPositions(left, validationBuffersFor(left), leftEdgeIndex);
    const rightEdge = edgeTopPositions(right, validationBuffersFor(right), rightEdgeIndex);
    const overlapStart = Math.max(
      Math.min(leftParameterStart, leftParameterEnd),
      Math.min(rightParameterStart, rightParameterEnd),
    );
    const overlapEnd = Math.min(
      Math.max(leftParameterStart, leftParameterEnd),
      Math.max(rightParameterStart, rightParameterEnd),
    );
    assert.ok(overlapEnd > overlapStart);
    for (let index = 0; index <= TILE_SEGMENTS; index += 1) {
      const coordinate =
        overlapStart + (overlapEnd - overlapStart) * (index / TILE_SEGMENTS);
      const leftPoint = edgePositionAtCoordinate(
        leftEdge,
        leftParameterStart,
        leftParameterEnd,
        coordinate,
      );
      const rightPoint = edgePositionAtCoordinate(
        rightEdge,
        rightParameterStart,
        rightParameterEnd,
        coordinate,
      );
      const errorMeters = pointDistance(leftPoint, rightPoint);
      if (left.face === right.face) {
        sameFaceErrorByLevel.set(
          left.level,
          Math.max(sameFaceErrorByLevel.get(left.level) ?? 0, errorMeters),
        );
      }
      if (errorMeters <= maximumErrorMeters) continue;
      maximumErrorMeters = errorMeters;
      maximumErrorContext = [
        `${left.face} L${left.level} ${left.x},${left.y} e${leftEdgeIndex}`,
        `${right.face} L${right.level} ${right.x},${right.y} e${rightEdgeIndex}`,
        `vertex=${index}`,
      ].join(' / ');
    }
  };

  for (const level of [2, 8, RENDER_SURFACE_LEVEL]) {
    const tileCount = 2 ** level;
    const x = Math.max(0, Math.min(tileCount - 2, Math.floor(tileCount * 0.37)));
    const y = Math.max(0, Math.min(tileCount - 2, Math.floor(tileCount * 0.61)));
    for (const face of CUBE_FACES) {
      const tile = makeTileInfo(face, level, x, y, planet);
      const right = makeTileInfo(face, level, x + 1, y, planet);
      compare({
        left: tile,
        leftEdgeIndex: 3,
        leftParameterEnd: tile.bounds.v1,
        leftParameterStart: tile.bounds.v0,
        right,
        rightEdgeIndex: 2,
        rightParameterEnd: right.bounds.v1,
        rightParameterStart: right.bounds.v0,
      });
      const below = makeTileInfo(face, level, x, y + 1, planet);
      compare({
        left: tile,
        leftEdgeIndex: 1,
        leftParameterEnd: tile.bounds.u1,
        leftParameterStart: tile.bounds.u0,
        right: below,
        rightEdgeIndex: 0,
        rightParameterEnd: below.bounds.u1,
        rightParameterStart: below.bounds.u0,
      });
    }

    const along = Math.floor(tileCount * 0.37);
    const mirroredAlong = tileCount - 1 - along;
    const comparedCubeEdgeIds = new Set<string>();
    const candidates = sameLodBoundaryCandidates(level, [along, mirroredAlong]);
    for (let leftIndex = 0; leftIndex < candidates.length; leftIndex += 1) {
      for (let rightIndex = leftIndex + 1; rightIndex < candidates.length; rightIndex += 1) {
        const left = candidates[leftIndex];
        const right = candidates[rightIndex];
        if (left.info.face === right.info.face) continue;
        if (left.descriptor.id !== right.descriptor.id) continue;
        if (!sameBoundaryInterval(left.descriptor, right.descriptor)) continue;
        comparedCubeEdgeIds.add(left.descriptor.id);
        compare({
          left: left.info,
          leftEdgeIndex: left.edgeIndex,
          leftParameterEnd: left.descriptor.parameterEnd,
          leftParameterStart: left.descriptor.parameterStart,
          right: right.info,
          rightEdgeIndex: right.edgeIndex,
          rightParameterEnd: right.descriptor.parameterEnd,
          rightParameterStart: right.descriptor.parameterStart,
        });
      }
    }
    assert.equal(
      comparedCubeEdgeIds.size,
      12,
      `L${level} did not cover all cube edges`,
    );
  }

  assert.ok(
    maximumErrorMeters < 0.5,
    `same-LOD seam error reached ${maximumErrorMeters.toFixed(3)} m at ${maximumErrorContext}`,
  );
  return {
    contacts,
    maximumErrorContext,
    maximumErrorMeters,
    sameFaceErrorByLevel: Object.fromEntries(
      [...sameFaceErrorByLevel.entries()]
        .sort((left, right) => left[0] - right[0])
        .map(([level, error]) => [`L${level}`, error]),
    ),
  };
}

function makeBoundaryTile(
  face: CubeFace,
  edge: number,
  level: number,
  along: number,
): TileInfo {
  const last = 2 ** level - 1;
  if (edge === 0) return makeTileInfo(face, level, along, 0, planet);
  if (edge === 1) return makeTileInfo(face, level, along, last, planet);
  if (edge === 2) return makeTileInfo(face, level, 0, along, planet);
  return makeTileInfo(face, level, last, along, planet);
}

function interpolatedCoarseRadius(
  coarseEdge: Vec3[],
  parameterStart: number,
  parameterEnd: number,
  coordinate: number,
): number {
  const point = edgePositionAtCoordinate(
    coarseEdge,
    parameterStart,
    parameterEnd,
    coordinate,
  );
  return Math.hypot(point.x, point.y, point.z);
}

/**
 * Worst radial gap a skirt has to cover, bucketed by the covering tile's level.
 *
 * The aggregate ratio hides which levels are actually tight: it is dominated by
 * the coarse contacts, where depth follows `cellSpan * factor`. The per-level
 * gaps are what `TERRAIN_SKIRT_MIN_DEPTH_METERS` has to clear at the fine
 * levels, where the floor is the binding term instead.
 */
type SkirtGapByLevel = Map<number, { gapMeters: number; depthMeters: number }>;

function recordLevelGap(
  byLevel: SkirtGapByLevel,
  level: number,
  gapMeters: number,
  depthMeters: number,
): void {
  const existing = byLevel.get(level);
  if (!existing || gapMeters > existing.gapMeters) {
    byLevel.set(level, { gapMeters, depthMeters });
  }
}

function validateMixedLodSkirts(
  selected: TileInfo[],
  gapByLevel: SkirtGapByLevel,
): {
  contacts: number;
  maximumRatio: number;
  maximumRatioContext: string;
  minimumFrontFacingDot: number;
} {
  let contacts = 0;
  let maximumRatio = 0;
  let maximumRatioContext = '';
  let minimumFrontFacingDot = 1;
  const measureContact = (input: MeasuredEdgeContact): void => {
    const {
      coarse,
      coarseEdgeIndex,
      coarseParameterEnd,
      coarseParameterStart,
      fine,
      fineEdgeIndex,
      fineParameterEnd,
      fineParameterStart,
    } = input;
    contacts += 1;
    const fineBuffers = validationBuffersFor(fine);
    const coarseBuffers = validationBuffersFor(coarse);
    const fineEdge = edgeTopPositions(fine, fineBuffers, fineEdgeIndex);
    const coarseEdge = edgeTopPositions(coarse, coarseBuffers, coarseEdgeIndex);
    const fineDepth = edgeSkirtDepthMeters(fine, fineBuffers, fineEdgeIndex);
    const coarseDepth = edgeSkirtDepthMeters(coarse, coarseBuffers, coarseEdgeIndex);
    const overlapStart = Math.max(
      Math.min(fineParameterStart, fineParameterEnd),
      Math.min(coarseParameterStart, coarseParameterEnd),
    );
    const overlapEnd = Math.min(
      Math.max(fineParameterStart, fineParameterEnd),
      Math.max(coarseParameterStart, coarseParameterEnd),
    );
    assert.ok(overlapEnd > overlapStart, 'measured seam edges did not overlap');
    const midpointCoordinate = (overlapStart + overlapEnd) * 0.5;
    const fineMidpoint = edgePositionAtCoordinate(
      fineEdge,
      fineParameterStart,
      fineParameterEnd,
      midpointCoordinate,
    );
    const coarseMidpoint = edgePositionAtCoordinate(
      coarseEdge,
      coarseParameterStart,
      coarseParameterEnd,
      midpointCoordinate,
    );
    const fineIsCovering =
      Math.hypot(fineMidpoint.x, fineMidpoint.y, fineMidpoint.z) >=
      Math.hypot(coarseMidpoint.x, coarseMidpoint.y, coarseMidpoint.z);
    const coveringBuffers = fineIsCovering ? fineBuffers : coarseBuffers;
    const coveringEdgeIndex = fineIsCovering ? fineEdgeIndex : coarseEdgeIndex;
    const coveringParameterStart = fineIsCovering
      ? fineParameterStart
      : coarseParameterStart;
    const coveringParameterEnd = fineIsCovering ? fineParameterEnd : coarseParameterEnd;
    const coveringMidpoint = fineIsCovering ? fineMidpoint : coarseMidpoint;
    const outwardNormal = edgeSkirtNormalAtCoordinate(
      coveringBuffers,
      {
        coordinate: midpointCoordinate,
        edgeIndex: coveringEdgeIndex,
        parameterEnd: coveringParameterEnd,
        parameterStart: coveringParameterStart,
      },
    );
    const inwardNormal = edgeSkirtNormalAtCoordinate(
      coveringBuffers,
      {
        coordinate: midpointCoordinate,
        edgeIndex: coveringEdgeIndex,
        parameterEnd: coveringParameterEnd,
        parameterStart: coveringParameterStart,
        sideOffset: 6,
      },
    );
    assert.ok(
      dotVectors(outwardNormal, inwardNormal) < -0.999,
      'paired skirt faces were not oppositely wound',
    );
    const cameraRadius =
      planet.radiusMeters + planet.terrainAmplitudeMeters + 2_000;
    for (const viewerTile of [fine, coarse]) {
      const camera = scaleDirection(viewerTile.centerDirection, cameraRadius);
      const viewDirection = directionFromTo(coveringMidpoint, camera);
      const frontFacingDot = Math.max(
        dotVectors(outwardNormal, viewDirection),
        dotVectors(inwardNormal, viewDirection),
      );
      minimumFrontFacingDot = Math.min(minimumFrontFacingDot, frontFacingDot);
    }

    for (let index = 0; index < fineEdge.length; index += 1) {
      const coordinate =
        fineParameterStart +
        (fineParameterEnd - fineParameterStart) * (index / TILE_SEGMENTS);
      const finePoint = fineEdge[index];
      const fineRadius = Math.hypot(finePoint.x, finePoint.y, finePoint.z);
      const coarseRadius = interpolatedCoarseRadius(
        coarseEdge,
        coarseParameterStart,
        coarseParameterEnd,
        coordinate,
      );
      const gap = Math.abs(fineRadius - coarseRadius);
      const fineIsCoveringHere = fineRadius >= coarseRadius;
      const coveringDepth = fineIsCoveringHere ? fineDepth : coarseDepth;
      recordLevelGap(
        gapByLevel,
        fineIsCoveringHere ? fine.level : coarse.level,
        gap,
        coveringDepth,
      );
      const ratio = gap / Math.max(coveringDepth, 1e-9);
      if (ratio > maximumRatio) {
        maximumRatio = ratio;
        maximumRatioContext = [
          `${fine.face} L${fine.level} ${fine.x},${fine.y}`,
          `${coarse.face} L${coarse.level} ${coarse.x},${coarse.y}`,
          `gap=${gap.toFixed(2)}m`,
          `depth=${coveringDepth.toFixed(2)}m`,
          `edge=${fineEdgeIndex}/${coarseEdgeIndex}`,
          `vertex=${index}`,
        ].join(' ');
      }
    }
  };

  const measureCrossFaceContacts = (fine: TileInfo, coarse: TileInfo): void => {
    const fineBoundaryEdges = cubeBoundaryEdges(fine);
    const coarseBoundaryEdges = cubeBoundaryEdges(coarse);
    for (const fineEdge of fineBoundaryEdges) {
      for (const coarseEdge of coarseBoundaryEdges) {
        if (fineEdge.id !== coarseEdge.id) continue;
        const overlap =
          Math.min(
            Math.max(fineEdge.parameterStart, fineEdge.parameterEnd),
            Math.max(coarseEdge.parameterStart, coarseEdge.parameterEnd),
          ) -
          Math.max(
            Math.min(fineEdge.parameterStart, fineEdge.parameterEnd),
            Math.min(coarseEdge.parameterStart, coarseEdge.parameterEnd),
          );
        if (overlap <= edgeEpsilon) continue;
        measureContact({
          coarse,
          coarseEdgeIndex: coarseEdge.edge,
          coarseParameterEnd: coarseEdge.parameterEnd,
          coarseParameterStart: coarseEdge.parameterStart,
          fine,
          fineEdgeIndex: fineEdge.edge,
          fineParameterEnd: fineEdge.parameterEnd,
          fineParameterStart: fineEdge.parameterStart,
        });
      }
    }
  };

  for (let leftIndex = 0; leftIndex < selected.length; leftIndex += 1) {
    for (let rightIndex = leftIndex + 1; rightIndex < selected.length; rightIndex += 1) {
      const left = selected[leftIndex];
      const right = selected[rightIndex];
      if (left.level === right.level) continue;
      const fineIsLeft = left.level > right.level;
      const fine = fineIsLeft ? left : right;
      const coarse = fineIsLeft ? right : left;
      const contact = edgeContact(left, right);
      if (contact) {
        const axis = contact.axis;
        measureContact({
          coarse,
          coarseEdgeIndex: fineIsLeft ? contact.edgeB : contact.edgeA,
          coarseParameterEnd: axis === 'u' ? coarse.bounds.u1 : coarse.bounds.v1,
          coarseParameterStart: axis === 'u' ? coarse.bounds.u0 : coarse.bounds.v0,
          fine,
          fineEdgeIndex: fineIsLeft ? contact.edgeA : contact.edgeB,
          fineParameterEnd: axis === 'u' ? fine.bounds.u1 : fine.bounds.v1,
          fineParameterStart: axis === 'u' ? fine.bounds.u0 : fine.bounds.v0,
        });
        continue;
      }
      if (left.face === right.face) continue;
      measureCrossFaceContacts(fine, coarse);
    }
  }
  assert.ok(contacts > 0, 'representative selection had no mixed-LOD edge contacts');
  assert.ok(
    maximumRatio <= 1,
    `mixed-LOD displacement exceeded skirt depth (${maximumRatio.toFixed(3)}x: ${maximumRatioContext})`,
  );
  assert.ok(
    minimumFrontFacingDot > 1e-6,
    `covering skirt became edge-on from both adjacent tile views (${minimumFrontFacingDot})`,
  );
  return { contacts, maximumRatio, maximumRatioContext, minimumFrontFacingDot };
}

/**
 * How many skirt edges the vertex shader collapses on a real selection.
 *
 * `terrain-node-material.ts` drops the wall on any edge whose delta is exactly
 * 0 — a same-level, same-face neighbour in the rendered set. This measures the
 * payoff and, more importantly, pins the two ways it can silently break: a
 * suppression rate of zero means the optimisation stopped firing and every tile
 * is paying for four invisible walls again, and a cross-face edge that ever
 * reports 0 means a seam the morph cannot model just lost its only cover.
 */
function validateSkirtSuppression(selections: TileInfo[][]): {
  crossFaceEdges: number;
  suppressedEdgeFraction: number;
  suppressedEdges: number;
  totalEdges: number;
} {
  const deltas: [number, number, number, number] = [0, 0, 0, 0];
  let crossFaceEdges = 0;
  let suppressedEdges = 0;
  let totalEdges = 0;
  for (const selected of selections) {
    const renderedKeys = new Set(
      selected.map((info) => tileKey(info.face, info.level, info.x, info.y)),
    );
    for (const info of selected) {
      resolveEdgeDeltas(info, renderedKeys, deltas);
      const tilesPerAxis = 2 ** info.level;
      // Edge order is `edge-deltas`': top, right, bottom, left.
      const atFaceBoundary = [
        info.y === 0,
        info.x === tilesPerAxis - 1,
        info.y === tilesPerAxis - 1,
        info.x === 0,
      ];
      for (let edge = 0; edge < 4; edge += 1) {
        totalEdges += 1;
        if (atFaceBoundary[edge]) {
          crossFaceEdges += 1;
          assert.equal(
            deltas[edge],
            EDGE_NEIGHBOUR_ABSENT,
            `cross-face edge ${edge} of L${info.level} ${info.face} ${info.x},${info.y} resolved a neighbour it cannot model`,
          );
          continue;
        }
        if (deltas[edge] === 0) suppressedEdges += 1;
      }
    }
  }
  assert.ok(
    crossFaceEdges > 0,
    'no cube-boundary tile was exercised — the cross-face assertion never ran',
  );
  assert.ok(
    suppressedEdges > 0,
    'no skirt edge was suppressed — every tile is drawing four invisible walls',
  );
  return {
    crossFaceEdges,
    suppressedEdgeFraction: suppressedEdges / Math.max(totalEdges, 1),
    suppressedEdges,
    totalEdges,
  };
}

function validateTerrainTile(
  selected: TileInfo[],
): { finestSkirtDepthMeters: number; finestTriangleSpanMeters: number } {
  const finest = selected
    .filter((info) => info.level === RENDER_SURFACE_LEVEL)
    .sort((left, right) => left.spanMeters - right.spanMeters)[0];
  assert.ok(finest, `ground selection never reached L${RENDER_SURFACE_LEVEL}`);
  const buffers = buildTerrainTileBuffers(finest, planet, seed);
  assert.ok(isValidTerrainTileBuffers(buffers));
  for (
    let offset = TERRAIN_SURFACE_VERTEX_COUNT * TERRAIN_PACKED_COMPONENTS;
    offset < buffers.normals.length;
    offset += TERRAIN_PACKED_COMPONENTS
  ) {
    assert.notDeepEqual(
      [buffers.normals[offset], buffers.normals[offset + 1], buffers.normals[offset + 2]],
      [0, 0, 0],
    );
  }
  const finestTriangleSpanMeters = finest.spanMeters / TILE_SEGMENTS;
  assert.ok(
    finestTriangleSpanMeters < 6,
    `finest triangle span remained ${finestTriangleSpanMeters.toFixed(2)} m`,
  );
  const finestSkirtDepthMeters = Math.max(
    ...[0, 1, 2, 3].map((edge) => edgeSkirtDepthMeters(finest, buffers, edge)),
  );
  assert.ok(
    Math.abs(finestSkirtDepthMeters - TERRAIN_SKIRT_MIN_DEPTH_METERS) < 0.1,
    `finest skirt depth regressed to ${finestSkirtDepthMeters.toFixed(2)} m`,
  );
  return { finestSkirtDepthMeters, finestTriangleSpanMeters };
}

/**
 * The paged height field must be the *same* field, not a close one.
 *
 * Two independent claims are checked:
 *  1. A tile's raster reproduces `sampleSurfaceHeightDetails` exactly at every
 *     grid corner — strict equality, no tolerance. The raster is built from the
 *     global grid coordinate while the mesh builder walks tile bounds; those are
 *     algebraically equal but not automatically bit-equal, and any drift lands
 *     straight in the mesh-vs-foot budget.
 *  2. Sampling through a resident page returns exactly what the analytic path
 *     returns. This is the property that lets foot placement, vegetation and
 *     colliders read pages without diverging from the rendered mesh.
 */
function validateHeightPageAgreement(selected: TileInfo[]): {
  checkedCorners: number;
  checkedProbes: number;
} {
  const tile =
    selected.find((info) => info.level === RENDER_SURFACE_LEVEL) ?? selected[0];
  assert.ok(tile, 'no tile available for height page validation');

  const raster = buildTileHeightRaster(
    { face: tile.face, level: tile.level, x: tile.x, y: tile.y },
    planet,
    seed,
  );
  assert.ok(isValidTileHeightRaster(raster), 'raster failed its own shape check');

  const cellsPerFace = 2 ** tile.level * TILE_SEGMENTS;
  const sampleOptions = {
    sampleSpacingMeters: renderableGridSampleSpacingMeters(planet, tile.level),
  };
  let checkedCorners = 0;
  for (let row = 0; row <= TILE_SEGMENTS; row += 1) {
    const v = -1 + ((tile.y * TILE_SEGMENTS + row) * 2) / cellsPerFace;
    for (let column = 0; column <= TILE_SEGMENTS; column += 1) {
      const u = -1 + ((tile.x * TILE_SEGMENTS + column) * 2) / cellsPerFace;
      const direction = directionFromCubeFace(tile.face, u, v);
      const expected = sampleSurfaceHeightDetails(
        planet,
        seed,
        {
          x: direction.x * planet.radiusMeters,
          y: direction.y * planet.radiusMeters,
          z: direction.z * planet.radiusMeters,
        },
        sampleOptions,
      );
      const actual = readRasterDetails(raster, rasterSampleIndex(column, row));
      assert.equal(actual.heightMeters, expected.heightMeters);
      assert.equal(actual.lakeMask, expected.lakeMask);
      assert.equal(actual.mountainRegion, expected.mountainRegion);
      assert.equal(
        actual.preRiverElevationNormalized,
        expected.preRiverElevationNormalized,
      );
      assert.equal(actual.riverStrength, expected.riverStrength);
      assert.equal(
        actual.riverWaterLevelNormalized ?? null,
        expected.riverWaterLevelNormalized ?? null,
      );
      checkedCorners += 1;
    }
  }

  // Probe interior points both ways. Clearing the memo between passes is what
  // forces the second pass to actually resolve through the page table.
  const probes: Vec3[] = [];
  for (let index = 0; index < 64; index += 1) {
    const fractionU = ((index * 37) % 61) / 61;
    const fractionV = ((index * 23) % 59) / 59;
    const u = tile.bounds.u0 + (tile.bounds.u1 - tile.bounds.u0) * fractionU;
    const v = tile.bounds.v0 + (tile.bounds.v1 - tile.bounds.v0) * fractionV;
    const direction = directionFromCubeFace(tile.face, u, v);
    probes.push({
      x: direction.x * planet.radiusMeters,
      y: direction.y * planet.radiusMeters,
      z: direction.z * planet.radiusMeters,
    });
  }

  clearHeightPages();
  resetRenderableHeightCache();
  const analytic = probes.map((probe) =>
    sampleRenderableSurfaceHeight(planet, seed, probe, tile.level),
  );

  installHeightPage(raster);
  resetRenderableHeightCache();
  const paged = probes.map((probe) =>
    sampleRenderableSurfaceHeight(planet, seed, probe, tile.level),
  );
  clearHeightPages();
  resetRenderableHeightCache();

  for (let index = 0; index < probes.length; index += 1) {
    assert.equal(
      paged[index],
      analytic[index],
      `paged sample diverged from analytic at probe ${index}`,
    );
  }

  return { checkedCorners, checkedProbes: probes.length };
}

/**
 * A tile that goes momentarily unready must fall back to a *near* ancestor.
 *
 * Reproduces the ground-level failure: build the selection, keep only the
 * selected keys alive (which is what eviction used to do), then ask for a tile
 * whose own mesh is missing. Before ancestors were retained this resolved to a
 * level-0 root — one sixth of the planet — and the suppression rule then hid
 * every ready tile beneath it, which is what read as the surface blinking out.
 */
/**
 * The GPU displacement math must land vertices exactly where the CPU builder
 * puts them.
 *
 * `tile-vertex.ts` is the reference implementation the terrain vertex shader
 * transliterates. Asserting it against `buildTerrainGrid`'s own output is the
 * only way to check a GPU displacement path without a GPU — and it is the
 * check that keeps the rendered surface on the sampled surface, which is the
 * whole mesh-vs-foot invariant.
 */
/**
 * The decomposed vertex position, evaluated the way a shader would.
 *
 * `Math.fround` after every operation is float32 arithmetic: this is a literal
 * simulation of the WGSL the material emits, and the only way to check that the
 * precision argument in `tileVertexRelativePosition` actually holds. Keep it a
 * transliteration of that function and of `terrain-node-material.ts` — if the
 * three drift apart this stops testing anything.
 */
function float32RelativePosition(
  tile: TileInfo,
  column: number,
  row: number,
  heightMeters: number,
): { x: number; y: number; z: number } {
  const f = Math.fround;
  const { axis, uAxis, vAxis } = cubeFaceBasis(tile.face);
  const cellsPerFace = f(f(2 ** tile.level) * TILE_SEGMENTS);
  const half = TILE_SEGMENTS / 2;
  const centerU = f(-1 + f(f(f(tile.x * TILE_SEGMENTS) + half) * 2) / cellsPerFace);
  const centerV = f(-1 + f(f(f(tile.y * TILE_SEGMENTS) + half) * 2) / cellsPerFace);
  const deltaU = f(f(f(column - half) * 2) / cellsPerFace);
  const deltaV = f(f(f(row - half) * 2) / cellsPerFace);

  const c0 = [
    f(axis.x + f(f(uAxis.x * centerU) + f(vAxis.x * centerV))),
    f(axis.y + f(f(uAxis.y * centerU) + f(vAxis.y * centerV))),
    f(axis.z + f(f(uAxis.z * centerU) + f(vAxis.z * centerV))),
  ];
  const d = [
    f(f(uAxis.x * deltaU) + f(vAxis.x * deltaV)),
    f(f(uAxis.y * deltaU) + f(vAxis.y * deltaV)),
    f(f(uAxis.z * deltaU) + f(vAxis.z * deltaV)),
  ];

  const lengthSquared = f(f(c0[0] * c0[0]) + f(f(c0[1] * c0[1]) + f(c0[2] * c0[2])));
  const inverseLength = f(1 / f(Math.sqrt(lengthSquared)));
  const c0DotD = f(f(c0[0] * d[0]) + f(f(c0[1] * d[1]) + f(c0[2] * d[2])));
  const dDotD = f(f(d[0] * d[0]) + f(f(d[1] * d[1]) + f(d[2] * d[2])));
  const s = f(f(f(c0DotD * 2) + dDotD) / lengthSquared);
  const r = f(Math.sqrt(f(1 + s)));
  const q = f(1 / r);
  const qMinusOne = f(-s / f(r * f(r + 1)));

  const deltaDirection = c0.map((value, index) =>
    f(f(f(value * qMinusOne) + f(d[index] * q)) * inverseLength),
  );
  const direction = c0.map((value, index) =>
    f(f(value * inverseLength) + deltaDirection[index]),
  );
  const components = direction.map((value, index) =>
    f(f(deltaDirection[index] * planet.radiusMeters) + f(value * heightMeters)),
  );
  return { x: components[0], y: components[1], z: components[2] };
}

function validateTileVertexMath(selected: TileInfo[]): {
  maxVertexPositionErrorMeters: number;
  maxEdgeMorphErrorMeters: number;
  maxFloat32VertexErrorMeters: number;
  naiveFloat32VertexErrorMeters: number;
} {
  const tile =
    selected.find((info) => info.level === RENDER_SURFACE_LEVEL) ?? selected[0];
  assert.ok(tile, 'no tile available for vertex math validation');

  const raster = buildTileHeightRaster(
    { face: tile.face, level: tile.level, x: tile.x, y: tile.y },
    planet,
    seed,
  );
  const buffers = buildTerrainTileBuffers(tile, planet, seed);

  // Reconstruct the surface grid the same way the mesh builder does, then check
  // the pure function reproduces it corner for corner.
  let maxVertexPositionErrorMeters = 0;
  for (let row = 0; row <= TILE_SEGMENTS; row += 1) {
    for (let column = 0; column <= TILE_SEGMENTS; column += 1) {
      const height = readRasterHeight(raster, rasterSampleIndex(column, row));
      const expectedDirection = directionFromCubeFace(
        tile.face,
        tile.bounds.u0 +
          ((tile.bounds.u1 - tile.bounds.u0) * column) / TILE_SEGMENTS,
        tile.bounds.v0 + ((tile.bounds.v1 - tile.bounds.v0) * row) / TILE_SEGMENTS,
      );
      const surfaceRadius = planet.radiusMeters + height;
      const expected = {
        x: expectedDirection.x * surfaceRadius - tile.centerPosition.x,
        y: expectedDirection.y * surfaceRadius - tile.centerPosition.y,
        z: expectedDirection.z * surfaceRadius - tile.centerPosition.z,
      };
      const actual = tileVertexPosition(tile, planet, column, row, height);
      maxVertexPositionErrorMeters = Math.max(
        maxVertexPositionErrorMeters,
        Math.hypot(actual.x - expected.x, actual.y - expected.y, actual.z - expected.z),
      );
    }
  }
  assert.ok(
    maxVertexPositionErrorMeters < 1e-6,
    `GPU vertex math drifted ${maxVertexPositionErrorMeters} m from the CPU grid`,
  );

  // The shader does not get float64. Displacing a tile is `direction * (radius +
  // height) - tileCentre`, and in float32 both terms are ~6.37e6, where the
  // representable spacing is half a metre — so the obvious formulation quantises
  // every vertex of a 3 m quad onto a half-metre lattice. Check that the
  // decomposition the shader actually uses does not, and measure the naive form
  // alongside it so the gap is visible rather than asserted on faith.
  let maxFloat32VertexErrorMeters = 0;
  let naiveFloat32VertexErrorMeters = 0;
  for (let row = 0; row <= TILE_SEGMENTS; row += 1) {
    for (let column = 0; column <= TILE_SEGMENTS; column += 1) {
      const height = readRasterHeight(raster, rasterSampleIndex(column, row));
      const truth = tileVertexPosition(tile, planet, column, row, height);
      const decomposed = float32RelativePosition(tile, column, row, height);
      maxFloat32VertexErrorMeters = Math.max(
        maxFloat32VertexErrorMeters,
        Math.hypot(
          decomposed.x - truth.x,
          decomposed.y - truth.y,
          decomposed.z - truth.z,
        ),
      );

      const direction = directionFromCubeFace(
        tile.face,
        tile.bounds.u0 +
          ((tile.bounds.u1 - tile.bounds.u0) * column) / TILE_SEGMENTS,
        tile.bounds.v0 + ((tile.bounds.v1 - tile.bounds.v0) * row) / TILE_SEGMENTS,
      );
      const radius = Math.fround(planet.radiusMeters + height);
      const naive = {
        x: Math.fround(
          Math.fround(Math.fround(direction.x) * radius) -
            Math.fround(tile.centerPosition.x),
        ),
        y: Math.fround(
          Math.fround(Math.fround(direction.y) * radius) -
            Math.fround(tile.centerPosition.y),
        ),
        z: Math.fround(
          Math.fround(Math.fround(direction.z) * radius) -
            Math.fround(tile.centerPosition.z),
        ),
      };
      naiveFloat32VertexErrorMeters = Math.max(
        naiveFloat32VertexErrorMeters,
        Math.hypot(naive.x - truth.x, naive.y - truth.y, naive.z - truth.z),
      );
    }
  }
  // A quad at the finest LOD spans a few metres; a centimetre of vertex noise is
  // invisible, and anything approaching the naive form's error is not.
  assert.ok(
    maxFloat32VertexErrorMeters < 0.02,
    `float32 vertex placement drifted ${maxFloat32VertexErrorMeters} m — the shader will visibly quantise`,
  );

  // The reference function and its float32 twin must agree, or the twin is
  // testing something the shader does not do.
  const referenceSample = tileVertexRelativePosition(tile, planet, 5, 7, 123.5);
  const referenceTruth = tileVertexPosition(tile, planet, 5, 7, 123.5);
  assert.ok(
    Math.hypot(
      referenceSample.relative.x - referenceTruth.x,
      referenceSample.relative.y - referenceTruth.y,
      referenceSample.relative.z - referenceTruth.z,
    ) < 1e-6,
    'decomposed vertex position disagrees with the direct form',
  );

  // Geomorph endpoints must be exact, or an idle tile would sit slightly off
  // its own surface and foot placement would disagree with what is drawn.
  assert.equal(geomorphHeight(123.5, -40.25, 1), 123.5);
  assert.equal(geomorphHeight(123.5, -40.25, 0), -40.25);

  // Edge morph must reproduce the coarser neighbour's straight edge segment:
  // even indices keep their own height, odd indices land on the midpoint.
  const edgeHeights = (index: number) =>
    readRasterHeight(raster, rasterSampleIndex(index, 0));
  let maxEdgeMorphErrorMeters = 0;
  for (let index = 0; index <= TILE_SEGMENTS; index += 1) {
    const morphed = edgeMorphedHeight(index, 1, edgeHeights);
    if (index % 2 === 0) {
      maxEdgeMorphErrorMeters = Math.max(
        maxEdgeMorphErrorMeters,
        Math.abs(morphed - edgeHeights(index)),
      );
      continue;
    }
    const expected = (edgeHeights(index - 1) + edgeHeights(index + 1)) * 0.5;
    maxEdgeMorphErrorMeters = Math.max(
      maxEdgeMorphErrorMeters,
      Math.abs(morphed - expected),
    );
  }
  assert.ok(
    maxEdgeMorphErrorMeters < 1e-9,
    `edge morph drifted ${maxEdgeMorphErrorMeters} m from the coarse edge`,
  );

  // A vertex not on an edge must never be touched by edge morphing.
  assert.equal(tileEdgeMask(1, 1), 0);
  assert.equal(tileEdgeMask(0, 0), 1 | 8);
  assert.equal(tileEdgeMask(TILE_SEGMENTS, TILE_SEGMENTS), 2 | 4);

  assert.ok(buffers.positions.length > 0, 'CPU builder produced no positions');
  return {
    maxVertexPositionErrorMeters,
    maxEdgeMorphErrorMeters,
    maxFloat32VertexErrorMeters,
    naiveFloat32VertexErrorMeters,
  };
}

/**
 * The water manager skips building a tile whose terrain raster proves it holds
 * no water. A false negative there does not degrade quality, it deletes a lake —
 * so every tile the builder actually produces geometry for must be one the
 * cheap test would have let through.
 */
function assertWaterSkipAgrees(info: TileInfo, label: string): void {
  const raster = buildTileHeightRaster(
    { face: info.face, level: info.level, x: info.x, y: info.y },
    planet,
    seed,
  );
  assert.ok(
    rasterMayContainWater(
      raster,
      Math.max(
        oceanWaterLevelMeters(),
        lakeWaterTableNormalized() * planet.terrainAmplitudeMeters,
      ),
      SHORE_PADDING_METERS,
    ),
    `${label} produced water geometry but the raster water test would have skipped it`,
  );
}

/** Lets an in-flight disk lookup settle so the next request can build. */
function settle(): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, 0));
}

async function validateNearAncestorFallback(selected: TileInfo[]): Promise<{
  worstFallbackLevelGap: number;
}> {
  const target = selected.find((info) => info.level === RENDER_SURFACE_LEVEL);
  assert.ok(target, 'no finest-level tile for ancestor fallback validation');

  const gridRenderer = createTerrainGridRenderer(planet);
  const cache = createTileMeshCache({ gridRenderer, planet, seed });
  try {
    // Warm the ladder the way a frame does, then retain it the way the manager
    // now does, and evict everything else.
    const ancestorKeys = new Set<string>();
    retainFallbackAncestors(target, planet, ancestorKeys);
    let current: TileInfo | null = parentTileInfo(target, planet);
    while (current) {
      // First request registers the tile and starts its disk lookup; the entry
      // sits in 'loading-disk' until that settles, and only then may the second
      // request build it synchronously. One sync build is allowed per frame, so
      // reset the frame counters for each rung.
      cache.resetFrameCounters();
      cache.requestBestAvailableTile(current, { remaining: 64 });
      await settle();
      cache.resetFrameCounters();
      cache.requestBestAvailableTile(current, { remaining: 64 });
      current = parentTileInfo(current, planet);
    }

    const warmedReady = cache.countEntries('ready');
    cache.setFrameNumber(10_000);
    cache.evictTileMeshes(new Set(ancestorKeys));
    const retainedReady = cache.countEntries('ready');

    const resolved = cache.requestBestAvailableTile(target, { remaining: 0 });
    assert.ok(
      warmedReady > CUBE_FACES.length,
      `ancestor ladder never built (ready=${warmedReady}); ` +
        'the harness is not exercising the fallback path',
    );
    assert.ok(
      retainedReady > CUBE_FACES.length,
      `retained ancestors were evicted (ready ${warmedReady} -> ${retainedReady})`,
    );
    assert.ok(resolved.ready, 'retained-ancestor fallback returned a terrain hole');
    const gap = target.level - resolved.info.level;
    assert.ok(
      gap <= MAX_FALLBACK_SUPPRESSION_LEVELS,
      `unready tile fell back ${gap} levels (to L${resolved.info.level}); ` +
        'retained ancestors should have caught it within ' +
        `${MAX_FALLBACK_SUPPRESSION_LEVELS}`,
    );

    // And the suppression rule must not let a far-coarser cover hide a ready
    // fine tile, which is the second half of the failure.
    const rootKeys = new Set([tileKey(target.face, 0, 0, 0)]);
    assert.equal(
      selectedTileAncestorLevel(target, rootKeys),
      0,
      'root should still be recognised as an ancestor',
    );
    assert.ok(
      target.level - 0 > MAX_FALLBACK_SUPPRESSION_LEVELS,
      'a root cover must fall outside the suppression gap at the finest level',
    );
    return { worstFallbackLevelGap: gap };
  } finally {
    cache.dispose();
    gridRenderer.dispose();
  }
}

async function main(): Promise<TerrainValidationSummary> {
  const representativeDirection = normalize({ x: 1, y: 0.13, z: -0.22 });
  const representativeBody = bodyPositionAt(representativeDirection, 2);
  selectedTilesForBody(representativeBody, 2);
  const selectionStart = performance.now();
  let selected: TileInfo[] = [];
  for (let run = 0; run < 100; run += 1) {
    selected = selectedTilesForBody(representativeBody, 2);
  }
  const selectionMilliseconds = (performance.now() - selectionStart) / 100;
  // The corrected L16/900 m baseline selects 229 tiles at this probe. L17/450 m
  // should stay in the same envelope while halving triangle span.
  assert.ok(selected.length <= 320, `ground selection expanded to ${selected.length} tiles`);
  assert.equal(
    Math.max(...selected.map((info) => info.level)),
    RENDER_SURFACE_LEVEL,
  );
  const finestSelectedTiles = selected.filter(
    (info) => info.level === RENDER_SURFACE_LEVEL,
  ).length;
  assert.ok(
    finestSelectedTiles <= 200,
    `ground selection expanded to ${finestSelectedTiles} finest tiles`,
  );

  const fallbackCoverage = validateFallbackCoverage(selected);
  const horizonTileCounts = validateHorizonCoverage();
  const highlandGroundDetail = validateHighlandGroundDetail();
  const maxUniformLodSpacingErrorMeters = validateUniformLodSampleSpacing();
  const maxVisibleFrameHeightErrorMeters = validateVisibleFrames();
  const meshFootAgreement = validateMeshFootAgreement(selected);
  const sameLodSeams = validateSameLodSeams();
  const hydrology = getRiverNetworkDiagnostics(planet, seed);
  const lakeSurfaces = validateLevelLakeSurfaces();
  validateHydrologyDestination('lake');
  validateHydrologyDestination('river');
  const coastTeleport = validateCoastDestination();
  assert.ok(hydrology.routes > 0);
  assert.ok(hydrology.confluences > 0);
  assert.equal(hydrology.centerlineSamplesBeyondCarveDepth, 0);
  assert.ok(hydrology.maximumWaterRiseNormalized <= Number.EPSILON);
  const seamSelections = [
    selected,
    selectedTilesAt({ x: -0.37, y: 0.91, z: 0.18 }, 2),
    selectedTilesAt({ x: 0.22, y: -0.31, z: -1 }, 2),
    selectedTilesAt({ x: 1, y: 0.2, z: 1 }, 2),
  ];
  let contacts = 0;
  let maximumRatio = 0;
  let maximumRatioContext = '';
  let minimumFrontFacingDot = 1;
  const skirtGapByLevel: SkirtGapByLevel = new Map();
  for (const seamSelection of seamSelections) {
    const result = validateMixedLodSkirts(seamSelection, skirtGapByLevel);
    contacts += result.contacts;
    if (result.maximumRatio > maximumRatio) {
      maximumRatio = result.maximumRatio;
      maximumRatioContext = result.maximumRatioContext;
    }
    minimumFrontFacingDot = Math.min(
      minimumFrontFacingDot,
      result.minimumFrontFacingDot,
    );
  }
  const { finestSkirtDepthMeters, finestTriangleSpanMeters } =
    validateTerrainTile(selected);
  // Includes the seam selections: those are the ones positioned to straddle
  // cube edges, so they are what exercises the cross-face assertion.
  const skirtSuppression = validateSkirtSuppression([selected, ...seamSelections]);
  const heightPages = validateHeightPageAgreement(selected);
  const nearAncestor = await validateNearAncestorFallback(selected);
  const vertexMath = validateTileVertexMath(selected);

  return {
    coastTeleportHeightMeters: coastTeleport.coastTeleportHeightMeters,
    coastTeleportOceanNeighbors: coastTeleport.coastTeleportOceanNeighbors,
    coastTeleportReliefMeters: coastTeleport.coastTeleportReliefMeters,
    coastTeleportWaterDepthMeters: coastTeleport.coastTeleportWaterDepthMeters,
    coastWaterGeometryVertices: coastTeleport.coastWaterGeometryVertices,
    coldCacheFallbackLevel: fallbackCoverage.coldCacheFallbackLevel,
    fallbackChainMinimumLevel: fallbackCoverage.fallbackChainMinimumLevel,
    finestSelectedTiles,
    finestSkirtDepthMeters,
    heightPageCheckedCorners: heightPages.checkedCorners,
    heightPageCheckedProbes: heightPages.checkedProbes,
    worstFallbackLevelGap: nearAncestor.worstFallbackLevelGap,
    maxVertexPositionErrorMeters: vertexMath.maxVertexPositionErrorMeters,
    maxEdgeMorphErrorMeters: vertexMath.maxEdgeMorphErrorMeters,
    maxFloat32VertexErrorMeters: vertexMath.maxFloat32VertexErrorMeters,
    naiveFloat32VertexErrorMeters: vertexMath.naiveFloat32VertexErrorMeters,
    finestTriangleSpanMeters,
    highlandProbeHeightMeters: highlandGroundDetail.heightMeters,
    highlandSelectedLevel: highlandGroundDetail.selectedLevel,
    highlandSelectedTiles: highlandGroundDetail.selectedTiles,
    horizonTileCounts,
    hydrology,
    lakeSurfaceLevelMeters: lakeSurfaces.lakeSurfaceLevelMeters,
    lakeSurfaceSamples: lakeSurfaces.lakeSurfaceSamples,
    lakeUnderlyingBiome: lakeSurfaces.lakeUnderlyingBiome,
    maxLakeSurfStrength: lakeSurfaces.maxLakeSurfStrength,
    maxLakeSurfaceLevelErrorMeters: lakeSurfaces.maxLakeSurfaceLevelErrorMeters,
    maxGroundMeshFootHeightErrorMeters:
      meshFootAgreement.maximumGroundHeightErrorMeters,
    maxCoastWaterSurfaceLevelErrorMeters:
      coastTeleport.maxCoastWaterSurfaceLevelErrorMeters,
    maxMeshFootHeightErrorMeters: meshFootAgreement.maximumHeightErrorMeters,
    maxMixedLodGapToSkirtRatio: maximumRatio,
    maxMixedLodGapContext: maximumRatioContext,
    skirtGapByLevel: Object.fromEntries(
      [...skirtGapByLevel.entries()]
        .sort((left, right) => left[0] - right[0])
        .map(([level, entry]) => [
          `L${level}`,
          {
            depthMeters: Number(entry.depthMeters.toFixed(2)),
            gapMeters: Number(entry.gapMeters.toFixed(2)),
          },
        ]),
    ),
    suppressedSkirtEdgeFraction: skirtSuppression.suppressedEdgeFraction,
    suppressedSkirtEdges: skirtSuppression.suppressedEdges,
    skirtEdgesTotal: skirtSuppression.totalEdges,
    skirtEdgesCrossFace: skirtSuppression.crossFaceEdges,
    maxSameLodSeamErrorMeters: sameLodSeams.maximumErrorMeters,
    maxSameLodSeamContext: sameLodSeams.maximumErrorContext,
    sameLodSameFaceSeamErrorByLevel: sameLodSeams.sameFaceErrorByLevel,
    maxUniformLodSpacingErrorMeters,
    maxVisibleFrameHeightErrorMeters,
    minimumSkirtFrontFacingDot: minimumFrontFacingDot,
    minimumGroundMeshFootNormalDot: meshFootAgreement.minimumGroundNormalDot,
    mixedLodContacts: contacts,
    pinnedFallbackRoots: fallbackCoverage.pinnedFallbackRoots,
    sameLodSeamContacts: sameLodSeams.contacts,
    selectedTiles: selected.length,
    selectionMilliseconds,
  };
}

main()
  .then((summary) => console.log(JSON.stringify(summary, null, 2)))
  .catch((error) => {
    console.error(error);
    process.exitCode = 1;
  });
