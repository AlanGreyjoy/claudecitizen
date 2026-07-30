import * as THREE from 'three';
import { PMREMGenerator, WebGPURenderer } from 'three/webgpu';
import { RoomEnvironment } from 'three/examples/jsm/environments/RoomEnvironment.js';
import { setKtx2SupportRenderer } from '../../render/assets/ktx2';
import { loadPrefabModel } from '../../render/prefabs/prefab-renderer';
import { initRequiredWebGpu } from '../../render/webgpu-required';
import type { MaterialValues } from './material-manager';

export type MaterialPreviewShape =
  | 'sphere'
  | 'cube'
  | 'cylinder'
  | 'plane'
  | 'knot';

export type MaterialPreviewBackdrop = 'checker' | 'studio' | 'dark';

export type MaterialPreviewHandle = {
  /**
   * The asset's own material. Cloned so authored maps (base colour, normal,
   * roughness…) render — a flat untextured ball is why the old preview told you
   * nothing about what you were editing.
   */
  setSource: (material: THREE.Material | null) => void;
  setValues: (values: MaterialValues) => void;
  setShape: (shape: MaterialPreviewShape) => void;
  /**
   * Swaps the primitive for a dropped GLB, Unreal's preview-mesh slot. `null`
   * returns to the current built-in shape. Rejects if the model fails to load.
   */
  setCustomMesh: (url: string | null) => Promise<void>;
  setBackdrop: (backdrop: MaterialPreviewBackdrop) => void;
  setSpin: (spinning: boolean) => void;
  dispose: () => void;
};

const MIN_DISTANCE = 2.1;
const MAX_DISTANCE = 7;

function createCheckerTexture(): THREE.CanvasTexture {
  const size = 128;
  const cells = 8;
  const cell = size / cells;
  const canvas = document.createElement('canvas');
  canvas.width = size;
  canvas.height = size;
  const ctx = canvas.getContext('2d');
  if (ctx) {
    for (let y = 0; y < cells; y += 1) {
      for (let x = 0; x < cells; x += 1) {
        ctx.fillStyle = (x + y) % 2 === 0 ? '#2a3340' : '#1c2330';
        ctx.fillRect(x * cell, y * cell, cell, cell);
      }
    }
  }
  const texture = new THREE.CanvasTexture(canvas);
  texture.colorSpace = THREE.SRGBColorSpace;
  texture.wrapS = THREE.RepeatWrapping;
  texture.wrapT = THREE.RepeatWrapping;
  texture.magFilter = THREE.NearestFilter;
  texture.minFilter = THREE.NearestFilter;
  texture.repeat.set(4, 4);
  return texture;
}

function createStudioTexture(): THREE.CanvasTexture {
  const canvas = document.createElement('canvas');
  canvas.width = 4;
  canvas.height = 128;
  const ctx = canvas.getContext('2d');
  if (ctx) {
    const gradient = ctx.createLinearGradient(0, 0, 0, 128);
    gradient.addColorStop(0, '#31404f');
    gradient.addColorStop(0.55, '#1b232c');
    gradient.addColorStop(1, '#0d1218');
    ctx.fillStyle = gradient;
    ctx.fillRect(0, 0, 4, 128);
  }
  const texture = new THREE.CanvasTexture(canvas);
  texture.colorSpace = THREE.SRGBColorSpace;
  return texture;
}

function buildGeometry(shape: MaterialPreviewShape): THREE.BufferGeometry {
  if (shape === 'cube') return new THREE.BoxGeometry(1.5, 1.5, 1.5);
  if (shape === 'cylinder') return new THREE.CylinderGeometry(0.85, 0.85, 1.8, 64, 1);
  if (shape === 'plane') return new THREE.PlaneGeometry(2.1, 2.1, 1, 1);
  if (shape === 'knot') return new THREE.TorusKnotGeometry(0.72, 0.26, 190, 32);
  return new THREE.SphereGeometry(1, 64, 48);
}

/**
 * Copies the asset material for display. `clone()` keeps every texture map by
 * reference (three does not dispose shared textures on material.dispose), so
 * the preview is the real shading model, not an approximation.
 */
