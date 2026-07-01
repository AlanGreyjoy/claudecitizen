import * as THREE from 'three';
import { GLTFLoader, type GLTF } from 'three/examples/jsm/loaders/GLTFLoader';
import type {
  CubeFace,
  Planet,
  PlanetSurfaceSample,
  TileInfo,
  VegetationCacheStats,
  VegetationSettings,
  Vec3,
} from '../types';
import { distance, dot, normalize, scale } from '../math/vec3';
import { cartesianFromLatLonAlt } from '../world/coordinates';
import { directionFromCubeFace } from '../world/cube_sphere';
import { resolveLandingSite } from '../world/landing_sites';
import {
  renderableSurfacePointFromDirection,
  sampleRenderablePlanetSurface,
} from '../world/planet_surface';
import {
  DEFAULT_VEGETATION_SETTINGS,
  normalizeVegetationSettings,
} from './vegetation_settings';

const FACE_INDEX: Record<CubeFace, number> = {
  nx: 1,
  ny: 2,
  nz: 3,
  px: 4,
  py: 5,
  pz: 6,
};

const WORLD_UP = new THREE.Vector3(0, 1, 0);
const WORLD_RIGHT = new THREE.Vector3(1, 0, 0);
const scratchNormal = new THREE.Vector3();
const scratchTangent = new THREE.Vector3();
const scratchBitangent = new THREE.Vector3();
const scratchXAxis = new THREE.Vector3();
const scratchZAxis = new THREE.Vector3();
const scratchWorldPosition = new THREE.Vector3();
const scratchLocalPosition = new THREE.Vector3();
const scratchRotation = new THREE.Matrix4();
const scratchQuaternion = new THREE.Quaternion();
const scratchScale = new THREE.Vector3();
const scratchMatrix = new THREE.Matrix4();

const GRASS_SAMPLE_COUNT = 520;
const TREE_SAMPLE_COUNT = 58;
const LANDING_GRASS_COUNT = 950;
const LANDING_TREE_COUNT = 84;
const MAX_CACHED_VEGETATION_TILES = 160;
const VEGETATION_CACHE_STALE_FRAMES = 45;

interface PlacementPosition {
  x: number;
  y: number;
  z: number;
}

interface PlacementGrid {
  cellSize: number;
  cells: Map<string, PlacementPosition[]>;
  minDistanceSquared: number;
}

interface InstancedAssetPart {
  geometry: THREE.BufferGeometry;
  material: THREE.Material | THREE.Material[];
}

interface InstancedAsset {
  baseOffsetY: number;
  parts: InstancedAssetPart[];
}

interface SurfaceAnchor {
  bitangent: THREE.Vector3;
  normal: THREE.Vector3;
  position: THREE.Vector3;
  surface: PlanetSurfaceSample;
  tangent: THREE.Vector3;
}

interface InstanceEntry {
  matrix: THREE.Matrix4;
  variantIndex: number;
}

interface VegetationTileEntry {
  group: THREE.Group;
  lastUsedFrame: number;
}

interface VegetationCacheStatsAccumulator {
  peakCachedTiles: number;
  totalBuilds: number;
  totalEvictions: number;
}

export interface PlanetVegetationManager {
  dispose: () => void;
  setSettings: (nextSettings: Partial<VegetationSettings>) => void;
  update: (
    bodyPosition: Vec3,
    selectedTiles: TileInfo[],
    altitudeMeters: number,
  ) => VegetationCacheStats;
}

type AllowPlacementFn = (surface: PlanetSurfaceSample, i: number) => boolean;
type MakeScaleFn = (surface: PlanetSurfaceSample, i: number) => number;
type GetNormalOffsetFn = (surface: PlanetSurfaceSample, i: number, variantIndex: number) => number;
type MakeBasisNormalFn = (surface: PlanetSurfaceSample, direction: Vec3, i: number) => Vec3;
type MakeVariantIndexFn = (surface: PlanetSurfaceSample, i: number) => number;

function tileKey(face: CubeFace, level: number, x: number, y: number): string {
  return `${face}:${level}:${x}:${y}`;
}

function hash01(seed: number, ...values: number[]): number {
  let state = seed >>> 0;
  for (const value of values) {
    state ^= value + 0x9e3779b9 + ((state << 6) >>> 0) + (state >>> 2);
    state = Math.imul(state ^ (state >>> 16), 0x45d9f3b);
    state >>>= 0;
  }
  return state / 0xffffffff;
}

