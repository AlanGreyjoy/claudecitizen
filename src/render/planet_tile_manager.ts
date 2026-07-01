import * as THREE from 'three';
import type {
  CubeFace,
  Planet,
  PlanetSurfaceSample,
  TerrainTileBuffers,
  TileCacheStats,
  TileInfo,
  TileWorkerInMessage,
  TileWorkerOutMessage,
  Vec3,
} from '../types';
import { distance, dot, scale } from '../math/vec3';
import { CUBE_FACES, directionFromCubeFace, faceUvFromDirection } from '../world/cube_sphere';
import { radialUp } from '../world/coordinates';
import {
  RENDER_SURFACE_LEVEL,
  RENDER_SURFACE_SEGMENTS,
  sampleRenderablePlanetSurface,
} from '../world/planet_surface';
import { buildTerrainTileBuffers } from './planet_tile_buffers';

const TILE_SEGMENTS = RENDER_SURFACE_SEGMENTS;
const TILE_BUILD_BUDGET_PER_FRAME = 12;
const MAX_CACHED_TILES = 384;
const TILE_CACHE_STALE_FRAMES = 90;
const MIN_LEVEL = 2;
const MAX_LEVEL = RENDER_SURFACE_LEVEL;
const PLANET_RENDER_SCALE = 1 / 500;
const HORIZON_MARGIN_RADIANS = 0.03;
const MIN_PROJECTED_ERROR = 0.9;
const TILE_GRID_INDICES = buildGridIndices(TILE_SEGMENTS);

type TileEntryStatus = 'pending' | 'ready';

interface TileMeshEntry {
  buildId: number | null;
  info: TileInfo;
  lastUsedFrame: number;
  mesh: THREE.Mesh | null;
  status: TileEntryStatus;
}

interface PendingBuildJob {
  buildId: number;
  info: TileInfo;
  key: string;
}

interface ResolvedTile {
  info: TileInfo;
  key: string;
  mesh: THREE.Mesh;
}

interface ExtendedTileCacheStats extends TileCacheStats {
  workerBuildsEnabled: boolean;
  workerErrors: number;
}

export interface TileManagerUpdateResult {
  selectedTiles: TileInfo[];
  stats: ExtendedTileCacheStats;
  surface: PlanetSurfaceSample;
}

export interface PlanetTileManager {
  dispose: () => void;
  renderScale: number;
  update: (bodyPosition: Vec3, surface?: PlanetSurfaceSample) => TileManagerUpdateResult;
}

interface TileCacheStatsAccumulator {
  peakCachedTiles: number;
  totalBuilds: number;
  totalEvictions: number;
  workerErrors: number;
}

function clamp01(value: number): number {
  return Math.max(0, Math.min(1, value));
}

function clamp(value: number, min: number, max: number): number {
  return Math.max(min, Math.min(max, value));
}

function tileKey(face: CubeFace, level: number, x: number, y: number): string {
  return `${face}:${level}:${x}:${y}`;
}

function tileBounds(level: number, x: number, y: number) {
  const tileCount = 2 ** level;
  const step = 2 / tileCount;
  const u0 = -1 + x * step;
  const v0 = -1 + y * step;
  return {
    u0,
    u1: u0 + step,
    v0,
    v1: v0 + step,
  };
}

function buildGridIndices(segments: number): Uint32Array {
  const indices = new Uint32Array(segments * segments * 6);
  let ptr = 0;
  for (let y = 0; y < segments; y += 1) {
    for (let x = 0; x < segments; x += 1) {
      const topLeft = y * (segments + 1) + x;
      const topRight = topLeft + 1;
      const bottomLeft = topLeft + segments + 1;
      const bottomRight = bottomLeft + 1;
      indices[ptr] = topLeft;
      indices[ptr + 1] = bottomLeft;
      indices[ptr + 2] = topRight;
      indices[ptr + 3] = topRight;
      indices[ptr + 4] = bottomLeft;
      indices[ptr + 5] = bottomRight;
      ptr += 6;
    }
  }
  return indices;
}

function createTileGeometry(buffers: TerrainTileBuffers): THREE.BufferGeometry {
  const geometry = new THREE.BufferGeometry();
  geometry.setAttribute('position', new THREE.BufferAttribute(buffers.positions, 3));
  geometry.setAttribute('color', new THREE.BufferAttribute(buffers.colors, 3));
  geometry.setAttribute('normal', new THREE.BufferAttribute(buffers.normals, 3));
  geometry.setIndex(new THREE.BufferAttribute(TILE_GRID_INDICES, 1));
  return geometry;
}