function cloneForPreview(
  source: THREE.Material | null,
  shape: MaterialPreviewShape,
): THREE.MeshStandardMaterial {
  const clone =
    source instanceof THREE.MeshStandardMaterial
      ? source.clone()
      : new THREE.MeshStandardMaterial({ color: '#ffffff', roughness: 0.55 });
  // Preview geometry carries a single UV set; a second-channel AO/light map
  // would sample a missing attribute and render black.
  if (clone.aoMap && clone.aoMap.channel !== 0) clone.aoMap = null;
  clone.lightMap = null;
  clone.envMapIntensity = 1;
  clone.side = shape === 'plane' ? THREE.DoubleSide : THREE.FrontSide;
  clone.needsUpdate = true;
  return clone;
}

/**
 * Fits a dropped model into the same volume the built-in shapes occupy, so the
 * camera framing and lighting rig stay meaningful whatever gets dropped.
 */
function frameCustomModel(model: THREE.Object3D): void {
  model.position.set(0, 0, 0);
  model.scale.setScalar(1);
  model.updateMatrixWorld(true);
  const box = new THREE.Box3().setFromObject(model);
  if (box.isEmpty()) return;
  const size = box.getSize(new THREE.Vector3());
  const center = box.getCenter(new THREE.Vector3());
  const scale = 2.1 / (Math.max(size.x, size.y, size.z) || 1);
  model.scale.setScalar(scale);
  model.position.copy(center.multiplyScalar(-scale));
}

function paintObject(root: THREE.Object3D, material: THREE.Material): void {
  root.traverse((object) => {
    if (!(object instanceof THREE.Mesh)) return;
    object.material = Array.isArray(object.material)
      ? object.material.map(() => material)
      : material;
  });
}

function applyValues(
  material: THREE.MeshStandardMaterial,
  values: MaterialValues,
): void {
  material.color.set(values.color);
  material.emissive.set(values.emissive);
  material.emissiveIntensity = values.emissiveIntensity;
  material.metalness = values.metalness;
  material.roughness = values.roughness;
  material.opacity = values.opacity;
  material.transparent = values.opacity < 0.999;
  material.depthWrite = values.opacity >= 0.999;
  material.needsUpdate = true;
}

function createStage(renderer: WebGPURenderer): {
  scene: THREE.Scene;
  ground: THREE.Mesh;
  initializeEnvironment: () => void;
  dispose: () => void;
} {
  const scene = new THREE.Scene();
  let environmentTarget: ReturnType<PMREMGenerator['fromScene']> | null = null;

  // The image-based light does the shading; the directionals only add a
  // specular hit and a cool rim. Anything stronger blows a white base colour
  // to a featureless disc under ACES.
  scene.add(new THREE.HemisphereLight(0xcfe0ff, 0x20293a, 0.28));
  const key = new THREE.DirectionalLight(0xfff4e6, 1.1);
  key.position.set(2.6, 3.4, 2.6);
  const rim = new THREE.DirectionalLight(0x88bcff, 0.5);
  rim.position.set(-2.8, 1.4, -2.6);
  scene.add(key, rim);

  const groundMaterial = new THREE.MeshStandardMaterial({
    color: 0x0d1218,
    metalness: 0.02,
    roughness: 0.85,
    envMapIntensity: 0.3,
    transparent: true,
    opacity: 0.9,
  });
  const ground = new THREE.Mesh(new THREE.CircleGeometry(2.6, 64), groundMaterial);
  ground.rotation.x = -Math.PI / 2;
  ground.position.y = -1.32;
  ground.visible = false;
  scene.add(ground);

  return {
    scene,
    ground,
    initializeEnvironment() {
      if (environmentTarget) return;
      const environmentScene = new RoomEnvironment();
      const pmrem = new PMREMGenerator(renderer);
      try {
        environmentTarget = pmrem.fromScene(environmentScene, 0.04);
        scene.environment = environmentTarget.texture;
      } finally {
        environmentScene.dispose();
        pmrem.dispose();
      }
    },
    dispose() {
      ground.geometry.dispose();
      groundMaterial.dispose();
      environmentTarget?.dispose();
      environmentTarget = null;
    },
  };
}

/**
 * Unreal-style material stage: IBL room env, tone mapping, swappable preview
 * mesh and backdrop, drag to tumble, wheel to dolly, optional idle spin.
 */
