import * as THREE from 'three';
import { PMREMGenerator, WebGPURenderer } from 'three/webgpu';
import { OrbitControls } from 'three/examples/jsm/controls/OrbitControls';
import { TransformControls } from 'three/examples/jsm/controls/TransformControls';
import { RoomEnvironment } from 'three/examples/jsm/environments/RoomEnvironment.js';
import { setKtx2SupportRenderer } from '../assets/ktx2';
import { ensureNodeRectAreaLights } from '../node-lights';
import { initRequiredWebGpu } from '../webgpu-required';

export interface BaseCharacterStageDom {
  stage: HTMLDivElement;
  canvas: HTMLCanvasElement;
  playTestHud: HTMLDivElement;
  playTestHudState: HTMLDivElement;
  playTestHudLoadout: HTMLDivElement;
  stageStatus: HTMLDivElement;
  guideReadout: HTMLDivElement;
  playTestReticle: HTMLDivElement;
  packMissingBanner: HTMLDivElement;
}

export interface BaseCharacterStageThree {
  renderer: WebGPURenderer;
  ready: Promise<void>;
  scene: THREE.Scene;
  camera: THREE.PerspectiveCamera;
  controls: OrbitControls;
  gizmo: TransformControls;
  previewRoot: THREE.Group;
  resize: () => void;
  updateAuthoringClipPlanes: () => void;
  clock: THREE.Clock;
  dispose: () => void;
}

export function createBaseCharacterStageDom(stageHost: HTMLElement): BaseCharacterStageDom {
  stageHost.replaceChildren();
  const stage = document.createElement('div');
  stage.className = 'ed-base-stage';
  const canvas = document.createElement('canvas');
  canvas.tabIndex = 0;
  canvas.setAttribute('aria-label', 'Base Character preview stage');
  const playTestHud = document.createElement('div');
  playTestHud.className = 'ed-base-playtest-hud';
  playTestHud.hidden = true;
  const playTestHudTitle = document.createElement('div');
  playTestHudTitle.className = 'ed-base-playtest-title';
  playTestHudTitle.textContent = 'Character Play Test';
  const playTestHudState = document.createElement('div');
  playTestHudState.className = 'ed-base-playtest-state';
  const playTestHudLoadout = document.createElement('div');
  playTestHudLoadout.className = 'ed-base-playtest-loadout';
  const playTestHudHelp = document.createElement('div');
  playTestHudHelp.className = 'ed-base-playtest-help';
  playTestHudHelp.textContent =
    'Click stage to look · WASD move · Shift sprint · CapsLock walk · C crouch · Space jump · RMB aim · LMB fire anim · wheel zoom · 1-3 weapons · Esc stop';
  playTestHud.append(
    playTestHudTitle,
    playTestHudState,
    playTestHudLoadout,
    playTestHudHelp,
  );
  const stageStatus = document.createElement('div');
  stageStatus.className = 'ed-base-stage-status';
  const guideReadout = document.createElement('div');
  guideReadout.className = 'ed-base-guide-readout';
  guideReadout.hidden = true;
  // Mirrors the gameplay HUD reticle: screen centre, shown only while aiming.
  const playTestReticle = document.createElement('div');
  playTestReticle.className = 'ed-base-playtest-reticle';
  playTestReticle.hidden = true;
  const packMissingBanner = document.createElement('div');
  packMissingBanner.className = 'ed-base-pack-missing is-hidden';
  packMissingBanner.setAttribute('role', 'status');
  packMissingBanner.innerHTML =
    '<strong>Synty Sidekick pack missing</strong>'
    + '<span>Export from Unity (<code>ClaudeCitizen → Export Synty Sidekick…</code>), '
    + 'then use <code>Tools → Locate Synty Sidekick Pack…</code> '
    + 'or set the folder in Project Settings.</span>';
  stage.append(canvas, playTestHud, stageStatus, guideReadout, playTestReticle, packMissingBanner);
  stageHost.append(stage);
  return {
    stage,
    canvas,
    playTestHud,
    playTestHudState,
    playTestHudLoadout,
    stageStatus,
    guideReadout,
    playTestReticle,
    packMissingBanner,
  };
}

