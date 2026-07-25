import * as THREE from 'three';
import { OrbitControls } from 'three/examples/jsm/controls/OrbitControls';
import { cartesianFromLatLonAlt } from '../../world/coordinates';
import { sampleSurfaceHeight } from '../../world/elevation';
import { activatePlanetDocument } from '../../world/planets/runtime';
import { planetPhysicsFromDocument, type PlanetDocument } from '../../world/planets/schema';
import type { LandingSiteHint } from '../../types';
import type { SurfaceDestination } from '../../world/biome-teleport';
import {
  PREVIEW_HEIGHT_SCALE,
  PREVIEW_PATCH_EXTENT_METERS,
  buildPreviewVegetation,
  type PreviewVegetationHandle,
} from './planet-preview-vegetation';
import { buildPreviewSpawns, type PreviewSpawnHandle } from './planet-preview-spawns';
import {
  buildPlanetPreviewMeshes,
  disposePreviewMesh,
  type PlanetPreviewMeshDiagnostics,
} from './planet-preview-mesh';

const PREVIEW_SEGMENTS = 96;

const FLY_KEY_CODES = new Set([
  'KeyW',
  'KeyA',
  'KeyS',
  'KeyD',
  'KeyQ',
  'KeyE',
  'ShiftLeft',
  'ShiftRight',
]);
const FLY_LOOK_RADIANS_PER_PIXEL = 0.0022;
const FLY_PITCH_LIMIT = Math.PI / 2 - 0.01;

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

