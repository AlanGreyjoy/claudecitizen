import * as THREE from 'three';

/**
 * Releases the decoded CPU-side copy of a texture once it is on the GPU.
 *
 * GLTFLoader decodes through ImageBitmapLoader, and three never closes the
 * resulting ImageBitmap — it stays in `texture.source.data` for the texture's
 * whole life, so every atlas costs its bytes twice. Three exposes no
 * post-upload hook, and "wait one frame" is unsound for an object that is not
 * visible yet, so the drain calls `renderer.initTexture` to force the upload
 * before closing the bitmap.
 *
 * Forced off. WebGPU node materials call `Textures.updateTexture` again
 * whenever a sampled-texture binding reports `updated` — and that path reads
 * `image.complete`. Nulling `source.data` after the first upload therefore
 * black-screens the next frame (`Cannot read properties of null (reading
 * 'complete')`), including on the first hab load. Scene switches make it
 * worse: the play renderer is disposed and a cache hit cannot re-upload.
 *
 * When re-enabling: use `!AUTHORING_ENABLED` as well (editor runs several
 * WebGPU renderers that each need the CPU source), and add a Three-safe
 * "source released" guard so binding updates skip `image.complete` on null.
 */
const RELEASE_DECODED_TEXTURE_SOURCES = false;

const queue: THREE.Texture[] = [];
const queued = new WeakSet<THREE.Texture>();

function collectTextures(material: THREE.Material, out: Set<THREE.Texture>): void {
  for (const value of Object.values(material)) {
    if (value instanceof THREE.Texture) out.add(value);
  }
}

/**
 * Queues every ImageBitmap-backed texture in a freshly loaded subtree for
 * release. Call right after texture dedup, before the object reaches a scene.
 */
export function queueSourceRelease(root: THREE.Object3D): void {
  if (!RELEASE_DECODED_TEXTURE_SOURCES) return;
  if (typeof ImageBitmap === 'undefined') return;

  const textures = new Set<THREE.Texture>();
  root.traverse((object) => {
    const candidate = object as THREE.Object3D & {
      material?: THREE.Material | THREE.Material[];
    };
    if (Array.isArray(candidate.material)) {
      for (const material of candidate.material) collectTextures(material, textures);
    } else if (candidate.material) {
      collectTextures(candidate.material, textures);
    }
  });

  for (const texture of textures) {
    // Only ImageBitmap has close(); the HTMLImageElement fallback path that
    // GLTFLoader takes on older browsers must be left alone.
    if (!(texture.source?.data instanceof ImageBitmap)) continue;
    if (queued.has(texture)) continue;
    queued.add(texture);
    queue.push(texture);
  }
}

/** Drops pending releases — call when the play renderer is torn down. */
export function clearSourceReleaseQueue(): void {
  queue.length = 0;
}

/**
 * Uploads and releases up to `budget` queued textures. Call once per frame
 * after presenting, so a large scene never stalls a single frame.
 */
export function drainSourceReleases(
  renderer: Pick<THREE.WebGLRenderer, 'initTexture'>,
  budget: number,
): number {
  if (!RELEASE_DECODED_TEXTURE_SOURCES || queue.length === 0) return 0;
  let released = 0;
  while (released < budget) {
    const texture = queue.pop();
    if (!texture) break;
    const bitmap = texture.source?.data;
    if (!(bitmap instanceof ImageBitmap)) continue;
    try {
      renderer.initTexture(texture);
      bitmap.close();
      texture.source.data = null;
    } catch (error) {
      console.warn('[texture-upload] failed to release decoded source', error);
    }
    released += 1;
  }
  return released;
}

export function getPendingSourceReleaseCount(): number {
  return queue.length;
}
