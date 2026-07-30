import * as THREE from 'three';
import { isCanonicalTexture } from './texture-dedup';

/**
 * GPU teardown helpers.
 *
 * Two flavours, and the distinction matters: `loadPrefabModel` hands out
 * `template.clone(true)`, so a clone SHARES geometry and materials with the
 * cached template. Disposing a clone's shared resources blanks every other
 * instance. A clone may therefore only dispose what it allocated for itself
 * (`disposeOwnedGpuResources`); the shared bytes come back only when the
 * template itself is evicted (`disposeCacheTemplate`).
 */

export interface DisposedCounts {
  geometries: number;
  materials: number;
  textures: number;
}

/** Resources a subtree allocated for itself — never shared with a cache template. */
export interface OwnedGpuResources {
  geometries: Set<THREE.BufferGeometry>;
  materials: Set<THREE.Material>;
  /** Prevents late async model loads from attaching to a torn-down instance. */
  disposed: boolean;
}

interface OwnedGpuUserData {
  ownedGpu?: OwnedGpuResources;
}

export function createOwnedGpuResources(): OwnedGpuResources {
  return { geometries: new Set(), materials: new Set(), disposed: false };
}

function emptyCounts(): DisposedCounts {
  return { geometries: 0, materials: 0, textures: 0 };
}

function materialsOf(object: THREE.Object3D): THREE.Material[] {
  const candidate = object as THREE.Object3D & {
    material?: THREE.Material | THREE.Material[];
  };
  if (Array.isArray(candidate.material)) return candidate.material;
  return candidate.material ? [candidate.material] : [];
}

function geometryOf(object: THREE.Object3D): THREE.BufferGeometry | null {
  const candidate = object as THREE.Object3D & { geometry?: THREE.BufferGeometry };
  return candidate.geometry ?? null;
}

/**
 * Disposes shadow-map render targets hanging off lights in a subtree. Three
 * allocates these lazily on first render and never frees them on `scene.clear()`.
 */
export function disposeSubtreeShadowMaps(root: THREE.Object3D): number {
  let disposed = 0;
  root.traverse((object) => {
    const light = object as THREE.Object3D & { shadow?: THREE.LightShadow };
    const map = light.shadow?.map;
    if (!map) return;
    map.dispose();
    light.shadow!.map = null;
    disposed += 1;
  });
  return disposed;
}

/**
 * Tears down only the resources this subtree owns outright, then detaches it.
 * Safe on clones: it never touches textures, and never touches geometry or
 * materials that came from a shared cache template.
 */
export function disposeOwnedGpuResources(root: THREE.Object3D): DisposedCounts {
  const counts = emptyCounts();
  const owned = (root.userData as OwnedGpuUserData | undefined)?.ownedGpu;
  if (owned) {
    owned.disposed = true;
    for (const material of owned.materials) {
      material.dispose();
      counts.materials += 1;
    }
    for (const geometry of owned.geometries) {
      geometry.dispose();
      counts.geometries += 1;
    }
    owned.materials.clear();
    owned.geometries.clear();
  }
  disposeSubtreeShadowMaps(root);
  root.removeFromParent();
  root.clear();
  return counts;
}

/**
 * Full teardown for a resource nothing else references — cache templates only.
 * Skips textures reported canonical by texture-dedup: those are shared across
 * templates and refcounted separately by `releaseTextureOwner`.
 */
export function disposeCacheTemplate(root: THREE.Object3D): DisposedCounts {
  const counts = emptyCounts();
  const geometries = new Set<THREE.BufferGeometry>();
  const materials = new Set<THREE.Material>();
  const textures = new Set<THREE.Texture>();

  root.traverse((object) => {
    const geometry = geometryOf(object);
    if (geometry) geometries.add(geometry);
    for (const material of materialsOf(object)) {
      materials.add(material);
      for (const value of Object.values(material)) {
        if (value instanceof THREE.Texture && !isCanonicalTexture(value)) textures.add(value);
      }
    }
  });

  for (const material of materials) {
    material.dispose();
    counts.materials += 1;
  }
  for (const geometry of geometries) {
    geometry.dispose();
    counts.geometries += 1;
  }
  for (const texture of textures) {
    texture.dispose();
    counts.textures += 1;
  }

  disposeSubtreeShadowMaps(root);
  root.removeFromParent();
  root.clear();
  return counts;
}
