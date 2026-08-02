import * as THREE from 'three';
import { WebGPURenderer } from 'three/webgpu';
import { OrbitControls } from 'three/examples/jsm/controls/OrbitControls';
import { setKtx2SupportRenderer } from '../../render/assets/ktx2';
import { initRequiredWebGpu } from '../../render/webgpu-required';
import { cartesianFromLatLonAlt } from '../../world/coordinates';
import { sampleSurfaceHeight } from '../../world/elevation';
import { activatePlanetDocument } from '../../world/planets/runtime';
import { planetPhysicsFromDocument, type PlanetDocument } from '../../world/planets/schema';
import type { LandingSiteHint } from '../../types';
import type { SurfaceDestination } from '../../world/biome-teleport';
import { createPlanetPreviewFlySession } from './planet-preview-fly';
import {
  PREVIEW_HEIGHT_SCALE,
  PREVIEW_PATCH_EXTENT_METERS,
  buildPreviewVegetation,
  type PreviewVegetationHandle,
} from './planet-preview-vegetation';
import { createWebGpuWindMaterial } from '../../render/vegetation/render/wind-node-material';
import { buildPreviewSpawns, type PreviewSpawnHandle } from './planet-preview-spawns';
import {
  buildPlanetPreviewMeshes,
  disposePreviewMesh,
  type PlanetPreviewMeshDiagnostics,
} from './planet-preview-mesh';

const PREVIEW_SEGMENTS = 96;

export type { PlanetPreviewMeshDiagnostics as PreviewDiagnostics };

export interface PlanetPreviewControllerDeps {
  getDocument: () => PlanetDocument;
  getPreviewLocation: () => LandingSiteHint;
  getPreviewDestination: () => SurfaceDestination | null;
  onDiagnostics: (diagnostics: PlanetPreviewMeshDiagnostics | null) => void;
  onBuildStatus: (message: string, isError?: boolean) => void;
}

export interface PlanetPreviewController {
  activate: () => void;
  deactivate: () => void;
  dispose: () => void;
  markPreviewDirty: () => void;
  resetCameraOnNextRebuild: () => void;
  refreshHeightfieldPreview: () => void;
  endFly: () => void;
}

function createPlanetPreviewRenderer(): WebGPURenderer {
  const renderer = new WebGPURenderer({ antialias: true, alpha: false });
  renderer.setPixelRatio(Math.min(window.devicePixelRatio, 1.5));
  renderer.setClearColor(0x07101c, 1);
  renderer.outputColorSpace = THREE.SRGBColorSpace;
  return renderer;
}

function mountPlanetPreviewCanvas(
  previewHost: HTMLElement,
  canvas: HTMLCanvasElement,
): void {
  canvas.className = 'ed-planet-canvas';
  const hint = document.createElement('div');
  hint.className = 'ed-planet-preview-hint';
  hint.textContent =
    'LMB orbit · MMB pan · hold RMB + WASD/QE fly · wheel (while flying) speed · Shift boost';
  previewHost.replaceChildren(canvas, hint);
}

function configureOrbit(orbit: OrbitControls): void {
  orbit.enableDamping = true;
  orbit.dampingFactor = 0.12;
  orbit.mouseButtons = {
    LEFT: THREE.MOUSE.ROTATE,
    MIDDLE: THREE.MOUSE.PAN,
    RIGHT: null as unknown as THREE.MOUSE,
  };
}

function previewPatchFor(
  documentState: PlanetDocument,
  location: LandingSiteHint,
) {
  const halfExtentMeters = PREVIEW_PATCH_EXTENT_METERS / 2;
  const halfLatExtentRadians = halfExtentMeters / documentState.radiusMeters;
  return {
    halfLatExtentRadians,
    halfLonExtentRadians:
      halfLatExtentRadians / Math.max(Math.cos(location.latRadians), 0.1),
    heightScale: PREVIEW_HEIGHT_SCALE,
    hint: location,
    patchExtentMeters: PREVIEW_PATCH_EXTENT_METERS,
  };
}

