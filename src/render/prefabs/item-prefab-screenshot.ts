import * as THREE from 'three';
import { loadPrefabDocument } from '../../world/prefabs/loader';
import { createPropInstanceGroupAsync } from './prefab_renderer';

/** Square PNG capture size for admin item icons. */
const SCREENSHOT_SIZE = 512;

/**
 * Classic isometric camera direction: equal X/Z yaw, ~35.264° elevation
 * (atan(1/√2)) so the projected axes stay orthographic-isometric.
 */
const ISOMETRIC_DIRECTION = new THREE.Vector3(1, 1, 1).normalize();

/** Extra margin so the subject never kisses the frame edge. */
const FRAME_PADDING = 1.28;

function visibleBounds(root: THREE.Object3D): THREE.Box3 {
  const bounds = new THREE.Box3().makeEmpty();
  root.updateMatrixWorld(true);
  root.traverse((object) => {
    if (!(object instanceof THREE.Mesh) || !object.visible) return;
    if (!object.geometry.boundingBox) object.geometry.computeBoundingBox();
    if (object.geometry.boundingBox) {
      bounds.union(object.geometry.boundingBox.clone().applyMatrix4(object.matrixWorld));
    }
  });
  return bounds.isEmpty() ? new THREE.Box3().setFromObject(root) : bounds;
}

/**
 * Fit an orthographic camera so the subject's AABB projects fully inside the
 * square view with padding, from a fixed isometric look direction.
 */
function frameIsometricCamera(
  camera: THREE.OrthographicCamera,
  subject: THREE.Object3D,
): void {
  const box = visibleBounds(subject);
  if (box.isEmpty()) {
    throw new Error('Item prefab has no visible geometry to capture.');
  }

  const center = box.getCenter(new THREE.Vector3());
  const size = box.getSize(new THREE.Vector3());
  const radius = Math.max(0.001, size.length() / 2);

  // Distance only needs to clear near/far; ortho frustum owns framing.
  camera.position.copy(center).add(ISOMETRIC_DIRECTION.clone().multiplyScalar(radius * 4));
  camera.up.set(0, 1, 0);
  camera.lookAt(center);
  camera.updateMatrixWorld(true);

  // Project AABB corners into camera space and size the ortho frustum to fit.
  const corners = [
    new THREE.Vector3(box.min.x, box.min.y, box.min.z),
    new THREE.Vector3(box.min.x, box.min.y, box.max.z),
    new THREE.Vector3(box.min.x, box.max.y, box.min.z),
    new THREE.Vector3(box.min.x, box.max.y, box.max.z),
    new THREE.Vector3(box.max.x, box.min.y, box.min.z),
    new THREE.Vector3(box.max.x, box.min.y, box.max.z),
    new THREE.Vector3(box.max.x, box.max.y, box.min.z),
    new THREE.Vector3(box.max.x, box.max.y, box.max.z),
  ];

  let minX = Infinity;
  let maxX = -Infinity;
  let minY = Infinity;
  let maxY = -Infinity;
  let minZ = Infinity;
  let maxZ = -Infinity;
  const viewMatrix = camera.matrixWorldInverse;
  const scratch = new THREE.Vector3();
  for (const corner of corners) {
    scratch.copy(corner).applyMatrix4(viewMatrix);
    minX = Math.min(minX, scratch.x);
    maxX = Math.max(maxX, scratch.x);
    minY = Math.min(minY, scratch.y);
    maxY = Math.max(maxY, scratch.y);
    minZ = Math.min(minZ, scratch.z);
    maxZ = Math.max(maxZ, scratch.z);
  }

  const midX = (minX + maxX) * 0.5;
  const midY = (minY + maxY) * 0.5;
  const halfWidth = Math.max((maxX - minX) * 0.5, 0.001) * FRAME_PADDING;
  const halfHeight = Math.max((maxY - minY) * 0.5, 0.001) * FRAME_PADDING;
  const halfExtent = Math.max(halfWidth, halfHeight);

  // View space looks down -Z; convert to positive near/far distances.
  const closest = -maxZ;
  const farthest = -minZ;
  camera.left = midX - halfExtent;
  camera.right = midX + halfExtent;
  camera.top = midY + halfExtent;
  camera.bottom = midY - halfExtent;
  camera.near = Math.max(0.01, closest - halfExtent);
  camera.far = Math.max(camera.near + 0.01, farthest + halfExtent);
  camera.updateProjectionMatrix();
}

/**
 * Loads an item prefab, renders it in an isometric view, and returns a PNG
 * data URL with a transparent background suitable for `iconUrl`.
 */
export async function generateItemPrefabScreenshot(prefabId: string): Promise<string> {
  const trimmed = prefabId.trim();
  if (!trimmed) {
    throw new Error('Select an item prefab before generating a screenshot.');
  }

  const doc = await loadPrefabDocument(trimmed);
  if (!doc) {
    throw new Error(`Item prefab "${trimmed}" could not be loaded.`);
  }
  if (doc.kind !== 'item') {
    throw new Error(`Prefab "${trimmed}" is kind "${doc.kind}", not an item prefab.`);
  }

  const canvas = document.createElement('canvas');
  canvas.width = SCREENSHOT_SIZE;
  canvas.height = SCREENSHOT_SIZE;

  const renderer = new THREE.WebGLRenderer({
    canvas,
    antialias: true,
    alpha: true,
    preserveDrawingBuffer: true,
  });
  renderer.setSize(SCREENSHOT_SIZE, SCREENSHOT_SIZE, false);
  renderer.setClearColor(0x000000, 0);
  renderer.outputColorSpace = THREE.SRGBColorSpace;
  renderer.toneMapping = THREE.ACESFilmicToneMapping;
  renderer.toneMappingExposure = 1.05;

  const scene = new THREE.Scene();
  scene.background = null;
  scene.add(new THREE.HemisphereLight(0xdde8ff, 0x202836, 1.35));
  const key = new THREE.DirectionalLight(0xffffff, 2.2);
  key.position.copy(ISOMETRIC_DIRECTION).multiplyScalar(5).add(new THREE.Vector3(1.5, 2, 0.5));
  scene.add(key);
  const fill = new THREE.DirectionalLight(0xb8d4ff, 0.55);
  fill.position.set(-2.4, 1.6, -3.2);
  scene.add(fill);

  const camera = new THREE.OrthographicCamera(-1, 1, 1, -1, 0.01, 2000);
  let model: THREE.Group | null = null;

  try {
    model = await createPropInstanceGroupAsync(doc);
    scene.add(model);
    frameIsometricCamera(camera, model);
    renderer.render(scene, camera);
    return canvas.toDataURL('image/png');
  } finally {
    if (model) {
      scene.remove(model);
      // Prefab GLBs share geometry/materials via the model cache — do not dispose them.
    }
    renderer.dispose();
  }
}