function clamp01(value: number): number {
  return Math.max(0, Math.min(1, value));
}

function lerp(start: number, end: number, t: number): number {
  return start + (end - start) * t;
}

function createPlacementGrid(minimumGapMeters: number): PlacementGrid | null {
  if (!(minimumGapMeters > 0)) return null;
  return {
    cellSize: minimumGapMeters,
    cells: new Map(),
    minDistanceSquared: minimumGapMeters * minimumGapMeters,
  };
}

function placementCellKey(cellX: number, cellY: number, cellZ: number): string {
  return `${cellX}:${cellY}:${cellZ}`;
}

function canPlaceWithGap(grid: PlacementGrid | null, position: PlacementPosition): boolean {
  if (!grid) return true;

  const cellX = Math.floor(position.x / grid.cellSize);
  const cellY = Math.floor(position.y / grid.cellSize);
  const cellZ = Math.floor(position.z / grid.cellSize);

  for (let dz = -1; dz <= 1; dz += 1) {
    for (let dy = -1; dy <= 1; dy += 1) {
      for (let dx = -1; dx <= 1; dx += 1) {
        const placements = grid.cells.get(placementCellKey(cellX + dx, cellY + dy, cellZ + dz));
        if (!placements) continue;
        for (const placed of placements) {
          const dxPos = position.x - placed.x;
          const dyPos = position.y - placed.y;
          const dzPos = position.z - placed.z;
          if (dxPos * dxPos + dyPos * dyPos + dzPos * dzPos < grid.minDistanceSquared) {
            return false;
          }
        }
      }
    }
  }

  return true;
}

function registerPlacement(grid: PlacementGrid | null, position: PlacementPosition): void {
  if (!grid) return;

  const cellX = Math.floor(position.x / grid.cellSize);
  const cellY = Math.floor(position.y / grid.cellSize);
  const cellZ = Math.floor(position.z / grid.cellSize);
  const key = placementCellKey(cellX, cellY, cellZ);
  const placements = grid.cells.get(key) ?? [];
  placements.push({ x: position.x, y: position.y, z: position.z });
  if (!grid.cells.has(key)) grid.cells.set(key, placements);
}

function scaledSampleCount(baseCount: number, densityMultiplier: number): number {
  return Math.max(0, Math.round(baseCount * densityMultiplier));
}

function buildSurfaceFrame(
  normal: THREE.Vector3,
  tangent: THREE.Vector3 = scratchTangent,
  bitangent: THREE.Vector3 = scratchBitangent,
): { bitangent: THREE.Vector3; tangent: THREE.Vector3 } {
  const reference = Math.abs(normal.y) > 0.92 ? WORLD_RIGHT : WORLD_UP;
  tangent.crossVectors(reference, normal).normalize();
  bitangent.crossVectors(normal, tangent).normalize();
  return { bitangent, tangent };
}

function buildBasisQuaternion(
  normal: THREE.Vector3,
  yawRadians: number,
  tangent: THREE.Vector3 = scratchTangent,
  bitangent: THREE.Vector3 = scratchBitangent,
): THREE.Quaternion {
  const cos = Math.cos(yawRadians);
  const sin = Math.sin(yawRadians);
  scratchXAxis.copy(tangent).multiplyScalar(cos).addScaledVector(bitangent, sin);
  scratchZAxis.crossVectors(scratchXAxis, normal).normalize();
  scratchRotation.makeBasis(scratchXAxis, normal, scratchZAxis);
  scratchQuaternion.setFromRotationMatrix(scratchRotation);
  return scratchQuaternion;
}

function configureMaterial(material: THREE.Material | undefined): THREE.Material {
  const configured = material?.clone?.() ?? material;
  if (!configured) return new THREE.MeshStandardMaterial({ color: 0x6f8f3a, side: THREE.DoubleSide });
  const meshMaterial = configured as THREE.MeshStandardMaterial;
  if (meshMaterial.map) meshMaterial.map.colorSpace = THREE.SRGBColorSpace;
  if (meshMaterial.emissiveMap) meshMaterial.emissiveMap.colorSpace = THREE.SRGBColorSpace;
  if (meshMaterial.alphaMap) meshMaterial.alphaMap.colorSpace = THREE.SRGBColorSpace;
  meshMaterial.side = THREE.DoubleSide;
  return meshMaterial;
}