export function createPlanetPreviewController(
  previewHost: HTMLElement,
  deps: PlanetPreviewControllerDeps,
): PlanetPreviewController {
  let active = false;
  let previewDirty = true;
  let resetCameraOnRebuild = true;
  let raf = 0;

  // Lazy WebGPU: constructed on activate, disposed on deactivate so Planet
  // Authoring Test Play does not share the adapter with a live preview device
  // (concurrent devices stall takram atmosphere LUT fill → black sky).
  let renderer: WebGPURenderer | null = null;
  let canvas: HTMLCanvasElement | null = null;
  let orbit: OrbitControls | null = null;
  /** Bumped on every release so in-flight init promises cannot revive a dead device. */
  let gpuGeneration = 0;

  const scene = new THREE.Scene();
  const camera = new THREE.PerspectiveCamera(50, 1, 1, 50_000);
  const clock = new THREE.Clock();
  const light = new THREE.DirectionalLight(0xffffff, 1.2);
  light.position.set(0.4, 1, 0.2);
  scene.add(light, new THREE.AmbientLight(0x8899aa, 0.55));

  let previewMesh: THREE.Mesh | null = null;
  let previewWaterMesh: THREE.Mesh | null = null;
  let previewVegetation: PreviewVegetationHandle | null = null;
  let previewVegetationLoad: { cancel: () => void } | null = null;
  let previewVegetationGeneration = 0;
  let previewSpawns: PreviewSpawnHandle | null = null;
  let previewSpawnsLoad: { cancel: () => void } | null = null;
  let previewSpawnsGeneration = 0;
  let disposed = false;
  let backendReady = false;
  let backendFailed = false;
  let pendingHeightfieldRefresh = false;
  const savedOrbitTarget = new THREE.Vector3(0, 0, 0);

  const fly = createPlanetPreviewFlySession({
    camera,
    getOrbit: () => orbit,
    getCanvas: () => canvas,
    isActive: () => active,
  });

  function clearPreviewVegetation(): void {
    previewVegetationLoad?.cancel();
    previewVegetationLoad = null;
    previewVegetation?.dispose();
    previewVegetation = null;
  }

  function clearPreviewSpawns(): void {
    previewSpawnsLoad?.cancel();
    previewSpawnsLoad = null;
    previewSpawns?.dispose();
    previewSpawns = null;
  }

  function clearPreviewDecorations(): void {
    clearPreviewVegetation();
    clearPreviewSpawns();
  }

  function releaseGpu(): void {
    fly.endFly();
    cancelAnimationFrame(raf);
    raf = 0;
    clearPreviewDecorations();
    disposePreviewMesh(previewMesh, scene);
    disposePreviewMesh(previewWaterMesh, scene);
    previewMesh = null;
    previewWaterMesh = null;
    deps.onDiagnostics(null);
    if (orbit) {
      savedOrbitTarget.copy(orbit.target);
      orbit.dispose();
      orbit = null;
    }
    if (renderer) {
      // Three's pre-init dispose path calls setAnimationLoop(), which starts
      // init() itself. Only dispose after init finished; in-flight init is
      // dropped by the generation check in acquireGpu's then/catch.
      if (backendReady) {
        renderer.dispose();
      }
      renderer = null;
    }
    canvas?.remove();
    canvas = null;
    backendReady = false;
    gpuGeneration += 1;
    previewHost.replaceChildren();
  }

  function acquireGpu(): void {
    if (disposed || renderer) return;
    backendFailed = false;
    const nextRenderer = createPlanetPreviewRenderer();
    const nextCanvas = nextRenderer.domElement;
    renderer = nextRenderer;
    canvas = nextCanvas;
    mountPlanetPreviewCanvas(previewHost, nextCanvas);
    const nextOrbit = new OrbitControls(camera, nextCanvas);
    configureOrbit(nextOrbit);
    nextOrbit.target.copy(savedOrbitTarget);
    nextOrbit.update();
    orbit = nextOrbit;
    fly.bindCanvas(nextCanvas);

    const generation = gpuGeneration;
    void initRequiredWebGpu(nextRenderer).then(
      () => {
        if (disposed || generation !== gpuGeneration || renderer !== nextRenderer) {
          nextRenderer.dispose();
          return;
        }
        setKtx2SupportRenderer(nextRenderer);
        backendReady = true;
        startFrameLoop();
      },
      (error: unknown) => {
        if (disposed || generation !== gpuGeneration) return;
        backendFailed = true;
        if (renderer === nextRenderer) {
          renderer = null;
          canvas?.remove();
          canvas = null;
          orbit?.dispose();
          orbit = null;
          previewHost.replaceChildren();
          gpuGeneration += 1;
        }
        console.error('[planet-preview] WebGPU unavailable — preview disabled.', error);
        deps.onBuildStatus('Planet Preview requires WebGPU, but initialization failed.', true);
      },
    );
  }

  window.addEventListener('keydown', fly.onFlyKey);
  window.addEventListener('keyup', fly.onFlyKey);
  document.addEventListener('pointerlockchange', fly.onPointerLockChange);

  function rebuildPreviewMesh(): void {
    if (!orbit) return;
    clearPreviewDecorations();
    const documentState = deps.getDocument();
    activatePlanetDocument(documentState);
    const planet = planetPhysicsFromDocument(documentState);
    const seed = documentState.seed;
    const hint = deps.getPreviewLocation();
    const patch = previewPatchFor(documentState, hint);
    const built = buildPlanetPreviewMeshes({
      planet,
      seed,
      patch,
      segments: PREVIEW_SEGMENTS,
      palette: documentState.palette,
      coastMaxHeightMeters: documentState.biomes.coastMaxHeightMeters,
      activePreviewDestination: deps.getPreviewDestination(),
    });
    disposePreviewMesh(previewMesh, scene);
    disposePreviewMesh(previewWaterMesh, scene);
    previewMesh = built.terrainMesh;
    previewWaterMesh = built.waterMesh;
    scene.add(previewMesh);
    if (previewWaterMesh) scene.add(previewWaterMesh);
    deps.onDiagnostics(built.diagnostics);
    if (resetCameraOnRebuild) {
      fly.endFly();
      camera.position.set(0, built.midHeight + 230, 440);
      orbit.target.set(0, built.midHeight, 0);
      camera.lookAt(orbit.target);
      orbit.update();
      resetCameraOnRebuild = false;
    }
    previewDirty = false;
  }

  function resize(): void {
    if (!renderer) return;
    const width = Math.max(1, previewHost.clientWidth);
    const height = Math.max(1, previewHost.clientHeight);
    renderer.setSize(width, height, false);
    camera.aspect = width / height;
    camera.updateProjectionMatrix();
  }

  function frame(): void {
    if (!active || !backendReady || disposed || !renderer || !orbit) return;
    const dt = Math.min(clock.getDelta(), 0.05);
    if (previewDirty) rebuildPreviewMesh();
    resize();
    if (fly.isFlying()) fly.updateFly(dt);
    else orbit.update();
    renderer.render(scene, camera);
    raf = requestAnimationFrame(frame);
  }

  function startFrameLoop(): void {
    if (!active || !backendReady || disposed) return;
    clock.start();
    cancelAnimationFrame(raf);
    raf = requestAnimationFrame(frame);
    if (!pendingHeightfieldRefresh) return;
    try {
      refreshHeightfieldPreviewReady();
    } catch (error) {
      pendingHeightfieldRefresh = false;
      console.error('[planet-preview] Content build failed after WebGPU initialization.', error);
      deps.onBuildStatus('Planet Preview content failed to build. Check the console for details.', true);
    }
  }

  function framePreviewCameraForVegetation(): void {
    if (!orbit) return;
    const documentState = deps.getDocument();
    const planet = planetPhysicsFromDocument(documentState);
    const hint = deps.getPreviewLocation();
    const midHeight =
      sampleSurfaceHeight(
        planet,
        documentState.seed,
        cartesianFromLatLonAlt(hint.latRadians, hint.lonRadians, 0, planet.radiusMeters),
      ) * PREVIEW_HEIGHT_SCALE;
    fly.endFly();
    camera.position.set(0, midHeight + 85, 170);
    orbit.target.set(0, midHeight + 15, 0);
    camera.lookAt(orbit.target);
    orbit.update();
  }

  function refreshHeightfieldPreviewReady(): void {
    pendingHeightfieldRefresh = false;
    const documentState = deps.getDocument();
    activatePlanetDocument(documentState);
    const vegGeneration = ++previewVegetationGeneration;
    const spawnGeneration = ++previewSpawnsGeneration;
    previewDirty = false;
    rebuildPreviewMesh();

    const planet = planetPhysicsFromDocument(documentState);
    const patch = previewPatchFor(documentState, deps.getPreviewLocation());

    let grassCount = 0;
    let treeCount = 0;
    let spawnCount = 0;
    let vegReady = false;
    let spawnReady = false;
    let hadError = false;

    function publishPreviewStatus(): void {
      if (!vegReady || !spawnReady || hadError) return;
      if (grassCount === 0 && treeCount === 0 && spawnCount === 0) {
        deps.onBuildStatus(
          'Preview placed 0 props — check veg density, spawn catalog density/biomes/height bands.',
          true,
        );
        return;
      }
      const gd = documentState.vegetation.grass.density;
      const td = documentState.vegetation.tree.density;
      deps.onBuildStatus(
        `Preview: ${grassCount} grass (d=${gd}), ${treeCount} trees (d=${td}), ${spawnCount} catalog props.`,
      );
    }

    deps.onBuildStatus('Building vegetation + spawn preview…');
    previewVegetationLoad = buildPreviewVegetation(
      planet,
      documentState.seed,
      patch,
      documentState.vegetation,
      (handle) => {
        if (vegGeneration !== previewVegetationGeneration) {
          handle.dispose();
          return;
        }
        previewVegetation = handle;
        scene.add(handle.group);
        grassCount = handle.grassCount;
        treeCount = handle.treeCount;
        vegReady = true;
        framePreviewCameraForVegetation();
        publishPreviewStatus();
      },
      (message) => {
        if (vegGeneration !== previewVegetationGeneration) return;
        hadError = true;
        deps.onBuildStatus(message, true);
      },
      { windMaterialFactory: createWebGpuWindMaterial },
    );

    previewSpawnsLoad = buildPreviewSpawns(
      planet,
      documentState.seed,
      patch,
      documentState.spawning,
      (handle) => {
        if (spawnGeneration !== previewSpawnsGeneration) {
          handle.dispose();
          return;
        }
        previewSpawns = handle;
        scene.add(handle.group);
        spawnCount = handle.spawnCount;
        spawnReady = true;
        framePreviewCameraForVegetation();
        publishPreviewStatus();
      },
      (message) => {
        if (spawnGeneration !== previewSpawnsGeneration) return;
        hadError = true;
        deps.onBuildStatus(message, true);
      },
    );
  }

  function refreshHeightfieldPreview(): void {
    if (!backendReady) {
      pendingHeightfieldRefresh = !backendFailed;
      if (backendFailed) {
        deps.onBuildStatus('Planet Preview is unavailable because WebGPU failed to initialize.', true);
      }
      return;
    }
    refreshHeightfieldPreviewReady();
  }

  return {
    activate: () => {
      if (disposed) return;
      active = true;
      // Rebuild after Play: GPU was torn down and mesh may be stale.
      previewDirty = true;
      acquireGpu();
      startFrameLoop();
    },
    deactivate: () => {
      active = false;
      // Drop the WebGPU device entirely — pausing RAF is not enough. A second
      // live adapter beside Test Play's gameplay renderer breaks atmosphere LUT
      // compute and leaves a pitch-black sky over lit terrain.
      releaseGpu();
    },
    dispose: () => {
      disposed = true;
      active = false;
      window.removeEventListener('keydown', fly.onFlyKey);
      window.removeEventListener('keyup', fly.onFlyKey);
      document.removeEventListener('pointerlockchange', fly.onPointerLockChange);
      releaseGpu();
      disposePreviewMesh(previewMesh, scene);
      disposePreviewMesh(previewWaterMesh, scene);
      previewMesh = null;
      previewWaterMesh = null;
    },
    markPreviewDirty: () => {
      previewDirty = true;
    },
    resetCameraOnNextRebuild: () => {
      resetCameraOnRebuild = true;
    },
    refreshHeightfieldPreview,
    endFly: fly.endFly,
  };
}
