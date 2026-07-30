import * as THREE from 'three';
import { WebGPURenderer } from 'three/webgpu';
import { GLTFLoader } from 'three/examples/jsm/loaders/GLTFLoader';
import { attachKtx2Loader, setKtx2SupportRenderer } from '../assets/ktx2';
import {
  getCachedModelThumbnail,
  putCachedModelThumbnail,
} from '../../editor/model-thumbnail-cache';
import { disposeCacheTemplate } from '../assets/gpu-dispose';
import { initRequiredWebGpu } from '../webgpu-required';
import { captureWebGpuThumbnailDataUrl } from '../webgpu-capture';

/**
 * Lazy model thumbnails for the asset browser / inventory icons.
 * One shared offscreen renderer, one model at a time, ephemeral GLB loads
 * (never touches the prefab modelCache), LRU-cached data-URLs.
 */

const THUMB_SIZE = 96;
const MAX_CACHED_THUMBS = 96;
const CLEAR_COLOR = 0x12161c;
const PERSISTENT_CACHE_EPOCH = 'model-thumbnail-v2-webgpu';

const gltfLoader = attachKtx2Loader(new GLTFLoader());
/** Resolved thumbnail data-URLs (insertion order = LRU). */
const resolved = new Map<string, string>();
/** In-flight renders keyed by url. */
const inflight = new Map<string, Promise<string>>();

interface SharedThumbnailRenderer {
  renderer: WebGPURenderer;
  scene: THREE.Scene;
  camera: THREE.PerspectiveCamera;
  stage: THREE.Group;
}

let sharedPromise: Promise<SharedThumbnailRenderer> | null = null;

let queue: Promise<unknown> = Promise.resolve();

async function createShared(): Promise<SharedThumbnailRenderer> {
  const canvas = document.createElement('canvas');
  canvas.width = THUMB_SIZE;
  canvas.height = THUMB_SIZE;
  const renderer = new WebGPURenderer({
    canvas,
    antialias: true,
    alpha: false,
  });
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

  let rendererInitialized = false;
  try {
    await initRequiredWebGpu(renderer);
    rendererInitialized = true;
    // The asset browser can render thumbnails before the play renderer exists,
    // so this offscreen renderer doubles as the KTX2 format probe.
    setKtx2SupportRenderer(renderer);
    return { renderer, scene, camera, stage };
  } catch (error) {
    if (rendererInitialized) renderer.dispose();
    throw error;
  }
}

function ensureShared(): Promise<SharedThumbnailRenderer> {
  if (sharedPromise) return sharedPromise;
  const pending = createShared();
  sharedPromise = pending;
  void pending.catch(() => {
    if (sharedPromise === pending) sharedPromise = null;
  });
  return pending;
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
  const { renderer, scene, camera, stage } = await ensureShared();
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
    return await captureWebGpuThumbnailDataUrl(
      renderer,
      scene,
      camera,
      THUMB_SIZE,
      THUMB_SIZE,
    );
  } finally {
    stage.remove(model);
    disposeCacheTemplate(model);
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