function makeTileInfo(face: CubeFace, level: number, x: number, y: number, planet: Planet): TileInfo {
  const bounds = tileBounds(level, x, y);
  const centerDirection = directionFromCubeFace(
    face,
    (bounds.u0 + bounds.u1) * 0.5,
    (bounds.v0 + bounds.v1) * 0.5,
  );
  const cornerA = scale(directionFromCubeFace(face, bounds.u0, bounds.v0), planet.radiusMeters);
  const cornerB = scale(directionFromCubeFace(face, bounds.u1, bounds.v1), planet.radiusMeters);
  const centerPosition = scale(centerDirection, planet.radiusMeters);
  return {
    bounds,
    centerDirection,
    centerPosition,
    face,
    level,
    spanMeters: distance(cornerA, cornerB),
    x,
    y,
  };
}

function createTileBuildWorker(): Worker | null {
  if (typeof window === 'undefined' || typeof Worker === 'undefined') return null;

  try {
    return new Worker(new URL('./planet_tile_worker', import.meta.url), {
      type: 'module',
    });
  } catch (error) {
    console.warn('ClaudeCitizen terrain worker unavailable, falling back to sync tile builds.', error);
    return null;
  }
}

export function createPlanetTileManager(
  scene: THREE.Scene,
  planet: Planet,
  seed: number,
): PlanetTileManager {
  const tileGroup = new THREE.Group();
  tileGroup.scale.setScalar(PLANET_RENDER_SCALE);
  scene.add(tileGroup);

  const material = new THREE.MeshStandardMaterial({
    flatShading: false,
    metalness: 0,
    roughness: 1,
    side: THREE.DoubleSide,
    vertexColors: true,
  });

  const meshCache = new Map<string, TileMeshEntry>();
  const activeKeys = new Set<string>();
  const cacheStats: TileCacheStatsAccumulator = {
    peakCachedTiles: 0,
    totalBuilds: 0,
    totalEvictions: 0,
    workerErrors: 0,
  };
  const pendingBuildQueue: PendingBuildJob[] = [];
  let tileBuildWorker = createTileBuildWorker();
  let workerBusy = false;
  let buildBudgetRemaining = TILE_BUILD_BUDGET_PER_FRAME;
  let builtThisFrame = 0;
  let completedSinceLastUpdate = 0;
  let evictedThisFrame = 0;
  let frameNumber = 0;
  let nextBuildId = 1;
  let queuedThisFrame = 0;

  function countEntries(status: TileEntryStatus): number {
    let count = 0;
    for (const entry of meshCache.values()) {
      if (entry.status === status) count += 1;
    }
    return count;
  }

  function updateCachePeak(): void {
    cacheStats.peakCachedTiles = Math.max(cacheStats.peakCachedTiles, meshCache.size);
  }

  function createReadyMesh(info: TileInfo, buffers: TerrainTileBuffers): THREE.Mesh {
    const mesh = new THREE.Mesh(createTileGeometry(buffers), material);
    mesh.position.set(info.centerPosition.x, info.centerPosition.y, info.centerPosition.z);
    mesh.frustumCulled = false;
    mesh.visible = false;
    mesh.receiveShadow = true;
    tileGroup.add(mesh);
    return mesh;
  }

  function discardPendingQueueForKey(key: string, buildId: number | null = null): void {
    for (let i = pendingBuildQueue.length - 1; i >= 0; i -= 1) {
      const job = pendingBuildQueue[i];
      if (job.key !== key) continue;
      if (buildId != null && job.buildId !== buildId) continue;
      pendingBuildQueue.splice(i, 1);
    }
  }

  function releaseTileEntry(key: string, entry: TileMeshEntry, countEviction = true): void {
    if (entry.mesh) {
      tileGroup.remove(entry.mesh);
      entry.mesh.geometry.dispose();
    } else {
      discardPendingQueueForKey(key, entry.buildId ?? null);
    }

    meshCache.delete(key);
    if (!countEviction) return;
    cacheStats.totalEvictions += 1;
    evictedThisFrame += 1;
  }

  function markAsyncBuildFailed(key: string, buildId: number, error: string | undefined): void {
    cacheStats.workerErrors += 1;
    if (error) console.error(`ClaudeCitizen terrain worker failed for ${key}:`, error);
    const entry = meshCache.get(key);
    if (!entry || entry.buildId !== buildId || entry.status !== 'pending') return;
    meshCache.delete(key);
  }

  function pumpWorkerQueue(): void {
    if (!tileBuildWorker || workerBusy) return;

    while (pendingBuildQueue.length > 0) {
      const job = pendingBuildQueue.shift()!;
      const entry = meshCache.get(job.key);
      if (!entry || entry.buildId !== job.buildId || entry.status !== 'pending') continue;

      workerBusy = true;
      const message: TileWorkerInMessage = {
        buildId: job.buildId,
        info: job.info,
        key: job.key,
        planet,
        seed,
      };
      tileBuildWorker.postMessage(message);
      return;
    }
  }

  if (tileBuildWorker) {
    tileBuildWorker.onmessage = (event: MessageEvent<TileWorkerOutMessage>) => {
      workerBusy = false;
      const { buildId, key } = event.data;

      if ('error' in event.data) {
        markAsyncBuildFailed(key, buildId, event.data.error);
        pumpWorkerQueue();
        return;
      }

      const { colors, normals, positions } = event.data;
      const entry = meshCache.get(key);
      if (entry && entry.buildId === buildId && entry.status === 'pending') {
        entry.mesh = createReadyMesh(entry.info, { colors, normals, positions });
        entry.status = 'ready';
        cacheStats.totalBuilds += 1;
        completedSinceLastUpdate += 1;
      }

      pumpWorkerQueue();
    };

    tileBuildWorker.onerror = (event: ErrorEvent) => {
      workerBusy = false;
      cacheStats.workerErrors += 1;
      console.error('ClaudeCitizen terrain worker crashed, reverting future builds to sync.', event);
      tileBuildWorker!.terminate();
      tileBuildWorker = null;
      pendingBuildQueue.length = 0;
      for (const [key, entry] of meshCache) {
        if (entry.status === 'pending') meshCache.delete(key);
      }
    };
  }

  function buildTileMeshSync(info: TileInfo): TileMeshEntry {
    const key = tileKey(info.face, info.level, info.x, info.y);
    let entry = meshCache.get(key);
    if (entry?.mesh) {
      entry.lastUsedFrame = frameNumber;
      return entry;
    }

    const mesh = createReadyMesh(info, buildTerrainTileBuffers(info, planet, seed));
    entry = {
      buildId: null,
      info,
      lastUsedFrame: frameNumber,
      mesh,
      status: 'ready',
    };
    meshCache.set(key, entry);
    cacheStats.totalBuilds += 1;
    builtThisFrame += 1;
    updateCachePeak();
    return entry;
  }

  function queueTileBuild(info: TileInfo): TileMeshEntry {
    const key = tileKey(info.face, info.level, info.x, info.y);
    let entry = meshCache.get(key);
    if (entry) {
      entry.lastUsedFrame = frameNumber;
      return entry;
    }

    entry = {
      buildId: nextBuildId,
      info,
      lastUsedFrame: frameNumber,
      mesh: null,
      status: 'pending',
    };
    nextBuildId += 1;
    meshCache.set(key, entry);
    pendingBuildQueue.push({
      buildId: entry.buildId!,
      info,
      key,
    });
    queuedThisFrame += 1;
    updateCachePeak();
    pumpWorkerQueue();
    return entry;
  }

  function parentTileInfo(info: TileInfo): TileInfo | null {
    if (info.level <= MIN_LEVEL) return null;
    return makeTileInfo(
      info.face,
      info.level - 1,
      Math.floor(info.x / 2),
      Math.floor(info.y / 2),
      planet,
    );
  }

  function requestBestAvailableTile(info: TileInfo): ResolvedTile {
    const searchChain: TileInfo[] = [];
    let current: TileInfo | null = info;
    while (current) {
      searchChain.push(current);
      current = parentTileInfo(current);
    }

    const target = searchChain[0];
    const targetKey = tileKey(target.face, target.level, target.x, target.y);
    const targetEntry = meshCache.get(targetKey);

    if (!targetEntry && buildBudgetRemaining > 0) {
      buildBudgetRemaining -= 1;
      if (tileBuildWorker && target.level > MIN_LEVEL) {
        queueTileBuild(target);
      } else {
        return {
          info: target,
          key: targetKey,
          mesh: buildTileMeshSync(target).mesh!,
        };
      }
    } else if (targetEntry) {
      targetEntry.lastUsedFrame = frameNumber;
      if (targetEntry.mesh) {
        return {
          info: target,
          key: targetKey,
          mesh: targetEntry.mesh,
        };
      }
    }

    for (const candidate of searchChain.slice(1)) {
      const key = tileKey(candidate.face, candidate.level, candidate.x, candidate.y);
      const entry = meshCache.get(key);
      if (!entry) continue;
      entry.lastUsedFrame = frameNumber;
      if (!entry.mesh) continue;
      return {
        info: candidate,
        key,
        mesh: entry.mesh,
      };
    }

    const fallbackInfo = searchChain.find((candidate) => candidate.level <= MIN_LEVEL)
      ?? searchChain[searchChain.length - 1];
    const fallbackKey = tileKey(
      fallbackInfo.face,
      fallbackInfo.level,
      fallbackInfo.x,
      fallbackInfo.y,
    );
    const fallbackEntry = meshCache.get(fallbackKey);
    if (fallbackEntry?.mesh) {
      fallbackEntry.lastUsedFrame = frameNumber;
      return {
        info: fallbackInfo,
        key: fallbackKey,
        mesh: fallbackEntry.mesh,
      };
    }

    return {
      info: fallbackInfo,
      key: fallbackKey,
      mesh: buildTileMeshSync(fallbackInfo).mesh!,
    };
  }

  function evictTileMeshes(selectedKeys: Set<string>): void {
    for (const [key, entry] of meshCache) {
      if (selectedKeys.has(key)) continue;
      if (frameNumber - entry.lastUsedFrame > TILE_CACHE_STALE_FRAMES) {
        releaseTileEntry(key, entry);
      }
    }

    if (meshCache.size <= MAX_CACHED_TILES) return;

    const inactiveEntries: [string, TileMeshEntry][] = [];
    for (const [key, entry] of meshCache) {
      if (selectedKeys.has(key)) continue;
      inactiveEntries.push([key, entry]);
    }
    inactiveEntries.sort((a, b) => a[1].lastUsedFrame - b[1].lastUsedFrame);

    for (const [key, entry] of inactiveEntries) {
      if (meshCache.size <= MAX_CACHED_TILES) break;
      releaseTileEntry(key, entry);
    }
  }

  function targetErrorForAltitude(altitudeMeters: number): number {
    const groundFloor = altitudeMeters < 500 ? 0.18 : 0.24;
    const baseline = groundFloor + clamp01(altitudeMeters / 120_000) * 1.8;
    return Math.max(MIN_PROJECTED_ERROR, baseline);
  }

  function shouldCullTile(info: TileInfo, cameraUp: Vec3, altitudeMeters: number): boolean {
    const facing = dot(info.centerDirection, cameraUp);
    const phiH = Math.acos(
      planet.radiusMeters / Math.max(planet.radiusMeters + altitudeMeters, planet.radiusMeters + 1),
    );
    const phiCenter = Math.acos(clamp(facing, -1, 1));
    const phiHalf = info.spanMeters / (2 * planet.radiusMeters);
    const nearestAngle = Math.max(0, phiCenter - phiHalf);
    return nearestAngle > phiH + HORIZON_MARGIN_RADIANS && info.level > 0;
  }

  function shouldSplitTile(
    info: TileInfo,
    bodyPosition: Vec3,
    cameraUp: Vec3,
    altitudeMeters: number,
  ): boolean {
    if (info.level < MIN_LEVEL) return true;
    if (info.level >= MAX_LEVEL) return false;

    const facing = dot(info.centerDirection, cameraUp);
    if (facing < -0.18) return false;

    const cameraDistance = distance(info.centerPosition, bodyPosition);
    const projectedError = info.spanMeters / Math.max(cameraDistance, 1);
    return projectedError > targetErrorForAltitude(altitudeMeters);
  }

  function visitSelectedTiles(
    bodyPosition: Vec3,
    altitudeMeters: number,
    visitTile: (info: TileInfo) => void,
  ): void {
    const cameraUp = radialUp(bodyPosition);
    const cameraFace = faceUvFromDirection(cameraUp);
    const faceOrder: CubeFace[] = [
      cameraFace.face,
      ...CUBE_FACES.filter((face) => face !== cameraFace.face),
    ];

    function cameraChildIndex(level: number) {
      const tileCount = 2 ** level;
      return {
        x: clamp(Math.floor(((cameraFace.u + 1) * 0.5) * tileCount), 0, tileCount - 1),
        y: clamp(Math.floor(((cameraFace.v + 1) * 0.5) * tileCount), 0, tileCount - 1),
      };
    }

    function orderedChildren(face: CubeFace, level: number, x: number, y: number) {
      const childLevel = level + 1;
      const children = [
        { x: x * 2, y: y * 2 },
        { x: x * 2 + 1, y: y * 2 },
        { x: x * 2, y: y * 2 + 1 },
        { x: x * 2 + 1, y: y * 2 + 1 },
      ];

      if (face !== cameraFace.face) return children;

      const cameraChild = cameraChildIndex(childLevel);
      children.sort((a, b) => {
        const aDistance = Math.abs(a.x - cameraChild.x) + Math.abs(a.y - cameraChild.y);
        const bDistance = Math.abs(b.x - cameraChild.x) + Math.abs(b.y - cameraChild.y);
        return aDistance - bDistance;
      });
      return children;
    }

    function traverse(face: CubeFace, level: number, x: number, y: number): void {
      const info = makeTileInfo(face, level, x, y, planet);
      if (level <= 1 && face !== cameraFace.face && level < MIN_LEVEL) {
        for (const child of orderedChildren(face, level, x, y)) {
          traverse(face, level + 1, child.x, child.y);
        }
        return;
      }
      if (shouldCullTile(info, cameraUp, altitudeMeters)) return;
      if (shouldSplitTile(info, bodyPosition, cameraUp, altitudeMeters)) {
        for (const child of orderedChildren(face, level, x, y)) {
          traverse(face, level + 1, child.x, child.y);
        }
        return;
      }
      visitTile(info);
    }

    for (const face of faceOrder) {
      traverse(face, 0, 0, 0);
    }
  }

  function update(
    bodyPosition: Vec3,
    surface: PlanetSurfaceSample = sampleRenderablePlanetSurface(planet, seed, bodyPosition),
  ): TileManagerUpdateResult {
    frameNumber += 1;
    buildBudgetRemaining = TILE_BUILD_BUDGET_PER_FRAME;
    builtThisFrame = completedSinceLastUpdate;
    completedSinceLastUpdate = 0;
    evictedThisFrame = 0;
    queuedThisFrame = 0;
    const selectedKeys = new Set<string>();
    const selectedTiles: TileInfo[] = [];

    visitSelectedTiles(bodyPosition, surface.altitudeMeters, (info) => {
      const resolved = requestBestAvailableTile(info);
      resolved.mesh.visible = true;
      if (!selectedKeys.has(resolved.key)) {
        selectedTiles.push(resolved.info);
      }
      selectedKeys.add(resolved.key);
    });

    for (const key of activeKeys) {
      if (selectedKeys.has(key)) continue;
      const entry = meshCache.get(key);
      if (entry?.mesh) entry.mesh.visible = false;
    }

    activeKeys.clear();
    for (const key of selectedKeys) activeKeys.add(key);
    evictTileMeshes(selectedKeys);

    tileGroup.position.set(
      -bodyPosition.x * PLANET_RENDER_SCALE,
      -bodyPosition.y * PLANET_RENDER_SCALE,
      -bodyPosition.z * PLANET_RENDER_SCALE,
    );

    return {
      selectedTiles,
      stats: {
        activeTiles: selectedTiles.length,
        builtThisFrame,
        cacheLimit: MAX_CACHED_TILES,
        cachedTiles: countEntries('ready'),
        evictedThisFrame,
        peakCachedTiles: cacheStats.peakCachedTiles,
        pendingTiles: countEntries('pending'),
        queuedThisFrame,
        totalBuilds: cacheStats.totalBuilds,
        totalEvictions: cacheStats.totalEvictions,
        workerBuildsEnabled: Boolean(tileBuildWorker),
        workerErrors: cacheStats.workerErrors,
      },
      surface,
    };
  }

  function dispose(): void {
    if (tileBuildWorker) {
      tileBuildWorker.terminate();
      tileBuildWorker = null;
    }

    pendingBuildQueue.length = 0;
    for (const [key, entry] of meshCache) {
      releaseTileEntry(key, entry, false);
    }
    material.dispose();
    scene.remove(tileGroup);
  }

  return {
    dispose,
    renderScale: PLANET_RENDER_SCALE,
    update,
  };
}