export function createPlanetPreviewController(
  previewHost: HTMLElement,
  deps: PlanetPreviewControllerDeps,
): PlanetPreviewController {
  let active = false;
  let previewDirty = true;
  let resetCameraOnRebuild = true;
  let raf = 0;

  const renderer = new THREE.WebGLRenderer({ antialias: true, alpha: false });
  renderer.setPixelRatio(Math.min(window.devicePixelRatio, 1.5));
  renderer.setClearColor(0x07101c, 1);
  const canvas = renderer.domElement;
  canvas.className = 'ed-planet-canvas';

  const previewHint = document.createElement('div');
  previewHint.className = 'ed-planet-preview-hint';
  previewHint.textContent =
    'LMB orbit · MMB pan · hold RMB + WASD/QE fly · wheel (while flying) speed · Shift boost';
  previewHost.replaceChildren(canvas, previewHint);

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

  const orbit = new OrbitControls(camera, canvas);
  orbit.enableDamping = true;
  orbit.dampingFactor = 0.12;
  orbit.target.set(0, 0, 0);
  orbit.mouseButtons = {
    LEFT: THREE.MOUSE.ROTATE,
    MIDDLE: THREE.MOUSE.PAN,
    RIGHT: null as unknown as THREE.MOUSE,
  };

  const flyKeys = new Set<string>();
  const flyEuler = new THREE.Euler(0, 0, 0, 'YXZ');
  const flyForward = new THREE.Vector3();
  const flyRight = new THREE.Vector3();
  const flyMove = new THREE.Vector3();
  let flying = false;
  let flySpeed = 80;
  let flyTargetDistance = 400;

  function beginFly(): void {
    if (flying || !active) return;
    flying = true;
    flyTargetDistance = Math.max(40, camera.position.distanceTo(orbit.target));
    flyEuler.setFromQuaternion(camera.quaternion, 'YXZ');
    flyEuler.z = 0;
    orbit.enabled = false;
    canvas.requestPointerLock?.();
  }

  function endFly(): void {
    if (!flying) return;
    flying = false;
    flyKeys.clear();
    if (document.pointerLockElement === canvas) document.exitPointerLock();
    camera.getWorldDirection(flyForward);
    orbit.target.copy(camera.position).addScaledVector(flyForward, flyTargetDistance);
    orbit.enabled = true;
    orbit.update();
  }

  function onFlyLook(event: PointerEvent): void {
    if (!flying) return;
    flyEuler.y -= event.movementX * FLY_LOOK_RADIANS_PER_PIXEL;
    flyEuler.x -= event.movementY * FLY_LOOK_RADIANS_PER_PIXEL;
    flyEuler.x = Math.max(-FLY_PITCH_LIMIT, Math.min(FLY_PITCH_LIMIT, flyEuler.x));
    camera.quaternion.setFromEuler(flyEuler);
  }

  function updateFly(dt: number): void {
    camera.getWorldDirection(flyForward);
    flyRight.crossVectors(flyForward, camera.up).normalize();
    flyMove.set(0, 0, 0);
    if (flyKeys.has('KeyW')) flyMove.add(flyForward);
    if (flyKeys.has('KeyS')) flyMove.sub(flyForward);
    if (flyKeys.has('KeyD')) flyMove.add(flyRight);
    if (flyKeys.has('KeyA')) flyMove.sub(flyRight);
    if (flyKeys.has('KeyE')) flyMove.y += 1;
    if (flyKeys.has('KeyQ')) flyMove.y -= 1;
    if (flyMove.lengthSq() === 0) return;
    const boost = flyKeys.has('ShiftLeft') || flyKeys.has('ShiftRight') ? 4 : 1;
    flyMove.normalize().multiplyScalar(flySpeed * boost * dt);
    camera.position.add(flyMove);
  }

  function onFlyKey(event: KeyboardEvent): void {
    if (!flying || !FLY_KEY_CODES.has(event.code)) return;
    if (
      event.target instanceof HTMLElement &&
      (event.target.tagName === 'INPUT' ||
        event.target.tagName === 'TEXTAREA' ||
        event.target.tagName === 'SELECT' ||
        event.target.isContentEditable)
    ) {
      return;
    }
    event.preventDefault();
    if (event.type === 'keydown') flyKeys.add(event.code);
    else flyKeys.delete(event.code);
  }

  function onPointerLockChange(): void {
    if (flying && document.pointerLockElement !== canvas) endFly();
  }

  window.addEventListener('keydown', onFlyKey);
  window.addEventListener('keyup', onFlyKey);
  document.addEventListener('pointerlockchange', onPointerLockChange);
  canvas.addEventListener('contextmenu', (event) => event.preventDefault());
  canvas.addEventListener('pointermove', onFlyLook);
  canvas.addEventListener('pointerdown', (event) => {
    if (event.button !== 2) return;
    try {
      canvas.setPointerCapture(event.pointerId);
    } catch {
      // Stale pointer id — flythrough still works.
    }
    beginFly();
  });
  canvas.addEventListener('pointerup', (event) => {
    if (event.button === 2) endFly();
  });
  canvas.addEventListener('pointercancel', () => endFly());
  canvas.addEventListener(
    'wheel',
    (event) => {
      if (!flying) return;
      event.preventDefault();
      event.stopImmediatePropagation();
      flySpeed = Math.min(
        800,
        Math.max(2, flySpeed * Math.pow(1.1, -event.deltaY / 100)),
      );
    },
    { passive: false },
  );

  function previewPatch(location = deps.getPreviewLocation()) {
    const documentState = deps.getDocument();
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

  function rebuildPreviewMesh(): void {
    clearPreviewDecorations();
    const documentState = deps.getDocument();
    activatePlanetDocument(documentState);
    const planet = planetPhysicsFromDocument(documentState);
    const seed = documentState.seed;
    const hint = deps.getPreviewLocation();
    const patch = previewPatch(hint);
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
      endFly();
      camera.position.set(0, built.midHeight + 230, 440);
      orbit.target.set(0, built.midHeight, 0);
      camera.lookAt(orbit.target);
      orbit.update();
      resetCameraOnRebuild = false;
    }
    previewDirty = false;
  }

  function resize(): void {
    const width = Math.max(1, previewHost.clientWidth);
    const height = Math.max(1, previewHost.clientHeight);
    renderer.setSize(width, height, false);
    camera.aspect = width / height;
    camera.updateProjectionMatrix();
  }

  function frame(): void {
    if (!active) return;
    const dt = Math.min(clock.getDelta(), 0.05);
    if (previewDirty) rebuildPreviewMesh();
    resize();
    if (flying) updateFly(dt);
    else orbit.update();
    renderer.render(scene, camera);
    raf = requestAnimationFrame(frame);
  }

  function framePreviewCameraForVegetation(): void {
    const documentState = deps.getDocument();
    const planet = planetPhysicsFromDocument(documentState);
    const hint = deps.getPreviewLocation();
    const midHeight =
      sampleSurfaceHeight(
        planet,
        documentState.seed,
        cartesianFromLatLonAlt(hint.latRadians, hint.lonRadians, 0, planet.radiusMeters),
      ) * PREVIEW_HEIGHT_SCALE;
    endFly();
    camera.position.set(0, midHeight + 85, 170);
    orbit.target.set(0, midHeight + 15, 0);
    camera.lookAt(orbit.target);
    orbit.update();
  }

  function refreshHeightfieldPreview(): void {
    const documentState = deps.getDocument();
    activatePlanetDocument(documentState);
    const vegGeneration = ++previewVegetationGeneration;
    const spawnGeneration = ++previewSpawnsGeneration;
    previewDirty = false;
    rebuildPreviewMesh();

    const planet = planetPhysicsFromDocument(documentState);
    const patch = previewPatch(deps.getPreviewLocation());

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

  return {
    activate: () => {
      active = true;
      clock.start();
      cancelAnimationFrame(raf);
      raf = requestAnimationFrame(frame);
    },
    deactivate: () => {
      active = false;
      endFly();
      cancelAnimationFrame(raf);
      clearPreviewDecorations();
    },
    dispose: () => {
      window.removeEventListener('keydown', onFlyKey);
      window.removeEventListener('keyup', onFlyKey);
      document.removeEventListener('pointerlockchange', onPointerLockChange);
      cancelAnimationFrame(raf);
      clearPreviewDecorations();
      disposePreviewMesh(previewMesh, scene);
      disposePreviewMesh(previewWaterMesh, scene);
      renderer.dispose();
    },
    markPreviewDirty: () => {
      previewDirty = true;
    },
    resetCameraOnNextRebuild: () => {
      resetCameraOnRebuild = true;
    },
    refreshHeightfieldPreview,
    endFly,
  };
}
