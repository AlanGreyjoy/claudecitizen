import * as THREE from 'three';
import { GLTFLoader } from 'three/examples/jsm/loaders/GLTFLoader';
import {
  getCachedModelThumbnail,
  putCachedModelThumbnail,
} from '../../editor/model_thumbnail_cache';

/**
 * Lazy model thumbnails for the asset browser / inventory icons.
 * One shared offscreen renderer, one model at a time, ephemeral GLB loads
 * (never touches the prefab modelCache), LRU-cached data-URLs.
 */

const THUMB_SIZE = 96;
const MAX_CACHED_THUMBS = 96;
const CLEAR_COLOR = 0x12161c;
const PERSISTENT_CACHE_EPOCH = 'model-thumbnail-v1';

const gltfLoader = new GLTFLoader();
/** Resolved thumbnail data-URLs (insertion order = LRU). */
const resolved = new Map<string, string>();
/** In-flight renders keyed by url. */
const inflight = new Map<string, Promise<string>>();

let shared: {
  renderer: THREE.WebGLRenderer;
  scene: THREE.Scene;
  camera: THREE.PerspectiveCamera;
  stage: THREE.Group;
} | null = null;

let queue: Promise<unknown> = Promise.resolve();

function ensureShared() {
  if (shared) return shared;
  const canvas = document.createElement('canvas');
  canvas.width = THUMB_SIZE;
  canvas.height = THUMB_SIZE;
  const renderer = new THREE.WebGLRenderer({
    canvas,
    antialias: true,
    alpha: false,
    preserveDrawingBuffer: true,
  });
  renderer.setSize(THUMB_SIZE, THUMB_SIZE, false);
  renderer.setClearColor(CLEAR_COLOR, 1);
  renderer.outputColorSpace = THREE.SRGBColorSpace;

  const scene = new THREE.Scene();
  scene.add(new THREE.HemisphereLight(0xdde8ff, 0x202836, 1.4));
  const sun = new THREE.DirectionalLight(0xffffff, 2.4);
  sun.position.set(3, 5, 4);
  scene.add(sun);

  const camera = new THREE.PerspectiveCamera(38, 1, 0.01, 2000);
  const stage = new THREE.Group();
  scene.add(stage);

  shared = { renderer, scene, camera, stage };
  return shared;
}

function disposeObjectTree(root: THREE.Object3D): void {
  const textures = new Set<THREE.Texture>();
  root.traverse((object) => {
    if (!(object instanceof THREE.Mesh)) return;
    object.geometry?.dispose();
    const materials = Array.isArray(object.material) ? object.material : [object.material];
    for (const material of materials) {
      if (!material) continue;
      for (const value of Object.values(material)) {
        if (value instanceof THREE.Texture) textures.add(value);
      }
      material.dispose();
    }
  });
  for (const texture of textures) texture.dispose();
}

function encodeThumbnail(canvas: HTMLCanvasElement): string {
  try {
    return canvas.toDataURL('image/webp', 0.82);
  } catch {
    return canvas.toDataURL('image/jpeg', 0.85);
  }
}

function rememberResolved(url: string, dataUrl: string): void {
  if (!dataUrl) return;
  if (resolved.has(url)) resolved.delete(url);
  resolved.set(url, dataUrl);
  while (resolved.size > MAX_CACHED_THUMBS) {
    const oldest = resolved.keys().next().value;
    if (oldest === undefined) break;
    resolved.delete(oldest);
  }
}

async function renderThumbnail(url: string): Promise<string> {
  const { renderer, scene, camera, stage } = ensureShared();
  const gltf = await gltfLoader.loadAsync(url);
  const model = gltf.scene;
  stage.add(model);
  try {
    const box = new THREE.Box3().setFromObject(model);
    if (box.isEmpty()) return '';
    const center = box.getCenter(new THREE.Vector3());
    const radius = Math.max(0.001, box.getSize(new THREE.Vector3()).length() / 2);
    camera.position
      .copy(center)
      .add(new THREE.Vector3(1, 0.72, 1).normalize().multiplyScalar(radius * 2.4));
    camera.lookAt(center);
    camera.near = radius / 100;
    camera.far = radius * 20;
    camera.updateProjectionMatrix();
    renderer.render(scene, camera);
    return encodeThumbnail(renderer.domElement);
  } finally {
    stage.remove(model);
    disposeObjectTree(model);
  }
}

function enqueueThumbnailRender(url: string): Promise<string> {
  const pending = queue.then(() => renderThumbnail(url));
  queue = pending.then(
    () => undefined,
    () => undefined,
  );
  return pending;
}

async function loadThumbnail(url: string, persistentKey: string | null): Promise<string> {
  if (persistentKey) {
    const stored = await getCachedModelThumbnail(persistentKey);
    if (stored) return stored;
  }

  const dataUrl = await enqueueThumbnailRender(url);
  if (persistentKey && dataUrl) {
    await putCachedModelThumbnail(persistentKey, dataUrl);
  }
  return dataUrl;
}

/**
 * Returns a data-url thumbnail for a GLB/GLTF asset.
 * Versioned editor assets use an IndexedDB-backed cache; unversioned runtime
 * callers retain the existing in-memory behavior.
 */
export function getModelThumbnail(url: string, assetVersion?: string): Promise<string> {
  const memoryKey = assetVersion ? `${url}\u0000${assetVersion}` : url;
  const persistentKey = assetVersion
    ? `${PERSISTENT_CACHE_EPOCH}:${memoryKey}`
    : null;
  const cached = resolved.get(memoryKey);
  if (cached !== undefined) {
    resolved.delete(memoryKey);
    resolved.set(memoryKey, cached);
    return Promise.resolve(cached);
  }

  let pending = inflight.get(memoryKey);
  if (!pending) {
    pending = loadThumbnail(url, persistentKey)
      .catch((error) => {
        console.warn(`Thumbnail failed for ${url}`, error);
        return '';
      })
      .then((dataUrl) => {
        inflight.delete(memoryKey);
        rememberResolved(memoryKey, dataUrl);
        return dataUrl;
      });
    inflight.set(memoryKey, pending);
  }
  return pending;
}
