import * as THREE from 'three';

interface CanonicalTextureEntry {
  texture: THREE.Texture;
}

export interface TextureDedupStats {
  examined: number;
  reused: number;
}

interface MaterialTextureStats {
  examined: number;
  reused: number;
}

// Large texture atlases dominate the game footprint. Different protected GLBs
// often embed the same named atlas, so GLTFLoader cannot share it by URL.
const MIN_DEDUP_TEXTURE_DIMENSION = 1_024;
const canonicalTextures = new Map<string, CanonicalTextureEntry>();

function imageDimensions(texture: THREE.Texture): {
  depth: number;
  height: number;
  width: number;
} {
  const image = texture.source?.data as
    | { depth?: number; height?: number; videoHeight?: number; videoWidth?: number; width?: number }
    | undefined;
  return {
    depth: image?.depth ?? 1,
    height: image?.height ?? image?.videoHeight ?? 0,
    width: image?.width ?? image?.videoWidth ?? 0,
  };
}

function vector2Key(vector: THREE.Vector2): string {
  return `${vector.x},${vector.y}`;
}

/**
 * Texture names alone are not safe identifiers. Include the material usage,
 * decoded dimensions, sampler state, and UV transform so only equivalent atlas
 * bindings converge on one Three.js texture object.
 */
function canonicalTextureKey(
  property: string,
  texture: THREE.Texture,
): string | null {
  const name = texture.name.trim();
  const { depth, height, width } = imageDimensions(texture);
  if (!name || Math.max(width, height) < MIN_DEDUP_TEXTURE_DIMENSION) return null;

  return [
    property,
    name,
    width,
    height,
    depth,
    texture.mapping,
    texture.channel,
    texture.wrapS,
    texture.wrapT,
    texture.magFilter,
    texture.minFilter,
    texture.anisotropy,
    texture.format,
    texture.internalFormat,
    texture.type,
    texture.colorSpace,
    texture.flipY,
    texture.generateMipmaps,
    texture.premultiplyAlpha,
    texture.unpackAlignment,
    vector2Key(texture.offset),
    vector2Key(texture.repeat),
    vector2Key(texture.center),
    texture.rotation,
  ].join('|');
}

function collectObjectMaterials(root: THREE.Object3D): Set<THREE.Material> {
  const materials = new Set<THREE.Material>();
  root.traverse((object) => {
    const candidate = object as THREE.Object3D & {
      material?: THREE.Material | THREE.Material[];
    };
    const objectMaterials = Array.isArray(candidate.material)
      ? candidate.material
      : candidate.material
        ? [candidate.material]
        : [];
    for (const material of objectMaterials) materials.add(material);
  });
  return materials;
}

function deduplicateMaterialTextures(
  material: THREE.Material,
  disposed: Set<THREE.Texture>,
): MaterialTextureStats {
  const properties = material as unknown as Record<string, unknown>;
  let materialChanged = false;
  let examined = 0;
  let reused = 0;

  for (const [property, value] of Object.entries(properties)) {
    if (!(value instanceof THREE.Texture)) continue;
    examined += 1;
    const key = canonicalTextureKey(property, value);
    if (!key) continue;

    const canonical = canonicalTextures.get(key);
    if (!canonical) {
      canonicalTextures.set(key, { texture: value });
      continue;
    }
    if (canonical.texture === value) continue;

    properties[property] = canonical.texture;
    materialChanged = true;
    reused += 1;
    if (!disposed.has(value)) {
      disposed.add(value);
      value.dispose();
    }
  }
  if (materialChanged) material.needsUpdate = true;
  return { examined, reused };
}

/**
 * Rebind equivalent large textures in a freshly loaded object to one canonical
 * texture. This runs before the object reaches the scene, so duplicate textures
 * are never uploaded to WebGL.
 */
export function deduplicateObjectTextures(root: THREE.Object3D): TextureDedupStats {
  const disposed = new Set<THREE.Texture>();
  let examined = 0;
  let reused = 0;

  for (const material of collectObjectMaterials(root)) {
    const stats = deduplicateMaterialTextures(material, disposed);
    examined += stats.examined;
    reused += stats.reused;
  }

  return { examined, reused };
}