function extractInstancedAsset(gltf: GLTF): InstancedAsset {
  gltf.scene.updateMatrixWorld(true);
  const parts: InstancedAssetPart[] = [];
  const bounds = new THREE.Box3();

  gltf.scene.traverse((child) => {
    if (!(child instanceof THREE.Mesh)) return;

    const geometry = child.geometry.clone();
    geometry.applyMatrix4(child.matrixWorld);
    geometry.computeBoundingBox();
    if (geometry.boundingBox) bounds.union(geometry.boundingBox);

    const material = Array.isArray(child.material)
      ? child.material.map(configureMaterial)
      : configureMaterial(child.material);
    parts.push({ geometry, material });
  });

  return {
    baseOffsetY: bounds.isEmpty() ? 0 : -bounds.min.y,
    parts,
  };
}

function addInstancedAsset(
  group: THREE.Group,
  asset: InstancedAsset | null | undefined,
  matrices: THREE.Matrix4[],
): void {
  if (!asset?.parts?.length || matrices.length === 0) return;

  for (const part of asset.parts) {
    const mesh = new THREE.InstancedMesh(part.geometry, part.material, matrices.length);
    mesh.frustumCulled = false;
    mesh.castShadow = true;
    mesh.receiveShadow = true;
    matrices.forEach((matrix, index) => mesh.setMatrixAt(index, matrix));
    mesh.instanceMatrix.needsUpdate = true;
    group.add(mesh);
  }
}

function disposeMaterial(material: THREE.Material | THREE.Material[] | undefined): void {
  if (Array.isArray(material)) {
    material.forEach(disposeMaterial);
    return;
  }
  const meshMaterial = material as THREE.MeshStandardMaterial | undefined;
  meshMaterial?.map?.dispose();
  meshMaterial?.normalMap?.dispose();
  meshMaterial?.roughnessMap?.dispose();
  meshMaterial?.metalnessMap?.dispose();
  meshMaterial?.alphaMap?.dispose();
  meshMaterial?.dispose?.();
}

function disposeInstancedAssets(assets: InstancedAsset[]): void {
  assets.forEach((asset) => {
    asset.parts.forEach((part) => {
      part.geometry.dispose();
      disposeMaterial(part.material);
    });
  });
}

function releaseVegetationGroup(parent: THREE.Group, group: THREE.Group | null): void {
  if (!group) return;
  parent.remove(group);
  group.clear();
}

function createAnchorFromDirection(direction: Vec3, planet: Planet, seed: number): SurfaceAnchor {
  const samplePos = scale(direction, planet.radiusMeters);
  const surface = sampleRenderablePlanetSurface(planet, seed, samplePos);
  const point = renderableSurfacePointFromDirection(direction, planet, seed, 0);
  const normal = new THREE.Vector3(
    surface.normal?.x ?? direction.x,
    surface.normal?.y ?? direction.y,
    surface.normal?.z ?? direction.z,
  ).normalize();
  const position = new THREE.Vector3(point.x, point.y, point.z);
  const tangent = new THREE.Vector3();
  const bitangent = new THREE.Vector3();
  buildSurfaceFrame(normal, tangent, bitangent);
  return {
    bitangent,
    normal,
    position,
    surface,
    tangent,
  };
}

function createAnchorFromTile(tileInfo: TileInfo, planet: Planet, seed: number): SurfaceAnchor {
  return createAnchorFromDirection(tileInfo.centerDirection, planet, seed);
}

