import * as THREE from 'three';

interface CanonicalTextureEntry {
  texture: THREE.Texture;
  /** Asset urls whose materials bind this texture. Empty set => safe to dispose. */
  owners: Set<string>;
  estimatedBytes: number;
}

export interface TextureDedupStats {
  examined: number;
  reused: number;
}

export interface TextureDedupOptions {
  /** Asset url that owns this object. Required for the texture to be releasable. */
  owner?: string;
}

export interface TextureDedupSnapshot {
  entries: number;
  estimatedBytes: number;
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
/** Reverse index so releasing an owner does not scan every entry. */
const ownerKeys = new Map<string, Set<string>>();
/** Identity set for `isCanonicalTexture` — a shared texture must never be disposed by a template walk. */
const canonicalIdentities = new WeakSet<THREE.Texture>();

let totalEstimatedBytes = 0;
let examinedTotal = 0;
let reusedTotal = 0;

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

/**
 * Resident bytes for one texture. Compressed textures carry their real payload
 * in `mipmaps`; uncompressed ones cost 4 bytes per texel plus a 4/3 mip chain.
 */
function estimateTextureBytes(texture: THREE.Texture): number {
  const compressed = texture as THREE.Texture & {
    isCompressedTexture?: boolean;
    mipmaps?: Array<{ data?: { byteLength?: number } }>;
  };
  if (compressed.isCompressedTexture && compressed.mipmaps?.length) {
    let bytes = 0;
    for (const mip of compressed.mipmaps) bytes += mip.data?.byteLength ?? 0;
    return bytes;
  }
  const { depth, height, width } = imageDimensions(texture);
  const base = width * height * Math.max(1, depth) * 4;
  return texture.generateMipmaps ? Math.round(base * (4 / 3)) : base;
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

function rememberOwner(key: string, owner: string | undefined): void {
  if (!owner) return;
  const entry = canonicalTextures.get(key);
  if (!entry) return;
  entry.owners.add(owner);
  let keys = ownerKeys.get(owner);
  if (!keys) {
    keys = new Set();
    ownerKeys.set(owner, keys);
  }
  keys.add(key);
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
  owner: string | undefined,
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
      const estimatedBytes = estimateTextureBytes(value);
      canonicalTextures.set(key, { estimatedBytes, owners: new Set(), texture: value });
      canonicalIdentities.add(value);
      totalEstimatedBytes += estimatedBytes;
      rememberOwner(key, owner);
      continue;
    }
    rememberOwner(key, owner);
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
 *
 * Pass `options.owner` (the asset url) so the texture can later be released by
 * `releaseTextureOwner` when that asset's cache entry is evicted.
 */
export function deduplicateObjectTextures(
  root: THREE.Object3D,
  options?: TextureDedupOptions,
): TextureDedupStats {
  const disposed = new Set<THREE.Texture>();
  let examined = 0;
  let reused = 0;

  for (const material of collectObjectMaterials(root)) {
    const stats = deduplicateMaterialTextures(material, disposed, options?.owner);
    examined += stats.examined;
    reused += stats.reused;
  }

  examinedTotal += examined;
  reusedTotal += reused;
  return { examined, reused };
}

/**
 * True when this exact texture object is the shared canonical instance. Callers
 * tearing down a cache template must skip these — another live template may
 * still bind the same object, and disposing it would blank that material.
 */
export function isCanonicalTexture(texture: THREE.Texture): boolean {
  return canonicalIdentities.has(texture);
}

/**
 * Drops one asset url's claim on the canonical textures it bound. Textures whose
 * owner set goes empty are disposed and unmapped. Call this *after* the owning
 * cache template has been torn down.
 */
export function releaseTextureOwner(owner: string): { bytesFreed: number; disposed: number } {
  const keys = ownerKeys.get(owner);
  if (!keys) return { bytesFreed: 0, disposed: 0 };
  ownerKeys.delete(owner);

  let bytesFreed = 0;
  let disposed = 0;
  for (const key of keys) {
    const entry = canonicalTextures.get(key);
    if (!entry) continue;
    entry.owners.delete(owner);
    if (entry.owners.size > 0) continue;
    entry.texture.dispose();
    canonicalTextures.delete(key);
    totalEstimatedBytes -= entry.estimatedBytes;
    bytesFreed += entry.estimatedBytes;
    disposed += 1;
  }
  if (totalEstimatedBytes < 0) totalEstimatedBytes = 0;
  return { bytesFreed, disposed };
}

export function getTextureDedupSnapshot(): TextureDedupSnapshot {
  return {
    entries: canonicalTextures.size,
    estimatedBytes: totalEstimatedBytes,
    examined: examinedTotal,
    reused: reusedTotal,
  };
}
