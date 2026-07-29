import * as THREE from 'three';
import { GLTFLoader } from 'three/examples/jsm/loaders/GLTFLoader';
import { attachKtx2Loader } from '../assets/ktx2';
import { deduplicateObjectTextures, releaseTextureOwner } from '../assets/texture-dedup';
import { queueSourceRelease } from '../assets/texture-upload';
import { registerAssetCache, touchAsset } from '../../cache/asset-residency';
import {
  disposeInstancedAssets,
  extractInstancedAsset,
  type InstancedAsset,
} from '../vegetation/render/instanced-assets';

const loader = attachKtx2Loader(new GLTFLoader());
const cache = new Map<string, Promise<InstancedAsset | null>>();
/** Bump when material harden rules change so HMR cannot reuse dark/envMap mats. */
const ASSET_CACHE_EPOCH = 'no-envmap-v2';
/** Cache name used with the asset-residency sweep. */
export const SURFACE_SPAWN_ASSET_CACHE = 'surfaceSpawnAssets';

function hardenSpawnMaterials(asset: InstancedAsset): void {
  for (const part of asset.parts) {
    const materials = Array.isArray(part.material)
      ? part.material
      : [part.material];
    for (const material of materials) {
      material.side = THREE.DoubleSide;
      material.transparent = false;
      material.depthWrite = true;
      material.visible = true;
      const std = material as THREE.MeshStandardMaterial;
      if (std.isMeshStandardMaterial) {
        // Reflections track the camera and read as the mesh "spinning".
        std.envMap = null;
        std.envMapIntensity = 0;
        // Unity trim sheets often import overly dark; keep rocks readable.
        std.metalness = Math.min(std.metalness ?? 0, 0.15);
        std.roughness = Math.max(std.roughness ?? 0.8, 0.65);
        if (std.color) std.color.multiplyScalar(1.15);
      }
    }
  }
}

registerAssetCache(SURFACE_SPAWN_ASSET_CACHE, (cacheKey) => {
  const pending = cache.get(cacheKey);
  cache.delete(cacheKey);
  if (!pending) return;
  const assetUrl = cacheKey.slice(ASSET_CACHE_EPOCH.length + 1);
  void pending
    .then((asset) => {
      if (asset) disposeInstancedAssets([asset]);
      releaseTextureOwner(assetUrl);
    })
    .catch(() => undefined);
});

export function loadSurfaceSpawnAsset(
  assetUrl: string,
): Promise<InstancedAsset | null> {
  const cacheKey = `${ASSET_CACHE_EPOCH}:${assetUrl}`;
  touchAsset(SURFACE_SPAWN_ASSET_CACHE, cacheKey);
  const existing = cache.get(cacheKey);
  if (existing) return existing;

  const promise = new Promise<InstancedAsset | null>((resolve) => {
    loader.load(
      assetUrl,
      (gltf) => {
        deduplicateObjectTextures(gltf.scene, { owner: assetUrl });
        queueSourceRelease(gltf.scene);
        const asset = extractInstancedAsset(gltf);
        if (asset.parts.length === 0) {
          resolve(null);
          return;
        }
        hardenSpawnMaterials(asset);
        resolve(asset);
      },
      undefined,
      () => resolve(null),
    );
  });
  cache.set(cacheKey, promise);
  return promise;
}

/**
 * Drops every entry, disposing the GPU resources each one owns. Previously this
 * only cleared the map, which leaked every geometry and material it held.
 */
export function disposeSurfaceSpawnAssetCache(): void {
  const keys = [...cache.keys()];
  for (const cacheKey of keys) {
    const pending = cache.get(cacheKey);
    cache.delete(cacheKey);
    if (!pending) continue;
    const assetUrl = cacheKey.slice(ASSET_CACHE_EPOCH.length + 1);
    void pending
      .then((asset) => {
        if (asset) disposeInstancedAssets([asset]);
        releaseTextureOwner(assetUrl);
      })
      .catch(() => undefined);
  }
}
