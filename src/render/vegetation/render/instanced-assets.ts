import * as THREE from 'three';
import { GLTFLoader, type GLTF } from 'three/examples/jsm/loaders/GLTFLoader';
import type { VegetationAssetCatalog } from '../domain/asset_catalog';
import {
  createGrassBillboardAssets,
  createGrassBillboardFromTexture,
} from './grass_billboard';
import { DEFAULT_GRASS_COLOR } from '../settings';
import { applyWindToMaterial } from './wind';
import { deduplicateObjectTextures } from '../../assets/texture_dedup';

function isGrassImageUrl(url: string): boolean {
  return /\.(png|jpe?g|webp)(\?|$)/i.test(url);
}

export type VegetationWindProfile = 'grass' | 'tree';

// Sway amplitude as a fraction of the asset's own height, and how fast it
// oscillates. Grass whips around; trees only lean near the canopy.
const WIND_PROFILES: Record<
  VegetationWindProfile,
  { strengthPerHeight: number; speed: number }
> = {
  grass: { strengthPerHeight: 0.12, speed: 1.6 },
  tree: { strengthPerHeight: 0.035, speed: 0.7 },
};

export interface InstancedAssetPart {
  geometry: THREE.BufferGeometry;
  material: THREE.Material | THREE.Material[];
}

export interface InstancedAsset {
  baseOffsetY: number;
  /**
   * Mesh AABB half-extents at scale = 1 (local Y = up). Used by surface-spawn
   * physics so prop colliders match the visible GLB, not tiny authored defaults.
   */
  boundsHalfExtents?: [number, number, number];
  /**
   * Collider center in instance-local space when the body sits on the surface
   * contact point (accounts for baseOffsetY / non-centered pivots).
   */
  collisionCenter?: [number, number, number];
  parts: InstancedAssetPart[];
}

export interface InstancedAssetCatalog extends VegetationAssetCatalog {
  grass: InstancedAsset[];
  trees: InstancedAsset[];
}

function configureMaterial(
  material: THREE.Material | undefined,
): THREE.Material {
  const configured = material?.clone?.() ?? material;
  if (!configured)
    return new THREE.MeshStandardMaterial({
      color: 0x6f8f3a,
      side: THREE.DoubleSide,
    });
  const meshMaterial = configured as THREE.MeshStandardMaterial;
  if (meshMaterial.map) meshMaterial.map.colorSpace = THREE.SRGBColorSpace;
  if (meshMaterial.emissiveMap)
    meshMaterial.emissiveMap.colorSpace = THREE.SRGBColorSpace;
  if (meshMaterial.alphaMap)
    meshMaterial.alphaMap.colorSpace = THREE.SRGBColorSpace;
  meshMaterial.side = THREE.DoubleSide;
  return meshMaterial;
}

export function extractInstancedAsset(
  gltf: GLTF,
  windProfile?: VegetationWindProfile,
): InstancedAsset {
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

  if (windProfile && !bounds.isEmpty()) {
    const profile = WIND_PROFILES[windProfile];
    const height = Math.max(bounds.max.y - bounds.min.y, 1e-3);
    for (const part of parts) {
      const materials = Array.isArray(part.material)
        ? part.material
        : [part.material];
      for (const material of materials) {
        applyWindToMaterial(material, {
          referenceHeight: height,
          speed: profile.speed,
          strength: height * profile.strengthPerHeight,
        });
      }
    }
  }

  if (bounds.isEmpty()) {
    return { baseOffsetY: 0, parts };
  }
  const baseOffsetY = -bounds.min.y;
  const hx = Math.max(0.05, (bounds.max.x - bounds.min.x) * 0.5);
  const hy = Math.max(0.05, (bounds.max.y - bounds.min.y) * 0.5);
  const hz = Math.max(0.05, (bounds.max.z - bounds.min.z) * 0.5);
  const cx = (bounds.min.x + bounds.max.x) * 0.5;
  const cz = (bounds.min.z + bounds.max.z) * 0.5;
  // Bottom of AABB sits on the surface after baseOffsetY lift → center at +hy.
  return {
    baseOffsetY,
    boundsHalfExtents: [hx, hy, hz],
    collisionCenter: [cx, hy, cz],
    parts,
  };
}