export function createBaseCharacterStageThree(
  dom: BaseCharacterStageDom,
  onGizmoDrag: (dragging: boolean) => void,
): BaseCharacterStageThree {
  const { canvas, stage } = dom;
  ensureNodeRectAreaLights();
  const renderer = new WebGPURenderer({ canvas, antialias: true });
  renderer.setPixelRatio(Math.min(window.devicePixelRatio, 2));
  renderer.outputColorSpace = THREE.SRGBColorSpace;
  renderer.toneMapping = THREE.ACESFilmicToneMapping;
  renderer.toneMappingExposure = 1.05;
  const scene = new THREE.Scene();
  scene.background = new THREE.Color(0x08101d);
  scene.add(new THREE.HemisphereLight(0xc6dcff, 0x263047, 1.5));
  const light = new THREE.DirectionalLight(0xffffff, 2.2);
  light.position.set(2.5, 4.5, 2);
  scene.add(light);
  const ground = new THREE.Mesh(
    new THREE.CircleGeometry(12, 96),
    new THREE.MeshStandardMaterial({ color: 0x17243a, roughness: 0.95 }),
  );
  ground.rotation.x = -Math.PI / 2;
  scene.add(ground);
  const grid = new THREE.GridHelper(20, 20, 0x43749a, 0x233b58);
  grid.position.y = 0.003;
  scene.add(grid);
  const camera = new THREE.PerspectiveCamera(45, 1, 0.01, 200);
  camera.position.set(0, 1.05, 4.2);
  const controls = new OrbitControls(camera, canvas);
  controls.enableDamping = true;
  controls.dampingFactor = 0.12;
  controls.target.set(0, 1, 0);
  controls.minDistance = 0.08;
  controls.mouseButtons = {
    LEFT: THREE.MOUSE.ROTATE,
    MIDDLE: THREE.MOUSE.PAN,
    RIGHT: null as unknown as THREE.MOUSE,
  };
  const gizmo = new TransformControls(camera, canvas);
  gizmo.setSpace('local');
  gizmo.setTranslationSnap(0.01);
  gizmo.setRotationSnap(THREE.MathUtils.degToRad(5));
  gizmo.setScaleSnap(0.05);
  scene.add(gizmo.getHelper());
  gizmo.addEventListener('dragging-changed', (event) => {
    onGizmoDrag(Boolean(event.value));
  });
  const previewRoot = new THREE.Group();
  scene.add(previewRoot);

  const resize = (): void => {
    const width = Math.max(1, canvas.clientWidth);
    const height = Math.max(1, canvas.clientHeight);
    renderer.setSize(width, height, false);
    camera.aspect = width / height;
    camera.updateProjectionMatrix();
  };

  const updateAuthoringClipPlanes = (): void => {
    const distance = Math.max(0.05, camera.position.distanceTo(controls.target));
    const nextNear = THREE.MathUtils.clamp(distance * 0.01, 0.001, 0.05);
    const nextFar = Math.max(200, distance * 40);
    if (camera.near === nextNear && camera.far === nextFar) return;
    camera.near = nextNear;
    camera.far = nextFar;
    camera.updateProjectionMatrix();
  };

  const resizeObserver = new ResizeObserver(resize);
  resizeObserver.observe(stage);
  const clock = new THREE.Clock();
  let disposed = false;
  let rendererInitialized = false;
  let rendererDisposed = false;
  let environmentTarget: ReturnType<PMREMGenerator['fromScene']> | null = null;

  const disposeRenderer = (): void => {
    if (!rendererInitialized || rendererDisposed) return;
    rendererDisposed = true;
    renderer.dispose();
  };

  // WebGPU initialization is asynchronous. KTX2 feature detection and the
  // PMREM bake both require a live backend, so no preview content or frame loop
  // may start until this promise settles.
  const ready = initRequiredWebGpu(renderer).then(() => {
    rendererInitialized = true;
    if (disposed) {
      disposeRenderer();
      return;
    }
    setKtx2SupportRenderer(renderer);
    const environment = new RoomEnvironment();
    const pmrem = new PMREMGenerator(renderer);
    try {
      environmentTarget = pmrem.fromScene(environment, 0.04);
      scene.environment = environmentTarget.texture;
    } finally {
      environment.dispose();
      pmrem.dispose();
    }
  });
  void ready.catch(() => {
    disposeRenderer();
  });

  return {
    renderer,
    ready,
    scene,
    camera,
    controls,
    gizmo,
    previewRoot,
    resize,
    updateAuthoringClipPlanes,
    clock,
    dispose: () => {
      if (disposed) return;
      disposed = true;
      resizeObserver.disconnect();
      environmentTarget?.dispose();
      environmentTarget = null;
      ground.geometry.dispose();
      (ground.material as THREE.Material).dispose();
      grid.geometry.dispose();
      const gridMaterial = grid.material;
      if (Array.isArray(gridMaterial)) {
        for (const material of gridMaterial) material.dispose();
      } else {
        gridMaterial.dispose();
      }
      disposeRenderer();
    },
  };
}