function buildInstanceEntries(
  anchor: SurfaceAnchor,
  tileInfo: TileInfo,
  planet: Planet,
  seed: number,
  sampleCount: number,
  allowPlacement: AllowPlacementFn,
  makeScale: MakeScaleFn,
  getNormalOffset: GetNormalOffsetFn | null = null,
  makeBasisNormal: MakeBasisNormalFn | null = null,
  makeVariantIndex: MakeVariantIndexFn | null = null,
  minimumGapMeters = 0,
): InstanceEntry[] {
  const entries: InstanceEntry[] = [];
  const faceIndex = FACE_INDEX[tileInfo.face] ?? 0;
  const placementGrid = createPlacementGrid(minimumGapMeters);

  for (let i = 0; i < sampleCount; i += 1) {
    const uJitter = hash01(seed, faceIndex, tileInfo.level, tileInfo.x, tileInfo.y, i, 11);
    const vJitter = hash01(seed, faceIndex, tileInfo.level, tileInfo.x, tileInfo.y, i, 29);
    const u = tileInfo.bounds.u0 + (tileInfo.bounds.u1 - tileInfo.bounds.u0) * uJitter;
    const v = tileInfo.bounds.v0 + (tileInfo.bounds.v1 - tileInfo.bounds.v0) * vJitter;
    const direction = directionFromCubeFace(tileInfo.face, u, v);
    const surface = sampleRenderablePlanetSurface(planet, seed, scale(direction, planet.radiusMeters));

    if (!allowPlacement(surface, i)) continue;

    const point = renderableSurfacePointFromDirection(direction, planet, seed, 0);
    scratchWorldPosition.set(point.x, point.y, point.z);
    const basisNormal = makeBasisNormal?.(surface, direction, i) ?? surface.normal ?? direction;
    scratchNormal.set(basisNormal.x, basisNormal.y, basisNormal.z).normalize();
    buildSurfaceFrame(scratchNormal);
    scratchLocalPosition.copy(scratchWorldPosition).sub(anchor.position);
    if (!canPlaceWithGap(placementGrid, scratchLocalPosition)) continue;
    registerPlacement(placementGrid, scratchLocalPosition);

    const yaw = hash01(seed, faceIndex, tileInfo.level, tileInfo.x, tileInfo.y, i, 47) * Math.PI * 2;
    const scaleValue = makeScale(surface, i);
    const variantIndex = makeVariantIndex?.(surface, i) ?? 0;
    if (getNormalOffset) {
      scratchLocalPosition.addScaledVector(
        scratchNormal,
        getNormalOffset(surface, i, variantIndex) * scaleValue,
      );
    }
    scratchScale.set(scaleValue, scaleValue, scaleValue);
    scratchMatrix.compose(
      scratchLocalPosition,
      buildBasisQuaternion(scratchNormal, yaw),
      scratchScale,
    );
    entries.push({ matrix: scratchMatrix.clone(), variantIndex });
  }

  return entries;
}

function groupEntriesByVariant(
  entries: InstanceEntry[],
  assets: InstancedAsset[],
): THREE.Matrix4[][] {
  const grouped: THREE.Matrix4[][] = Array.from({ length: assets.length }, () => []);
  entries.forEach(({ matrix, variantIndex }) => {
    if (!assets.length) return;
    const index = Math.max(0, Math.min(assets.length - 1, variantIndex));
    grouped[index].push(matrix);
  });
  return grouped;
}