function disposeMaterial(
  material: THREE.Material | THREE.Material[] | undefined,
): void {
  if (Array.isArray(material)) {
    material.forEach(disposeMaterial);
    return;
  }
  if (!material) return;
  const meshMaterial = material as THREE.MeshStandardMaterial;
  meshMaterial.map?.dispose();
  meshMaterial.normalMap?.dispose();
  meshMaterial.roughnessMap?.dispose();
  meshMaterial.metalnessMap?.dispose();
  meshMaterial.alphaMap?.dispose();
  meshMaterial.dispose?.();
}


export function disposeInstancedAssets(assets: InstancedAsset[]): void {
  assets.forEach((asset) => {
    asset.parts.forEach((part) => {
      part.geometry.dispose();
      disposeMaterial(part.material);
    });
  });
}

export function createEmptyAssetCatalog(): InstancedAssetCatalog {
  return { grass: [], trees: [] };
}

export interface VegetationAssetUrlLists {
  grassUrls: readonly string[];
  treeUrls: readonly string[];
  /** CSS hex tint for grass billboards. */
  grassColor?: string;
}

/**
 * Load planet-authored vegetation. Grass URLs are PNG billboard textures
 * (empty → procedural cards). Tree URLs are GLB/GLTF meshes (empty → none).
 */
export function loadInstancedAssetCatalog(
  urls: VegetationAssetUrlLists,
  onComplete: (catalog: InstancedAssetCatalog) => void,
  onError?: (path: string, label: string, error: unknown) => void,
): void {
  const catalog = createEmptyAssetCatalog();
  const gltfLoader = new GLTFLoader();
  const textureLoader = new THREE.TextureLoader();
  const grassUrls = urls.grassUrls.filter((url) => url.length > 0);
  const treeUrls = urls.treeUrls.filter((url) => url.length > 0);
  const grassColor = urls.grassColor ?? DEFAULT_GRASS_COLOR;

  if (grassUrls.length === 0) {
    catalog.grass.push(...createGrassBillboardAssets(grassColor));
  }

  type GrassJob = { kind: 'grass'; url: string };
  type TreeJob = { kind: 'tree'; url: string };
  type LoadJob = GrassJob | TreeJob;
  const jobs: LoadJob[] = [
    ...grassUrls.map((url): GrassJob => ({ kind: 'grass', url })),
    ...treeUrls.map((url): TreeJob => ({ kind: 'tree', url })),
  ];

  if (jobs.length === 0) {
    onComplete(catalog);
    return;
  }

  let loadedAssetCount = 0;
  function markAssetLoaded(): void {
    loadedAssetCount += 1;
    if (loadedAssetCount === jobs.length) onComplete(catalog);
  }

  for (const job of jobs) {
    if (job.kind === 'grass') {
      if (!isGrassImageUrl(job.url)) {
        onError?.(job.url, 'grass', new Error('Grass assets must be image textures'));
        markAssetLoaded();
        continue;
      }
      textureLoader.load(
        job.url,
        (texture) => {
          catalog.grass.push(
            createGrassBillboardFromTexture(texture, { color: grassColor }),
          );
          markAssetLoaded();
        },
        undefined,
        (err) => {
          onError?.(job.url, 'grass', err);
          markAssetLoaded();
        },
      );
      continue;
    }

    gltfLoader.load(
      job.url,
      (gltf) => {
        deduplicateObjectTextures(gltf.scene);
        const asset = extractInstancedAsset(gltf, 'tree');
        if (asset.parts.length > 0) catalog.trees.push(asset);
        markAssetLoaded();
      },
      undefined,
      (err) => {
        onError?.(job.url, 'tree', err);
        markAssetLoaded();
      },
    );
  }
}
