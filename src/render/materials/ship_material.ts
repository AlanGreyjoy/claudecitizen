import * as THREE from 'three';
import type { PrefabMaterialOverride } from '../../world/prefabs/schema';

export const MAIN_SURFACE_MATERIAL = {
  metalness: 0.18,
  roughness: 0.78,
} as const;
export const PREFAB_PRIMITIVE_MATERIAL_NAME = '__primitive__';

function normalizeMaterialName(name: string): string {
  return name.replace(/_URP$/, '');
}

function applyMainShipSurface(meshMaterial: THREE.MeshStandardMaterial): void {
  meshMaterial.metalness = MAIN_SURFACE_MATERIAL.metalness;
  meshMaterial.roughness = MAIN_SURFACE_MATERIAL.roughness;
}

export function applyMaterialOverride(
  material: THREE.Material,
  override: PrefabMaterialOverride,
): void {
  const meshMaterial = material as THREE.MeshStandardMaterial & {
    color?: THREE.Color;
    emissive?: THREE.Color;
    emissiveIntensity?: number;
    metalness?: number;
    roughness?: number;
    opacity?: number;
    transparent?: boolean;
  };
  if (override.color && meshMaterial.color) meshMaterial.color.set(override.color);
  if (override.emissive && meshMaterial.emissive) meshMaterial.emissive.set(override.emissive);
  if (override.emissiveIntensity !== undefined) {
    meshMaterial.emissiveIntensity = override.emissiveIntensity;
  }
  if (override.metalness !== undefined) meshMaterial.metalness = override.metalness;
  if (override.roughness !== undefined) meshMaterial.roughness = override.roughness;
  if (override.opacity !== undefined) {
    meshMaterial.opacity = override.opacity;
    meshMaterial.transparent = override.opacity < 1;
    meshMaterial.depthWrite = override.opacity >= 1;
  }
  material.needsUpdate = true;
}

export function configureShipMaterial(
  material: THREE.Material | THREE.Material[] | null | undefined,
): void {
  if (Array.isArray(material)) {
    material.forEach(configureShipMaterial);
    return;
  }
  if (!material) return;

  const meshMaterial = material as THREE.MeshStandardMaterial & {
    emissive?: THREE.Color;
    map?: THREE.Texture | null;
    normalMap?: THREE.Texture | null;
  };
  if (meshMaterial.map) meshMaterial.map.colorSpace = THREE.SRGBColorSpace;
  if (meshMaterial.emissiveMap) meshMaterial.emissiveMap.colorSpace = THREE.SRGBColorSpace;

  const materialName = normalizeMaterialName(material.name);

  switch (materialName) {
    case 'VA_Glass2':
    case 'VA_Glass4':
      meshMaterial.color?.setHex(0x9bc9f5);
      meshMaterial.metalness = 0;
      meshMaterial.roughness = 0.08;
      meshMaterial.opacity = Math.min(meshMaterial.opacity ?? 1, 0.2);
      meshMaterial.transparent = true;
      return;
    case 'VA_Mirror':
      meshMaterial.color?.setHex(0xc5d1dc);
      meshMaterial.metalness = 0.86;
      meshMaterial.roughness = 0.06;
      return;
    case 'Light_White_Bright':
      meshMaterial.color?.setHex(0xffffff);
      meshMaterial.emissive?.setHex(0xd9e5ff);
      meshMaterial.emissiveIntensity = 1.2;
      return;
    case 'Light_Yellow_Med':
      meshMaterial.color?.setHex(0xffd5a0);
      meshMaterial.emissive?.setHex(0xffc27d);
      meshMaterial.emissiveIntensity = 1.1;
      return;
    case 'Light_Blue_Med':
      meshMaterial.color?.setHex(0x7bb6ff);
      meshMaterial.emissive?.setHex(0x67b6ff);
      meshMaterial.emissiveIntensity = 1.1;
      return;
    case 'VA_ScreenOff':
      meshMaterial.color?.setHex(0x09101a);
      meshMaterial.emissive?.setHex(0x000000);
      meshMaterial.metalness = 0.02;
      meshMaterial.roughness = 0.92;
      return;
    default:
      break;
  }

  // All ordinary ship/model surfaces share the same satin-matte response.
  // Texture maps still provide color and material variation.
  applyMainShipSurface(meshMaterial);
}