function buildTileVegetation(
  tileInfo: TileInfo,
  planet: Planet,
  seed: number,
  grassAssets: InstancedAsset[],
  pinesData: InstancedAsset[],
  vegetationSettings: VegetationSettings,
): THREE.Group {
  const anchor = createAnchorFromTile(tileInfo, planet, seed);
  const group = new THREE.Group();
  group.position.copy(anchor.position);
  const grassSettings = vegetationSettings.grass;
  const treeSettings = vegetationSettings.tree;
  const grassSampleCount = scaledSampleCount(GRASS_SAMPLE_COUNT, grassSettings.density);
  const treeSampleCount = scaledSampleCount(TREE_SAMPLE_COUNT, treeSettings.density);

  if (grassAssets.length > 0 && grassSampleCount > 0) {
    const grassEntries = buildInstanceEntries(
      anchor,
      tileInfo,
      planet,
      seed,
      grassSampleCount,
      (surface, i) =>
        (surface.biome === 'plains' || surface.biome === 'forest') &&
        hash01(seed, tileInfo.level, tileInfo.x, tileInfo.y, i, 71) <
          Math.min(1, surface.grassDensity * 1.35),
      (surface, i) =>
        lerp(
          grassSettings.minScale,
          grassSettings.maxScale,
          clamp01(surface.grassDensity * 0.35 + hash01(seed, tileInfo.x, tileInfo.y, i, 83) * 0.8),
        ),
      (_surface, _i, variantIndex) => grassAssets[variantIndex]?.baseOffsetY ?? 0,
      null,
      (_surface, _i) =>
        Math.floor(hash01(seed, tileInfo.level, tileInfo.x, tileInfo.y, _i, 313) * grassAssets.length),
      grassSettings.gapMeters,
    );
    const groupedGrass = groupEntriesByVariant(grassEntries, grassAssets);
    groupedGrass.forEach((matrices, assetIndex) => {
      addInstancedAsset(group, grassAssets[assetIndex], matrices);
    });
  }

  if (pinesData && pinesData.length > 0 && treeSampleCount > 0) {
    const treeEntries = buildInstanceEntries(
      anchor,
      tileInfo,
      planet,
      seed,
      treeSampleCount,
      (surface, i) =>
        (surface.biome === 'plains' || surface.biome === 'forest') &&
        surface.treeDensity > 0 &&
        hash01(seed, tileInfo.level, tileInfo.x, tileInfo.y, i, 101) <
          Math.min(1, surface.treeDensity * 1.18),
      (surface, i) =>
        lerp(
          treeSettings.minScale,
          treeSettings.maxScale,
          clamp01(surface.treeDensity * 0.55 + hash01(seed, tileInfo.x, tileInfo.y, i, 131) * 0.75),
        ),
      (_surface, _i, variantIndex) => pinesData[variantIndex]?.baseOffsetY ?? 0,
      (_surface, direction) => direction,
      (_surface, _i) =>
        Math.floor(hash01(seed, tileInfo.level, tileInfo.x, tileInfo.y, _i, 199) * pinesData.length),
      treeSettings.gapMeters,
    );

    const pineInstances = groupEntriesByVariant(treeEntries, pinesData);
    pineInstances.forEach((matrices, pineIndex) => {
      addInstancedAsset(group, pinesData[pineIndex], matrices);
    });
  }

  return group;
}