export function createMaterialPreview(host: HTMLElement): MaterialPreviewHandle {
  const renderer = new WebGPURenderer({ antialias: true, alpha: false });
  renderer.setPixelRatio(Math.min(window.devicePixelRatio, 2));
  renderer.outputColorSpace = THREE.SRGBColorSpace;
  renderer.toneMapping = THREE.ACESFilmicToneMapping;
  renderer.toneMappingExposure = 0.95;

  const canvas = renderer.domElement;
  canvas.className = 'ed-material-inspector-canvas';
  host.replaceChildren(canvas);

  let disposed = false;
  let backendReady = false;
  let backendFailed = false;
  let rendererInitialized = false;
  let rendererDisposed = false;
  const disposeRenderer = (): void => {
    // Three's pre-init dispose path calls setAnimationLoop(), which starts
    // init() itself. If explicit initialization failed there are no live
    // renderer services to release; if it is pending, the ready handler below
    // will dispose after success.
    if (!rendererInitialized || rendererDisposed) return;
    rendererDisposed = true;
    renderer.dispose();
  };

  const stage = createStage(renderer);
  const { scene } = stage;
  // WebGPU initialization is asynchronous, and KTX2 capability detection plus
  // the PMREM bake both require a live backend. Keep the public factory
  // synchronous, but do not render or load a dropped model until this settles.
  const ready = initRequiredWebGpu(renderer).then(() => {
    rendererInitialized = true;
    if (disposed) {
      disposeRenderer();
      return;
    }
    setKtx2SupportRenderer(renderer);
    stage.initializeEnvironment();
    backendReady = true;
  });
  void ready.catch((error: unknown) => {
    backendFailed = true;
    disposeRenderer();
    if (!disposed) {
      console.error('[material-preview] WebGPU unavailable — preview disabled.', error);
    }
  });

  const checker = createCheckerTexture();
  const studio = createStudioTexture();
  scene.background = checker;

  const camera = new THREE.PerspectiveCamera(34, 1, 0.1, 60);
  let distance = 3.5;
  const orbit = new THREE.Spherical(distance, Math.PI / 2 - 0.18, 0.62);

  let shape: MaterialPreviewShape = 'sphere';
  let source: THREE.Material | null = null;
  let values: MaterialValues | null = null;
  let material = cloneForPreview(null, shape);
  const geometries = new Map<MaterialPreviewShape, THREE.BufferGeometry>();

  function geometryFor(next: MaterialPreviewShape): THREE.BufferGeometry {
    let geometry = geometries.get(next);
    if (!geometry) {
      geometry = buildGeometry(next);
      geometries.set(next, geometry);
    }
    return geometry;
  }

  const mesh = new THREE.Mesh(geometryFor(shape), material);
  scene.add(mesh);

  function syncCamera(): void {
    orbit.radius = distance;
    camera.position.setFromSpherical(orbit);
    camera.lookAt(0, 0, 0);
  }
  syncCamera();

  let customRoot: THREE.Object3D | null = null;
  let customToken = 0;

  function rebuildMaterial(): void {
    const next = cloneForPreview(source, shape);
    if (values) applyValues(next, values);
    mesh.material = next;
    if (customRoot) paintObject(customRoot, next);
    material.dispose();
    material = next;
  }

  /**
   * Dropped models come from `loadPrefabModel`, whose clones share geometry and
   * materials with the cache template — detach only, never dispose.
   */
  function clearCustomMesh(): void {
    if (!customRoot) return;
    scene.remove(customRoot);
    customRoot = null;
    mesh.visible = true;
  }

  let spinning = true;
  let dragging = false;
  let lastX = 0;
  let lastY = 0;
  let lastTs = 0;
  let raf = 0;

  const onPointerDown = (event: PointerEvent): void => {
    dragging = true;
    lastX = event.clientX;
    lastY = event.clientY;
    canvas.setPointerCapture(event.pointerId);
  };
  const onPointerMove = (event: PointerEvent): void => {
    if (!dragging) return;
    orbit.theta -= (event.clientX - lastX) * 0.01;
    orbit.phi = Math.min(
      Math.PI - 0.12,
      Math.max(0.12, orbit.phi - (event.clientY - lastY) * 0.01),
    );
    lastX = event.clientX;
    lastY = event.clientY;
    syncCamera();
  };
  const onPointerUp = (event: PointerEvent): void => {
    dragging = false;
    if (canvas.hasPointerCapture(event.pointerId)) {
      canvas.releasePointerCapture(event.pointerId);
    }
  };
  const onWheel = (event: WheelEvent): void => {
    event.preventDefault();
    distance = Math.min(
      MAX_DISTANCE,
      Math.max(MIN_DISTANCE, distance + event.deltaY * 0.0022),
    );
    syncCamera();
  };

  canvas.addEventListener('pointerdown', onPointerDown);
  canvas.addEventListener('pointermove', onPointerMove);
  canvas.addEventListener('pointerup', onPointerUp);
  canvas.addEventListener('pointercancel', onPointerUp);
  canvas.addEventListener('lostpointercapture', onPointerUp);
  canvas.addEventListener('wheel', onWheel, { passive: false });

  const resize = (): void => {
    const width = Math.max(1, Math.round(host.clientWidth));
    const height = Math.max(1, Math.round(host.clientHeight));
    renderer.setSize(width, height, false);
    camera.aspect = width / height;
    camera.updateProjectionMatrix();
    const scale = Math.max(1, width / 220);
    checker.repeat.set(4 * scale, 4);
  };
  const resizeObserver = new ResizeObserver(resize);
  resizeObserver.observe(host);
  resize();

  const frame = (ts: number): void => {
    if (disposed || backendFailed) return;
    raf = requestAnimationFrame(frame);
    if (!backendReady) return;
    const dt = lastTs === 0 ? 0 : Math.min(0.05, (ts - lastTs) / 1000);
    lastTs = ts;
    // A spinning plane just goes edge-on and vanishes — it exists to be read
    // flat, so it stays put.
    if (spinning && !dragging && (customRoot || shape !== 'plane')) {
      const spun = customRoot ?? mesh;
      spun.rotation.y += dt * 0.4;
    }
    renderer.render(scene, camera);
  };
  raf = requestAnimationFrame(frame);

  return {
    setSource(next) {
      if (disposed || next === source) return;
      source = next;
      rebuildMaterial();
    },
    setValues(next) {
      if (disposed) return;
      values = next;
      applyValues(material, next);
    },
    async setCustomMesh(url) {
      if (disposed) return;
      const token = ++customToken;
      clearCustomMesh();
      if (!url) return;
      await ready;
      if (disposed || token !== customToken) return;
      const model = await loadPrefabModel(url, { pin: true });
      if (disposed || token !== customToken) return;
      const wrapper = new THREE.Group();
      frameCustomModel(model);
      wrapper.add(model);
      paintObject(wrapper, material);
      scene.add(wrapper);
      customRoot = wrapper;
      mesh.visible = false;
      orbit.phi = Math.PI / 2 - 0.18;
      orbit.theta = 0.62;
      syncCamera();
    },
    setShape(next) {
      if (disposed) return;
      clearCustomMesh();
      customToken += 1;
      if (next === shape) return;
      shape = next;
      mesh.geometry = geometryFor(next);
      mesh.rotation.set(0, next === 'plane' ? 0 : mesh.rotation.y, 0);
      // Flat sheets read best head-on; solids want the three-quarter view.
      orbit.phi = next === 'plane' ? Math.PI / 2 : Math.PI / 2 - 0.18;
      orbit.theta = next === 'plane' ? 0 : 0.62;
      syncCamera();
      rebuildMaterial();
    },
    setBackdrop(next) {
      if (disposed) return;
      scene.background = next === 'studio' ? studio : next === 'dark' ? null : checker;
      renderer.setClearColor(0x0b0f14, 1);
      stage.ground.visible = next === 'studio';
    },
    setSpin(next) {
      if (disposed) return;
      spinning = next;
    },
    dispose() {
      if (disposed) return;
      disposed = true;
      cancelAnimationFrame(raf);
      clearCustomMesh();
      resizeObserver.disconnect();
      canvas.removeEventListener('pointerdown', onPointerDown);
      canvas.removeEventListener('pointermove', onPointerMove);
      canvas.removeEventListener('pointerup', onPointerUp);
      canvas.removeEventListener('pointercancel', onPointerUp);
      canvas.removeEventListener('lostpointercapture', onPointerUp);
      canvas.removeEventListener('wheel', onWheel);
      material.dispose();
      for (const geometry of geometries.values()) geometry.dispose();
      geometries.clear();
      checker.dispose();
      studio.dispose();
      stage.dispose();
      disposeRenderer();
      host.replaceChildren();
    },
  };
}
