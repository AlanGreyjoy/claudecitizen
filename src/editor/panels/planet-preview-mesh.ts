import * as THREE from 'three';
import type { Biome, LandingSiteHint, Planet } from '../../types';
import { oceanWaterLevelMeters } from '../../world/coastal_profile';
import { cartesianFromLatLonAlt } from '../../world/coordinates';
import { sampleSurfaceHeight } from '../../world/elevation';
import type { SurfaceDestination } from '../../world/biome_teleport';
import { samplePlanetSurface } from '../../world/planet_surface';
import type { PlanetSurfacePalette } from '../../world/planets/schema';

export interface PlanetPreviewMeshDiagnostics {
  centerBiome: Biome;
  centerWater: string;
  coverage: number;
  maxHeight: number;
  maxSlopeDegrees: number;
  meanMoisture: number;
  meanTemperature: number;
  minHeight: number;
}

export interface PlanetPreviewMeshPatch {
  halfLatExtentRadians: number;
  halfLonExtentRadians: number;
  heightScale: number;
  hint: LandingSiteHint;
  patchExtentMeters: number;
}

export interface PlanetPreviewMeshInput {
  planet: Planet;
  seed: number;
  patch: PlanetPreviewMeshPatch;
  segments: number;
  palette: PlanetSurfacePalette & { ocean: string; lake: string; river: string; coast: string };
  coastMaxHeightMeters: number;
  activePreviewDestination: SurfaceDestination | null;
}

export interface PlanetPreviewMeshResult {
  terrainMesh: THREE.Mesh;
  waterMesh: THREE.Mesh | null;
  diagnostics: PlanetPreviewMeshDiagnostics;
  midHeight: number;
}

function hexToRgb(hex: string): [number, number, number] {
  const value = Number.parseInt(hex.slice(1), 16);
  return [((value >> 16) & 255) / 255, ((value >> 8) & 255) / 255, (value & 255) / 255];
}

function matchesPreviewDestination(
  destination: SurfaceDestination | null,
  surface: ReturnType<typeof samplePlanetSurface>,
  isCoast: boolean,
): boolean {
  if (destination === 'coast') return isCoast;
  if (destination === 'lake' || destination === 'river') {
    return surface.waterBody === destination;
  }
  if (destination != null) {
    return surface.waterBody == null && surface.biome === destination;
  }
  return false;
}

function isCoastSurface(
  surface: ReturnType<typeof samplePlanetSurface>,
  oceanLevel: number,
  coastMaxHeightMeters: number,
): boolean {
  return (
    surface.waterBody == null &&
    surface.lakeWaterLevelMeters == null &&
    surface.riverWaterLevelMeters == null &&
    surface.heightMeters >= oceanLevel + 1.5 &&
    surface.heightMeters <= coastMaxHeightMeters
  );
}

interface PreviewGridSample {
  positions: number[];
  colors: number[];
  heights: Float64Array;
  waterLevels: Float64Array;
  waterKinds: Uint8Array;
  minHeight: number;
  maxHeight: number;
  moistureTotal: number;
  temperatureTotal: number;
  targetMatches: number;
  centerSurface: ReturnType<typeof samplePlanetSurface> | null;
  sampleCount: number;
}

interface PreviewVertexSample {
  height: number;
  moisture: number;
  temperature: number;
  isCoast: boolean;
  matchesTarget: boolean;
  color: [number, number, number];
  waterLevel: number;
  waterKind: number;
  surface: ReturnType<typeof samplePlanetSurface>;
}