function buildLandingGrove(
  planet: Planet,
  seed: number,
  grassAssets: InstancedAsset[],
  pinesData: InstancedAsset[],
  vegetationSettings: VegetationSettings,
): THREE.Group {
  const landingSite = resolveLandingSite(planet, seed);
  const anchorProbe = cartesianFromLatLonAlt(
    landingSite.latRadians,
    landingSite.lonRadians,
    0,
    planet.radiusMeters,
  );
  const anchorDirection = new THREE.Vector3(anchorProbe.x, anchorProbe.y, anchorProbe.z).normalize();
  const anchor = createAnchorFromDirection(anchorDirection, planet, seed);
  const group = new THREE.Group();
  group.position.copy(anchor.position);
  if (!(anchor.surface.biome === 'plains' || anchor.surface.biome === 'forest')) return group;
  const grassSettings = vegetationSettings.grass;
  const treeSettings = vegetationSettings.tree;
  const grassSampleCount = scaledSampleCount(LANDING_GRASS_COUNT, grassSettings.density);
  const treeSampleCount = scaledSampleCount(LANDING_TREE_COUNT, treeSettings.density);

  if (grassAssets.length > 0 && grassSampleCount > 0) {
    const heroGrassInstances: THREE.Matrix4[][] = Array.from({ length: grassAssets.length }, () => []);
    const grassPlacementGrid = createPlacementGrid(grassSettings.gapMeters);
    for (let i = 0; i < grassSampleCount; i += 1) {
      const angle = hash01(seed, 7001, i) * Math.PI * 2;
      const radiusMeters = 25 + hash01(seed, 7002, i) * 330;
      const offsetX = Math.cos(angle) * radiusMeters;
      const offsetZ = Math.sin(angle) * radiusMeters;
      const worldPoint = anchor.normal
        .clone()
        .multiplyScalar(planet.radiusMeters)
        .addScaledVector(anchor.tangent, offsetX)
        .addScaledVector(anchor.bitangent, offsetZ)
        .normalize()
        .multiplyScalar(planet.radiusMeters);
      const surface = sampleRenderablePlanetSurface(planet, seed, worldPoint);
      if (!(surface.biome === 'plains' || surface.biome === 'forest')) continue;
      if (hash01(seed, 7005, i) > Math.min(1, surface.grassDensity * 1.4)) continue;

      const placementDirection: Vec3 = { x: worldPoint.x, y: worldPoint.y, z: worldPoint.z };
      scratchNormal.set(
        surface.normal?.x ?? worldPoint.x,
        surface.normal?.y ?? worldPoint.y,
        surface.normal?.z ?? worldPoint.z,
      ).normalize();
      buildSurfaceFrame(scratchNormal);
      const grassPoint = renderableSurfacePointFromDirection(
        placementDirection,
        planet,
        seed,
        0,
      );
      scratchWorldPosition.set(grassPoint.x, grassPoint.y, grassPoint.z);
      scratchLocalPosition.copy(scratchWorldPosition).sub(anchor.position);
      if (!canPlaceWithGap(grassPlacementGrid, scratchLocalPosition)) continue;
      registerPlacement(grassPlacementGrid, scratchLocalPosition);
      const assetIndex = Math.floor(hash01(seed, 7006, i) * grassAssets.length);
      const scaleValue = lerp(
        grassSettings.minScale,
        grassSettings.maxScale,
        clamp01(surface.grassDensity * 0.35 + hash01(seed, 7003, i) * 0.8),
      );
      scratchLocalPosition.addScaledVector(
        scratchNormal,
        (grassAssets[assetIndex]?.baseOffsetY ?? 0) * scaleValue,
      );
      scratchScale.set(scaleValue, scaleValue, scaleValue);
      scratchMatrix.compose(
        scratchLocalPosition,
        buildBasisQuaternion(scratchNormal, hash01(seed, 7004, i) * Math.PI * 2),
        scratchScale,
      );
      heroGrassInstances[assetIndex].push(scratchMatrix.clone());
    }

    heroGrassInstances.forEach((matrices, assetIndex) => {
      addInstancedAsset(group, grassAssets[assetIndex], matrices);
    });
  }

  if (pinesData && pinesData.length > 0 && treeSampleCount > 0) {
    const heroTreeInstances: THREE.Matrix4[][] = Array.from({ length: pinesData.length }, () => []);
    const treePlacementGrid = createPlacementGrid(treeSettings.gapMeters);
    for (let i = 0; i < treeSampleCount; i += 1) {
      const angle = hash01(seed, 7101, i) * Math.PI * 2;
      const radiusMeters = 24 + hash01(seed, 7102, i) * 235;
      const offsetX = Math.cos(angle) * radiusMeters;
      const offsetZ = Math.sin(angle) * radiusMeters;
      const worldPoint = anchor.normal
        .clone()
        .multiplyScalar(planet.radiusMeters)
        .addScaledVector(anchor.tangent, offsetX)
        .addScaledVector(anchor.bitangent, offsetZ)
        .normalize()
        .multiplyScalar(planet.radiusMeters);
      const surface = sampleRenderablePlanetSurface(planet, seed, worldPoint);
      if (!(surface.biome === 'plains' || surface.biome === 'forest')) continue;
      if (surface.treeDensity <= 0) continue;
      if (hash01(seed, 7105, i) > Math.min(1, surface.treeDensity * 1.1)) continue;

      const placementDirection: Vec3 = { x: worldPoint.x, y: worldPoint.y, z: worldPoint.z };
      scratchNormal.copy(worldPoint).normalize();
      buildSurfaceFrame(scratchNormal);
      const treePoint = renderableSurfacePointFromDirection(
        placementDirection,
        planet,
        seed,
        0,
      );
      scratchWorldPosition.set(treePoint.x, treePoint.y, treePoint.z);
      scratchLocalPosition.copy(scratchWorldPosition).sub(anchor.position);
      if (!canPlaceWithGap(treePlacementGrid, scratchLocalPosition)) continue;
      registerPlacement(treePlacementGrid, scratchLocalPosition);
      const scaleValue = lerp(
        treeSettings.minScale,
        treeSettings.maxScale,
        clamp01(surface.treeDensity * 0.55 + hash01(seed, 7103, i) * 0.75),
      );
      const pineIndex = Math.floor(hash01(seed, 7201, i) * pinesData.length);
      const baseOffsetY = pinesData[pineIndex]?.baseOffsetY ?? 0;
      scratchLocalPosition.addScaledVector(scratchNormal, baseOffsetY * scaleValue);
      scratchScale.set(scaleValue, scaleValue, scaleValue);
      scratchMatrix.compose(
        scratchLocalPosition,
        buildBasisQuaternion(scratchNormal, hash01(seed, 7104, i) * Math.PI * 2),
        scratchScale,
      );
      heroTreeInstances[pineIndex].push(scratchMatrix.clone());
    }

    heroTreeInstances.forEach((matrices, pineIndex) => {
      addInstancedAsset(group, pinesData[pineIndex], matrices);
    });
  }

  return group;
}

