import * as THREE from 'three';
import { GLTFLoader } from 'three/examples/jsm/loaders/GLTFLoader';
import { deduplicateObjectTextures } from '../assets/texture_dedup';
import { extractInstancedAsset, type InstancedAsset } from '../vegetation/render/instanced_assets';

const loader = new GLTFLoader();
const cache = new Map<string, Promise<InstancedAsset | null>>();
/** Bump when material harden rules change so HMR cannot reuse dark/envMap mats. */
const ASSET_CACHE_EPOCH = 'no-envmap-v2';

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

export function loadSurfaceSpawnAsset(
  assetUrl: string,
): Promise<InstancedAsset | null> {
  const cacheKey = `${ASSET_CACHE_EPOCH}:${assetUrl}`;
  const existing = cache.get(cacheKey);
  if (existing) return existing;

  const promise = new Promise<InstancedAsset | null>((resolve) => {
    loader.load(
      assetUrl,
      (gltf) => {
        deduplicateObjectTextures(gltf.scene);
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

export function disposeSurfaceSpawnAssetCache(): void {
  cache.clear();
}