function samplePreviewVertex(
  input: PlanetPreviewMeshInput,
  x: number,
  y: number,
  oceanLevel: number,
): PreviewVertexSample {
  const { planet, seed, patch, segments, palette, coastMaxHeightMeters, activePreviewDestination } =
    input;
  const { halfLatExtentRadians, halfLonExtentRadians, hint } = patch;
  const u = x / segments;
  const v = y / segments;
  const lat = hint.latRadians + (v - 0.5) * 2 * halfLatExtentRadians;
  const lon = hint.lonRadians + (u - 0.5) * 2 * halfLonExtentRadians;
  const probe = cartesianFromLatLonAlt(lat, lon, 0, planet.radiusMeters);
  const surface = samplePlanetSurface(planet, seed, probe);
  const isCoast = isCoastSurface(surface, oceanLevel, coastMaxHeightMeters);
  const color = hexToRgb(
    isCoast ? palette.coast : (palette as PlanetSurfacePalette)[surface.biome] ?? '#719447',
  );
  const hasWater = surface.waterBody != null && surface.waterLevelMeters != null;
  return {
    height: surface.heightMeters,
    moisture: surface.moisture,
    temperature: surface.temperature,
    isCoast,
    matchesTarget: matchesPreviewDestination(activePreviewDestination, surface, isCoast),
    color,
    waterLevel: hasWater ? surface.waterLevelMeters! : Number.NaN,
    waterKind: hasWater
      ? surface.waterBody === 'ocean' ? 2 : surface.waterBody === 'river' ? 3 : 1
      : 0,
    surface,
  };
}

function samplePreviewGrid(input: PlanetPreviewMeshInput): PreviewGridSample {
  const { patch, segments } = input;
  const { heightScale, patchExtentMeters } = patch;
  const gridWidth = segments + 1;
  const positions: number[] = [];
  const colors: number[] = [];
  const heights = new Float64Array(gridWidth * gridWidth);
  const waterLevels = new Float64Array(gridWidth * gridWidth);
  const waterKinds = new Uint8Array(gridWidth * gridWidth);
  let minHeight = Infinity;
  let maxHeight = -Infinity;
  let moistureTotal = 0;
  let temperatureTotal = 0;
  let targetMatches = 0;
  let centerSurface: ReturnType<typeof samplePlanetSurface> | null = null;
  const oceanLevel = oceanWaterLevelMeters();

  for (let y = 0; y <= segments; y += 1) {
    for (let x = 0; x <= segments; x += 1) {
      const u = x / segments;
      const v = y / segments;
      const localX = (u - 0.5) * patchExtentMeters;
      const localZ = (v - 0.5) * patchExtentMeters;
      const vertex = y * gridWidth + x;
      const sample = samplePreviewVertex(input, x, y, oceanLevel);
      heights[vertex] = sample.height;
      minHeight = Math.min(minHeight, sample.height);
      maxHeight = Math.max(maxHeight, sample.height);
      moistureTotal += sample.moisture;
      temperatureTotal += sample.temperature;
      if (x === segments / 2 && y === segments / 2) centerSurface = sample.surface;
      if (sample.matchesTarget) targetMatches += 1;
      positions.push(localX, sample.height * heightScale, localZ);
      colors.push(sample.color[0], sample.color[1], sample.color[2]);
      waterLevels[vertex] = sample.waterLevel;
      waterKinds[vertex] = sample.waterKind;
    }
  }

  return {
    positions,
    colors,
    heights,
    waterLevels,
    waterKinds,
    minHeight,
    maxHeight,
    moistureTotal,
    temperatureTotal,
    targetMatches,
    centerSurface,
    sampleCount: gridWidth * gridWidth,
  };
}

function computeMaxSlopeRadians(
  heights: Float64Array,
  gridWidth: number,
  segments: number,
  cellSpanMeters: number,
): number {
  let maxSlopeRadians = 0;
  for (let y = 1; y < segments; y += 1) {
    for (let x = 1; x < segments; x += 1) {
      const center = y * gridWidth + x;
      const riseX = (heights[center + 1]! - heights[center - 1]!) / 2;
      const riseZ = (heights[center + gridWidth]! - heights[center - gridWidth]!) / 2;
      maxSlopeRadians = Math.max(
        maxSlopeRadians,
        Math.atan(Math.hypot(riseX, riseZ) / cellSpanMeters),
      );
    }
  }
  return maxSlopeRadians;
}

