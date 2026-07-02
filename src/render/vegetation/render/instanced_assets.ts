import * as THREE from 'three';
import { GLTFLoader, type GLTF } from 'three/examples/jsm/loaders/GLTFLoader';
import type { VegetationAssetCatalog } from '../domain/asset_catalog';
import { applyWindToMaterial } from './wind';

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

  return {
    baseOffsetY: bounds.isEmpty() ? 0 : -bounds.min.y,
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
  const meshMaterial = material as THREE.MeshStandardMaterial | undefined;
  meshMaterial?.map?.dispose();
  meshMaterial?.normalMap?.dispose();
  meshMaterial?.roughnessMap?.dispose();
  meshMaterial?.metalnessMap?.dispose();
  meshMaterial?.alphaMap?.dispose();
  meshMaterial?.dispose?.();
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

export function loadInstancedAssetCatalog(
  onComplete: (catalog: InstancedAssetCatalog) => void,
  onError?: (path: string, label: string, error: unknown) => void,
): void {
  const catalog = createEmptyAssetCatalog();
  const loader = new GLTFLoader();

  const grassPaths = [
    '../../../assets/stylized-nature-magakit/Grass_Common_Short.gltf',
    '../../../assets/stylized-nature-magakit/Grass_Common_Tall.gltf',
    '../../../assets/stylized-nature-magakit/Grass_Wispy_Short.gltf',
    '../../../assets/stylized-nature-magakit/Grass_Wispy_Tall.gltf',
  ];
  const pinePaths = [
    '../../../assets/stylized-nature-magakit/Pine_1.gltf',
    '../../../assets/stylized-nature-magakit/Pine_2.gltf',
    '../../../assets/stylized-nature-magakit/Pine_3.gltf',
    '../../../assets/stylized-nature-magakit/Pine_4.gltf',
    '../../../assets/stylized-nature-magakit/Pine_5.gltf',
  ];
  const totalAssetLoads = grassPaths.length + pinePaths.length;
  let loadedAssetCount = 0;

  function markAssetLoaded(): void {
    loadedAssetCount += 1;
    if (loadedAssetCount === totalAssetLoads) onComplete(catalog);
  }

  function load(
    path: string,
    target: InstancedAsset[],
    label: string,
    windProfile: VegetationWindProfile,
  ): void {
    const url = new URL(path, import.meta.url).href;
    loader.load(
      url,
      (gltf) => {
        const asset = extractInstancedAsset(gltf, windProfile);
        if (asset.parts.length > 0) target.push(asset);
        markAssetLoaded();
      },
      undefined,
      (err) => {
        onError?.(path, label, err);
        markAssetLoaded();
      },
    );
  }

  grassPaths.forEach((path) => {
    load(path, catalog.grass, 'grass', 'grass');
  });
  pinePaths.forEach((path) => {
    load(path, catalog.trees, 'pine', 'tree');
  });
}
