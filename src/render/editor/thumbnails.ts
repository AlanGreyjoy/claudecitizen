import * as THREE from 'three';
import { loadPrefabModel } from '../prefabs/prefab_renderer';

/**
 * Lazy model thumbnails for the asset browser: one shared offscreen renderer,
 * one model rendered at a time, results cached per url for the session.
 */

const THUMB_SIZE = 96;

const cache = new Map<string, Promise<string>>();

let shared: {
  renderer: THREE.WebGLRenderer;
  scene: THREE.Scene;
  camera: THREE.PerspectiveCamera;
  stage: THREE.Group;
} | null = null;

function ensureShared() {
  if (shared) return shared;
  const canvas = document.createElement('canvas');
  canvas.width = THUMB_SIZE;
  canvas.height = THUMB_SIZE;
  const renderer = new THREE.WebGLRenderer({ canvas, antialias: true, alpha: true });
  renderer.setSize(THUMB_SIZE, THUMB_SIZE, false);
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

let queue: Promise<unknown> = Promise.resolve();

async function renderThumbnail(url: string): Promise<string> {
  const { renderer, scene, camera, stage } = ensureShared();
  const model = await loadPrefabModel(url);
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
    return renderer.domElement.toDataURL('image/png');
  } finally {
    stage.remove(model);
  }
}

/** Returns a data-url thumbnail for a GLB/GLTF asset (serialized, cached). */
export function getModelThumbnail(url: string): Promise<string> {
  let pending = cache.get(url);
  if (!pending) {
    pending = queue.then(() =>
      renderThumbnail(url).catch((error) => {
        console.warn(`Thumbnail failed for ${url}`, error);
        return '';
      }),
    );
    queue = pending;
    cache.set(url, pending);
  }
  return pending;
}
