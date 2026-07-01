import * as THREE from 'three';
import type { LakeWaterBuffers, Planet, TileInfo, Vec3 } from '../types';
import { createLakeWaterMaterial, createWaterNormalTexture } from './lake_water_material';
import {
  buildLakeWaterGeometry,
  expandLakeWaterTiles,
  tileHasLakeWater,
} from './planet_lake_water_buffers';

const WATER_BUILD_BUDGET_PER_FRAME = 3;

type WaterEntryStatus = 'empty' | 'pending' | 'queued' | 'ready';

interface WaterCacheEntry {
  info: TileInfo;
  key: string;
  sourceKey: string | null;
  status: WaterEntryStatus;
  water: THREE.Mesh | null;
}

export interface PlanetLakeWaterManager {
  dispose: () => void;
  update: (
    bodyPosition: Vec3,
    selectedTiles: TileInfo[],
    sunDirection: THREE.Vector3 | null | undefined,
    dtSeconds: number,
    skyColor: THREE.Color | null | undefined,
  ) => void;
}

function tileKey(face: TileInfo['face'], level: number, x: number, y: number): string {
  return `${face}:${level}:${x}:${y}`;
}

function toThreeVector3(vector: Vec3): THREE.Vector3 {
  return new THREE.Vector3(vector.x, vector.y, vector.z);
}

export function createPlanetLakeWaterManager(
  scene: THREE.Scene,
  planet: Planet,
  seed: number,
  renderScale: number,
): PlanetLakeWaterManager {
  const waterGroup = new THREE.Group();
  waterGroup.scale.setScalar(renderScale);
  scene.add(waterGroup);

  const waterNormals = createWaterNormalTexture();
  const sharedMaterial = createLakeWaterMaterial(waterNormals);

  const cache = new Map<string, WaterCacheEntry>();
  const activeKeys = new Set<string>();
  const pendingBuilds: WaterCacheEntry[] = [];
  let elapsedSeconds = 0;
  let buildBudgetRemaining = WATER_BUILD_BUDGET_PER_FRAME;

  function createWaterMesh(info: TileInfo, buffers: LakeWaterBuffers): THREE.Mesh {
    const geometry = new THREE.BufferGeometry();
    geometry.setAttribute('position', new THREE.BufferAttribute(buffers.positions, 3));
    geometry.setAttribute('uv', new THREE.BufferAttribute(buffers.uvs, 2));
    geometry.setIndex(new THREE.BufferAttribute(buffers.indices, 1));
    geometry.computeVertexNormals();

    const mesh = new THREE.Mesh(geometry, sharedMaterial);
    mesh.frustumCulled = false;
    mesh.renderOrder = 2;
    mesh.position.copy(toThreeVector3(info.centerPosition));
    waterGroup.add(mesh);
    return mesh;
  }

  function disposeWaterMesh(mesh: THREE.Mesh): void {
    waterGroup.remove(mesh);
    mesh.geometry.dispose();
  }

  function releaseEntry(key: string, entry: WaterCacheEntry): void {
    if (entry.water) disposeWaterMesh(entry.water);
    cache.delete(key);
  }

  function discardPendingBuild(key: string): void {
    for (let i = pendingBuilds.length - 1; i >= 0; i -= 1) {
      if (pendingBuilds[i].key === key) pendingBuilds.splice(i, 1);
    }
  }

  function buildEntry(entry: WaterCacheEntry): void {
    const { info, key } = entry;

    if (!tileHasLakeWater(info, planet, seed)) {
      if (entry.water) {
        disposeWaterMesh(entry.water);
        entry.water = null;
      }
      entry.status = 'empty';
      entry.sourceKey = key;
      return;
    }

    const buffers = buildLakeWaterGeometry(info, planet, seed);
    if (!buffers) {
      if (entry.water) {
        disposeWaterMesh(entry.water);
        entry.water = null;
      }
      entry.status = 'empty';
      entry.sourceKey = key;
      return;
    }

    if (entry.water) disposeWaterMesh(entry.water);
    entry.water = createWaterMesh(info, buffers);
    entry.status = 'ready';
    entry.sourceKey = key;
  }

  function queueBuild(entry: WaterCacheEntry): void {
    if (entry.status === 'pending') return;
    entry.status = 'pending';
    discardPendingBuild(entry.key);
    pendingBuilds.push(entry);
  }

  function pumpBuildQueue(): void {
    while (buildBudgetRemaining > 0 && pendingBuilds.length > 0) {
      const entry = pendingBuilds.shift()!;
      if (!cache.has(entry.key) || entry.status !== 'pending') continue;
      buildEntry(entry);
      buildBudgetRemaining -= 1;
    }
  }

  function requestTile(info: TileInfo): WaterCacheEntry {
    const key = tileKey(info.face, info.level, info.x, info.y);
    let entry = cache.get(key);

    if (!entry) {
      entry = {
        info,
        key,
        sourceKey: null,
        status: 'queued',
        water: null,
      };
      cache.set(key, entry);
      queueBuild(entry);
      return entry;
    }

    entry.info = info;
    if (entry.status === 'ready' && entry.sourceKey === key) return entry;
    if (entry.status === 'pending') return entry;

    queueBuild(entry);
    return entry;
  }

  function update(
    bodyPosition: Vec3,
    selectedTiles: TileInfo[],
    sunDirection: THREE.Vector3 | null | undefined,
    dtSeconds: number,
    skyColor: THREE.Color | null | undefined,
  ): void {
    elapsedSeconds += dtSeconds;
    buildBudgetRemaining = WATER_BUILD_BUDGET_PER_FRAME;
    sharedMaterial.uniforms.time.value = elapsedSeconds;

    if (sunDirection) {
      sharedMaterial.uniforms.sunDirection.value.copy(sunDirection).normalize();
    }
    if (skyColor) {
      sharedMaterial.uniforms.skyColor.value.copy(skyColor);
    }

    const lakeTiles = expandLakeWaterTiles(selectedTiles, planet, seed);
    const nextActiveKeys = new Set<string>();

    for (const info of lakeTiles) {
      const key = tileKey(info.face, info.level, info.x, info.y);
      nextActiveKeys.add(key);
      const entry = requestTile(info);
      if (entry.water) entry.water.visible = true;
    }

    pumpBuildQueue();

    for (const key of activeKeys) {
      if (nextActiveKeys.has(key)) continue;
      const entry = cache.get(key);
      if (entry?.water) entry.water.visible = false;
      discardPendingBuild(key);
    }

    activeKeys.clear();
    for (const key of nextActiveKeys) activeKeys.add(key);

    for (const [key, entry] of cache) {
      if (activeKeys.has(key)) continue;
      releaseEntry(key, entry);
    }

    waterGroup.position.set(
      -bodyPosition.x * renderScale,
      -bodyPosition.y * renderScale,
      -bodyPosition.z * renderScale,
    );
  }

  function dispose(): void {
    pendingBuilds.length = 0;
    for (const [key, entry] of cache) {
      releaseEntry(key, entry);
    }
    sharedMaterial.dispose();
    waterNormals.dispose();
    scene.remove(waterGroup);
  }

  return {
    dispose,
    update,
  };
}