function buildTerrainIndices(segments: number, gridWidth: number): number[] {
  const indices: number[] = [];
  for (let y = 0; y < segments; y += 1) {
    for (let x = 0; x < segments; x += 1) {
      const a = y * gridWidth + x;
      const b = a + 1;
      const c = a + gridWidth;
      const d = c + 1;
      indices.push(a, c, b, b, c, d);
    }
  }
  return indices;
}

function createTerrainMesh(positions: number[], colors: number[], indices: number[]): THREE.Mesh {
  const geometry = new THREE.BufferGeometry();
  geometry.setAttribute('position', new THREE.Float32BufferAttribute(positions, 3));
  geometry.setAttribute('color', new THREE.Float32BufferAttribute(colors, 3));
  geometry.setIndex(indices);
  geometry.computeVertexNormals();
  return new THREE.Mesh(
    geometry,
    new THREE.MeshStandardMaterial({
      vertexColors: true,
      roughness: 0.92,
      metalness: 0.02,
      flatShading: true,
    }),
  );
}

interface WaterMeshBuffers {
  positions: number[];
  colors: number[];
  indices: number[];
}

function resolveWaterTint(
  oceanCount: number,
  riverCount: number,
  oceanRgb: [number, number, number],
  lakeRgb: [number, number, number],
  riverRgb: [number, number, number],
  shallowRgb: [number, number, number],
): [number, number, number] {
  if (oceanCount >= 2) {
    return [
      oceanRgb[0] * 0.55 + shallowRgb[0] * 0.45,
      oceanRgb[1] * 0.55 + shallowRgb[1] * 0.45,
      oceanRgb[2] * 0.55 + shallowRgb[2] * 0.45,
    ];
  }
  if (riverCount >= 2) return riverRgb;
  return lakeRgb;
}

interface WaterCellContext {
  segments: number;
  gridWidth: number;
  patchExtentMeters: number;
  heightScale: number;
  tintPalette: {
    oceanRgb: [number, number, number];
    lakeRgb: [number, number, number];
    riverRgb: [number, number, number];
    shallowRgb: [number, number, number];
  };
}

function appendWaterCell(
  grid: PreviewGridSample,
  x: number,
  y: number,
  ctx: WaterCellContext,
  buffers: WaterMeshBuffers,
): void {
  const { segments, gridWidth, patchExtentMeters, heightScale, tintPalette } = ctx;
  const corners = [
    y * gridWidth + x,
    y * gridWidth + x + 1,
    (y + 1) * gridWidth + x,
    (y + 1) * gridWidth + x + 1,
  ];
  const wetCorners = corners.filter((index) => grid.waterKinds[index] !== 0);
  if (wetCorners.length === 0) return;

  const base = buffers.positions.length / 3;
  let oceanCount = 0;
  let riverCount = 0;
  for (const index of corners) {
    const u = (index % gridWidth) / segments;
    const v = Math.floor(index / gridWidth) / segments;
    const localX = (u - 0.5) * patchExtentMeters;
    const localZ = (v - 0.5) * patchExtentMeters;
    const level = grid.waterKinds[index] !== 0
      ? grid.waterLevels[index]
      : wetCorners.reduce((sum, wetIndex) => sum + grid.waterLevels[wetIndex]!, 0) /
        wetCorners.length;
    buffers.positions.push(localX, level * heightScale, localZ);
    if (grid.waterKinds[index] === 2) oceanCount += 1;
    if (grid.waterKinds[index] === 3) riverCount += 1;
  }
  const tint = resolveWaterTint(
    oceanCount,
    riverCount,
    tintPalette.oceanRgb,
    tintPalette.lakeRgb,
    tintPalette.riverRgb,
    tintPalette.shallowRgb,
  );
  for (let i = 0; i < 4; i += 1) {
    buffers.colors.push(tint[0], tint[1], tint[2]);
  }
  buffers.indices.push(base, base + 2, base + 1, base + 1, base + 2, base + 3);
}

