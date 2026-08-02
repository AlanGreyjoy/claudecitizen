/**
 * Browser half of the weapon icon baker. Bundled by bake_weapon_icons.mjs and
 * inlined into a page that Electron runs; the Node half calls
 * `WeaponIcons.render(...)` once per weapon.
 *
 * Renders one GLB to a transparent square PNG framed like the hand-made
 * asteron-rifle icon: three-quarter view, weapon filling the frame, no ground
 * plane. Supersampled 2x and downscaled so low-poly silhouettes stay clean.
 */
import * as THREE from 'three';
import { GLTFLoader } from 'three/examples/jsm/loaders/GLTFLoader.js';

const OUTPUT_SIZE = 512;
const SUPERSAMPLE = 2;
/** Fraction of the frame the weapon's bounding sphere should occupy. */
const FILL = 0.9;

const loader = new GLTFLoader();
let renderer = null;

function getRenderer() {
  if (renderer) return renderer;
  const canvas = document.createElement('canvas');
  canvas.width = OUTPUT_SIZE * SUPERSAMPLE;
  canvas.height = OUTPUT_SIZE * SUPERSAMPLE;
  renderer = new THREE.WebGLRenderer({
    alpha: true,
    antialias: true,
    canvas,
    preserveDrawingBuffer: true,
  });
  renderer.setClearAlpha(0);
  renderer.outputColorSpace = THREE.SRGBColorSpace;
  renderer.toneMapping = THREE.NoToneMapping;
  return renderer;
}

function buildLighting(scene) {
  scene.add(new THREE.HemisphereLight(0xdfe9ff, 0x2b2f38, 2.1));
  const key = new THREE.DirectionalLight(0xffffff, 2.6);
  key.position.set(2.4, 3.2, 2.8);
  scene.add(key);
  const fill = new THREE.DirectionalLight(0xa8c4ff, 1.1);
  fill.position.set(-3, 0.6, -1.4);
  scene.add(fill);
  const rim = new THREE.DirectionalLight(0xffffff, 1.4);
  rim.position.set(-1.2, 2.2, -3);
  scene.add(rim);
}

function base64ToArrayBuffer(base64) {
  const binary = atob(base64);
  const bytes = new Uint8Array(binary.length);
  for (let i = 0; i < binary.length; i += 1) bytes[i] = binary.charCodeAt(i);
  return bytes.buffer;
}

/**
 * Melee models run their blade up +Y, which wastes most of a square frame.
 * Tipping them onto a diagonal uses the same pixels the long guns do.
 */
function presentationFor(melee) {
  return melee
    ? { modelRotationZ: -Math.PI * 0.22, cameraDirection: [0.35, 0.22, 1] }
    : { modelRotationZ: 0, cameraDirection: [0.9, 0.5, 0.8] };
}

export async function render({ base64, melee }) {
  const gltf = await loader.parseAsync(base64ToArrayBuffer(base64), '');
  const scene = new THREE.Scene();
  buildLighting(scene);

  const { modelRotationZ, cameraDirection } = presentationFor(melee);
  const pivot = new THREE.Group();
  pivot.add(gltf.scene);
  pivot.rotation.z = modelRotationZ;
  scene.add(pivot);
  pivot.updateWorldMatrix(true, true);

  // Recentre on the model's own bounds: Synty origins sit at the grip, not the
  // centre of mass, so centring on the origin would push the blade off-frame.
  const box = new THREE.Box3().setFromObject(pivot);
  const sphere = box.getBoundingSphere(new THREE.Sphere());
  pivot.position.sub(sphere.center);

  const camera = new THREE.PerspectiveCamera(30, 1, 0.01, 100);
  const distance = (sphere.radius / FILL) / Math.tan((camera.fov * Math.PI) / 360);
  const direction = new THREE.Vector3(...cameraDirection).normalize();
  camera.position.copy(direction.multiplyScalar(distance));
  camera.lookAt(0, 0, 0);

  const active = getRenderer();
  active.render(scene, camera);

  // Downscale the supersampled buffer to the shipped icon size.
  const target = document.createElement('canvas');
  target.width = OUTPUT_SIZE;
  target.height = OUTPUT_SIZE;
  const context = target.getContext('2d');
  context.imageSmoothingQuality = 'high';
  context.drawImage(active.domElement, 0, 0, OUTPUT_SIZE, OUTPUT_SIZE);
  const dataUrl = target.toDataURL('image/png');

  scene.remove(pivot);
  gltf.scene.traverse((object) => {
    if (!object.isMesh) return;
    object.geometry?.dispose();
    for (const material of [object.material].flat()) {
      for (const key of Object.keys(material)) {
        if (material[key]?.isTexture) material[key].dispose();
      }
      material.dispose();
    }
  });

  return { ok: true, dataUrl, radius: sphere.radius };
}