export function createPlanetVegetationManager(
  scene: THREE.Scene,
  planet: Planet,
  seed: number,
  renderScale: number,
  initialSettings: Partial<VegetationSettings> = DEFAULT_VEGETATION_SETTINGS,
): PlanetVegetationManager {
  const vegetationGroup = new THREE.Group();
  vegetationGroup.scale.setScalar(renderScale);
  scene.add(vegetationGroup);

  const grassAssets: InstancedAsset[] = [];
  const pinesData: InstancedAsset[] = [];
  let vegetationSettings = normalizeVegetationSettings(initialSettings);
  let landingGrove = new THREE.Group();
  const tileCache = new Map<string, VegetationTileEntry>();
  const activeKeys = new Set<string>();
  const cacheStats: VegetationCacheStatsAccumulator = {
    peakCachedTiles: 0,
    totalBuilds: 0,
    totalEvictions: 0,
  };

  const loader = new GLTFLoader();
  const grassPaths = [
    '../assets/stylized-nature-magakit/Grass_Common_Short.gltf',
    '../assets/stylized-nature-magakit/Grass_Common_Tall.gltf',
    '../assets/stylized-nature-magakit/Grass_Wispy_Short.gltf',
    '../assets/stylized-nature-magakit/Grass_Wispy_Tall.gltf',
  ];
  const pinePaths = [
    '../assets/stylized-nature-magakit/Pine_1.gltf',
    '../assets/stylized-nature-magakit/Pine_2.gltf',
    '../assets/stylized-nature-magakit/Pine_3.gltf',
    '../assets/stylized-nature-magakit/Pine_4.gltf',
    '../assets/stylized-nature-magakit/Pine_5.gltf',
  ];
  const totalAssetLoads = grassPaths.length + pinePaths.length;
  let loadedAssetCount = 0;
  let builtThisFrame = 0;
  let evictedThisFrame = 0;
  let frameNumber = 0;

  function updateCachePeak(): void {
    cacheStats.peakCachedTiles = Math.max(cacheStats.peakCachedTiles, tileCache.size);
  }

  function releaseTileEntry(
    key: string,
    entry: VegetationTileEntry,
    countEviction = true,
  ): void {
    releaseVegetationGroup(vegetationGroup, entry.group);
    tileCache.delete(key);
    if (!countEviction) return;
    cacheStats.totalEvictions += 1;
    evictedThisFrame += 1;
  }

  function markAssetLoaded(): void {
    loadedAssetCount += 1;
    if (loadedAssetCount === totalAssetLoads) rebuildEverything();
  }

  function loadInstancedAsset(path: string, target: InstancedAsset[], label: string): void {
    const url = new URL(path, import.meta.url).href;
    loader.load(
      url,
      (gltf) => {
        const asset = extractInstancedAsset(gltf);
        if (asset.parts.length > 0) target.push(asset);
        markAssetLoaded();
      },
      undefined,
      (err) => {
        console.error(`Failed to load ${label} asset:`, path, err);
        markAssetLoaded();
      },
    );
  }

  grassPaths.forEach((path) => {
    loadInstancedAsset(path, grassAssets, 'grass');
  });

  pinePaths.forEach((path) => {
    loadInstancedAsset(path, pinesData, 'pine');
  });

  function rebuildEverything(): void {
    releaseVegetationGroup(vegetationGroup, landingGrove);
    landingGrove = buildLandingGrove(
      planet,
      seed,
      grassAssets,
      pinesData,
      vegetationSettings,
    );
    vegetationGroup.add(landingGrove);

    for (const [key, entry] of tileCache) {
      releaseTileEntry(key, entry, false);
    }
    activeKeys.clear();
  }

  // Create an empty grove while the real model assets load.
  landingGrove = buildLandingGrove(
    planet,
    seed,
    grassAssets,
    pinesData,
    vegetationSettings,
  );
  vegetationGroup.add(landingGrove);

  function shouldDecorateTile(tileInfo: TileInfo, bodyPosition: Vec3, altitudeMeters: number): boolean {
    if (altitudeMeters > 18_000) return false;
    if (tileInfo.level < 4) return false;
    if (dot(tileInfo.centerDirection, normalize(bodyPosition)) < 0.32) return false;
    return distance(tileInfo.centerPosition, bodyPosition) < 72_000;
  }

  function ensureVegetation(tileInfo: TileInfo): { group: THREE.Group; key: string } {
    const key = tileKey(tileInfo.face, tileInfo.level, tileInfo.x, tileInfo.y);
    let entry = tileCache.get(key);
    if (entry) {
      entry.lastUsedFrame = frameNumber;
      return { group: entry.group, key };
    }

    const group = buildTileVegetation(
      tileInfo,
      planet,
      seed,
      grassAssets,
      pinesData,
      vegetationSettings,
    );
    group.visible = false;
    vegetationGroup.add(group);
    entry = {
      group,
      lastUsedFrame: frameNumber,
    };
    tileCache.set(key, entry);
    cacheStats.totalBuilds += 1;
    builtThisFrame += 1;
    updateCachePeak();
    return { group, key };
  }

  function evictVegetation(selectedKeys: Set<string>): void {
    for (const [key, entry] of tileCache) {
      if (selectedKeys.has(key)) continue;
      if (frameNumber - entry.lastUsedFrame > VEGETATION_CACHE_STALE_FRAMES) {
        releaseTileEntry(key, entry);
      }
    }

    if (tileCache.size <= MAX_CACHED_VEGETATION_TILES) return;

    const inactiveEntries: [string, VegetationTileEntry][] = [];
    for (const [key, entry] of tileCache) {
      if (selectedKeys.has(key)) continue;
      inactiveEntries.push([key, entry]);
    }
    inactiveEntries.sort((a, b) => a[1].lastUsedFrame - b[1].lastUsedFrame);

    for (const [key, entry] of inactiveEntries) {
      if (tileCache.size <= MAX_CACHED_VEGETATION_TILES) break;
      releaseTileEntry(key, entry);
    }
  }

  function update(
    bodyPosition: Vec3,
    selectedTiles: TileInfo[],
    altitudeMeters: number,
  ): VegetationCacheStats {
    frameNumber += 1;
    builtThisFrame = 0;
    evictedThisFrame = 0;
    const selectedKeys = new Set<string>();

    if (altitudeMeters <= 18_000) {
      for (const tileInfo of selectedTiles) {
        if (!shouldDecorateTile(tileInfo, bodyPosition, altitudeMeters)) continue;
        const { group, key } = ensureVegetation(tileInfo);
        group.visible = true;
        selectedKeys.add(key);
      }
    }

    for (const key of activeKeys) {
      if (selectedKeys.has(key)) continue;
      const entry = tileCache.get(key);
      if (entry) entry.group.visible = false;
    }

    activeKeys.clear();
    for (const key of selectedKeys) activeKeys.add(key);
    evictVegetation(selectedKeys);

    vegetationGroup.position.set(
      -bodyPosition.x * renderScale,
      -bodyPosition.y * renderScale,
      -bodyPosition.z * renderScale,
    );

    return {
      activeTiles: selectedKeys.size,
      builtThisFrame,
      cacheLimit: MAX_CACHED_VEGETATION_TILES,
      cachedTiles: tileCache.size,
      evictedThisFrame,
      peakCachedTiles: cacheStats.peakCachedTiles,
      totalBuilds: cacheStats.totalBuilds,
      totalEvictions: cacheStats.totalEvictions,
    };
  }

  function dispose(): void {
    releaseVegetationGroup(vegetationGroup, landingGrove);
    for (const [key, entry] of tileCache) {
      releaseTileEntry(key, entry, false);
    }
    disposeInstancedAssets(grassAssets);
    disposeInstancedAssets(pinesData);
    scene.remove(vegetationGroup);
  }

  function setSettings(nextSettings: Partial<VegetationSettings>): void {
    vegetationSettings = normalizeVegetationSettings(nextSettings);
    rebuildEverything();
  }

  return {
    dispose,
    setSettings,
    update,
  };
}