function buildWaterMesh(
  grid: PreviewGridSample,
  segments: number,
  gridWidth: number,
  patchExtentMeters: number,
  heightScale: number,
  palette: PlanetPreviewMeshInput['palette'],
): THREE.Mesh | null {
  const buffers: WaterMeshBuffers = { positions: [], colors: [], indices: [] };
  const cellCtx: WaterCellContext = {
    segments,
    gridWidth,
    patchExtentMeters,
    heightScale,
    tintPalette: {
      oceanRgb: hexToRgb(palette.ocean),
      lakeRgb: hexToRgb(palette.lake),
      riverRgb: hexToRgb(palette.river),
      shallowRgb: hexToRgb('#3f7898'),
    },
  };

  for (let y = 0; y < segments; y += 1) {
    for (let x = 0; x < segments; x += 1) {
      appendWaterCell(grid, x, y, cellCtx, buffers);
    }
  }

  if (buffers.positions.length === 0) return null;

  const waterGeometry = new THREE.BufferGeometry();
  waterGeometry.setAttribute('position', new THREE.Float32BufferAttribute(buffers.positions, 3));
  waterGeometry.setAttribute('color', new THREE.Float32BufferAttribute(buffers.colors, 3));
  waterGeometry.setIndex(buffers.indices);
  waterGeometry.computeVertexNormals();
  const mesh = new THREE.Mesh(
    waterGeometry,
    new THREE.MeshStandardMaterial({
      vertexColors: true,
      transparent: true,
      opacity: 0.62,
      depthWrite: false,
      roughness: 0.28,
      metalness: 0.08,
      side: THREE.DoubleSide,
      polygonOffset: true,
      polygonOffsetFactor: -1,
      polygonOffsetUnits: -1,
    }),
  );
  mesh.renderOrder = 2;
  return mesh;
}

export function disposePreviewMesh(mesh: THREE.Mesh | null, scene: THREE.Scene): void {
  if (!mesh) return;
  scene.remove(mesh);
  mesh.geometry.dispose();
  (mesh.material as THREE.Material).dispose();
}

export function buildPlanetPreviewMeshes(input: PlanetPreviewMeshInput): PlanetPreviewMeshResult {
  const { planet, seed, patch, segments } = input;
  const gridWidth = segments + 1;
  const grid = samplePreviewGrid(input);
  const cellSpanMeters = patch.patchExtentMeters / segments;
  const maxSlopeRadians = computeMaxSlopeRadians(grid.heights, gridWidth, segments, cellSpanMeters);
  const resolvedCenter = grid.centerSurface ?? samplePlanetSurface(
    planet,
    seed,
    cartesianFromLatLonAlt(patch.hint.latRadians, patch.hint.lonRadians, 0, planet.radiusMeters),
  );
  const indices = buildTerrainIndices(segments, gridWidth);
  const terrainMesh = createTerrainMesh(grid.positions, grid.colors, indices);
  const waterMesh = buildWaterMesh(
    grid,
    segments,
    gridWidth,
    patch.patchExtentMeters,
    patch.heightScale,
    input.palette,
  );
  const midHeight =
    sampleSurfaceHeight(
      planet,
      seed,
      cartesianFromLatLonAlt(patch.hint.latRadians, patch.hint.lonRadians, 0, planet.radiusMeters),
    ) * patch.heightScale;

  return {
    terrainMesh,
    waterMesh,
    midHeight,
    diagnostics: {
      centerBiome: resolvedCenter.biome,
      centerWater: resolvedCenter.waterBody ?? 'dry',
      coverage: grid.targetMatches / grid.sampleCount,
      maxHeight: grid.maxHeight,
      maxSlopeDegrees: (maxSlopeRadians * 180) / Math.PI,
      meanMoisture: grid.moistureTotal / grid.sampleCount,
      meanTemperature: grid.temperatureTotal / grid.sampleCount,
      minHeight: grid.minHeight,
    },
  };
}
