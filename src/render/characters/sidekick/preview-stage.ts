import * as THREE from 'three';
import { PMREMGenerator, WebGPURenderer } from 'three/webgpu';
import { OrbitControls } from 'three/examples/jsm/controls/OrbitControls';
import { RoomEnvironment } from 'three/examples/jsm/environments/RoomEnvironment.js';
import type { SidekickCatalog } from '../../../player/character_creator/sidekick-manifest';
import type { SidekickCharacterDefinitionV2 } from '../../../player/character_creator/sidekick-definition';
import { setKtx2SupportRenderer } from '../../assets/ktx2';
import {
  disposeOwnedGpuResources,
  disposeSubtreeShadowMaps,
} from '../../assets/gpu-dispose';
import { ensureNodeRectAreaLights } from '../../node-lights';
import {
  disposeNestedParticleSystems,
  updateNestedParticleSystems,
} from '../../particles';
import { initRequiredWebGpu } from '../../webgpu-required';
import { assembleSidekickCharacter } from './assemble-avatar';
import { createSidekickAnimationRuntime } from './animation-runtime';

export interface SidekickPreviewStage {
  readonly avatarRoot: THREE.Group;
  dispose: () => void;
  setActive: (active: boolean) => void;
  setAnimation: (clipName: string) => void;
  setDefinition: (definition: SidekickCharacterDefinitionV2) => void;
}

export interface SidekickPreviewStageHooks {
  onAnimationsReady?: (clipNames: readonly string[], activeClipName: string) => void;
  onBusyChange?: (busy: boolean) => void;
  onError?: (error: unknown) => void;
}

export interface SidekickPreviewStageOptions {
  transparent?: boolean;
  showGround?: boolean;
  horizontalRotationOnly?: boolean;
  enableZoom?: boolean;
  subjectHorizontalOffset?: number;
}

interface PreviewRendererState {
  renderer: WebGPURenderer;
  scene: THREE.Scene;
  dispose: () => void;
}

async function createRequiredPreviewRenderer(
  canvas: HTMLCanvasElement,
  transparent: boolean,
): Promise<PreviewRendererState> {
  const renderer = new WebGPURenderer({ canvas, antialias: true, alpha: transparent });
  renderer.setPixelRatio(Math.min(window.devicePixelRatio, 2));
  renderer.shadowMap.enabled = true;
  renderer.outputColorSpace = THREE.SRGBColorSpace;
  renderer.toneMapping = THREE.ACESFilmicToneMapping;
  renderer.toneMappingExposure = 1.05;
  let rendererInitialized = false;
  let rendererDisposed = false;
  const disposeRenderer = (): void => {
    if (!rendererInitialized || rendererDisposed) return;
    rendererDisposed = true;
    renderer.dispose();
  };

  try {
    await initRequiredWebGpu(renderer);
    rendererInitialized = true;
    setKtx2SupportRenderer(renderer);
    ensureNodeRectAreaLights();
    const scene = new THREE.Scene();
    scene.background = transparent ? null : new THREE.Color(0x08101d);
    if (transparent) renderer.setClearColor(0x000000, 0);
    const environmentScene = new RoomEnvironment();
    const pmremGenerator = new PMREMGenerator(renderer);
    let environmentTarget: ReturnType<PMREMGenerator['fromScene']>;
    try {
      environmentTarget = pmremGenerator.fromScene(environmentScene, 0.04);
      scene.environment = environmentTarget.texture;
    } finally {
      environmentScene.dispose();
      pmremGenerator.dispose();
    }
    return {
      renderer,
      scene,
      dispose: () => {
        environmentTarget.dispose();
        disposeRenderer();
      },
    };
  } catch (error) {
    disposeRenderer();
    throw error;
  }
}

function visibleGeometryBounds(root: THREE.Object3D): THREE.Box3 {
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

function disposeOwnedAttachments(root: THREE.Object3D): void {
  disposeNestedParticleSystems(root);
  const ownedRoots: THREE.Object3D[] = [];
  root.traverse((object) => {
    if (object.userData.ownedGpu) ownedRoots.push(object);
  });
  for (let index = ownedRoots.length - 1; index >= 0; index -= 1) {
    disposeOwnedGpuResources(ownedRoots[index]);
  }
}

export async function createSidekickPreviewStage(
  canvas: HTMLCanvasElement,
  catalog: SidekickCatalog,
  initialDefinition: SidekickCharacterDefinitionV2,
  hooks: SidekickPreviewStageHooks = {},
  options: SidekickPreviewStageOptions = {},
): Promise<SidekickPreviewStage> {
  hooks.onBusyChange?.(true);
  let rendererState: PreviewRendererState;
  try {
    rendererState = await createRequiredPreviewRenderer(
      canvas,
      options.transparent ?? false,
    );
  } catch (error) {
    hooks.onBusyChange?.(false);
    hooks.onError?.(error);
    throw error;
  }
  const { renderer, scene } = rendererState;

  const camera = new THREE.PerspectiveCamera(45, 1, 0.05, 200);
  const controls = new OrbitControls(camera, canvas);
  controls.enableDamping = true;
  controls.minDistance = 1.2;
  controls.maxDistance = 5;
  controls.enablePan = false;
  controls.enableZoom = options.enableZoom ?? true;

  scene.add(new THREE.HemisphereLight(0xc6dcff, 0x263047, 1.5));
  const keyLight = new THREE.DirectionalLight(0xffffff, 2.2);
  keyLight.position.set(2.5, 4.5, 2);
  keyLight.castShadow = true;
  scene.add(keyLight);
  const rimLight = new THREE.DirectionalLight(0x78bfff, 1.1);
  rimLight.position.set(-2.5, 2.5, -2);
  scene.add(rimLight);

  const ground = options.showGround === false
    ? null
    : new THREE.Mesh(
        new THREE.CircleGeometry(3, 64),
        new THREE.MeshStandardMaterial({ color: 0x17243a, roughness: 0.95 }),
      );
  if (ground) {
    ground.rotation.x = -Math.PI / 2;
    ground.receiveShadow = true;
    scene.add(ground);
  }

  let avatar: Awaited<ReturnType<typeof assembleSidekickCharacter>>;
  try {
    avatar = await assembleSidekickCharacter(catalog, initialDefinition);
  } catch (error) {
    controls.dispose();
    ground?.geometry.dispose();
    if (ground) (ground.material as THREE.Material).dispose();
    rendererState.dispose();
    hooks.onBusyChange?.(false);
    hooks.onError?.(error);
    throw error;
  }
  scene.add(avatar.root);
  const bounds = visibleGeometryBounds(avatar.root);
  const size = bounds.getSize(new THREE.Vector3());
  const center = bounds.getCenter(new THREE.Vector3());
  controls.target.copy(center);
  camera.position.set(
    center.x,
    center.y + size.y * 0.12,
    center.z + Math.max(2.2, size.y * 1.3),
  );
  controls.update();
  if (options.horizontalRotationOnly) {
    const polarAngle = controls.getPolarAngle();
    controls.minPolarAngle = polarAngle;
    controls.maxPolarAngle = polarAngle;
  }

  let animation: Awaited<ReturnType<typeof createSidekickAnimationRuntime>> | null = null;
  let desiredAnimation = 'Idle_Loop';
  let disposed = false;
  void createSidekickAnimationRuntime(avatar.root)
    .then((runtime) => {
      if (disposed) {
        runtime.dispose();
        return;
      }
      animation = runtime;
      desiredAnimation = runtime.clipNames.includes(desiredAnimation)
        ? desiredAnimation
        : runtime.clipNames[0] ?? '';
      runtime.setAnimation(desiredAnimation, 0);
      hooks.onAnimationsReady?.(runtime.clipNames, desiredAnimation);
    })
    .catch((error: unknown) => {
      if (disposed) return;
      hooks.onAnimationsReady?.([], '');
      console.warn('Character creator preview animations unavailable.', error);
    });

  let pendingDefinition: SidekickCharacterDefinitionV2 | null = null;
  let applying = false;
  const flushDefinitions = async (): Promise<void> => {
    if (applying || disposed) return;
    applying = true;
    hooks.onBusyChange?.(true);
    try {
      while (pendingDefinition && !disposed) {
        const definition = pendingDefinition;
        pendingDefinition = null;
        await avatar.applyDefinition(definition);
      }
    } catch (error) {
      if (!disposed) hooks.onError?.(error);
    } finally {
      applying = false;
      if (!disposed) hooks.onBusyChange?.(false);
      if (pendingDefinition && !disposed) void flushDefinitions();
    }
  };

  const resize = (): void => {
    const width = Math.max(1, canvas.clientWidth);
    const height = Math.max(1, canvas.clientHeight);
    renderer.setSize(width, height, false);
    camera.aspect = width / height;
    const subjectHorizontalOffset = options.subjectHorizontalOffset ?? 0;
    if (subjectHorizontalOffset === 0) {
      camera.clearViewOffset();
      camera.updateProjectionMatrix();
    } else {
      camera.setViewOffset(
        width,
        height,
        -subjectHorizontalOffset * width,
        0,
        width,
        height,
      );
    }
  };
  const resizeObserver = new ResizeObserver(resize);
  resizeObserver.observe(canvas);
  resize();

  const clock = new THREE.Clock();
  let frame = 0;
  let active = true;
  const render = (): void => {
    if (disposed) return;
    frame = requestAnimationFrame(render);
    if (!active) {
      clock.getDelta();
      return;
    }
    const deltaSeconds = clock.getDelta();
    animation?.update(deltaSeconds);
    updateNestedParticleSystems(avatar.root, deltaSeconds, camera);
    controls.update();
    renderer.render(scene, camera);
  };
  render();
  hooks.onBusyChange?.(false);

  return {
    avatarRoot: avatar.root,
    setActive: (nextActive) => {
      active = nextActive;
      if (active) resize();
    },
    setAnimation: (clipName) => {
      desiredAnimation = clipName;
      animation?.setAnimation(clipName);
    },
    setDefinition: (definition) => {
      pendingDefinition = definition;
      void flushDefinitions();
    },
    dispose: () => {
      if (disposed) return;
      disposed = true;
      cancelAnimationFrame(frame);
      resizeObserver.disconnect();
      controls.dispose();
      animation?.dispose();
      disposeOwnedAttachments(avatar.root);
      avatar.dispose();
      disposeSubtreeShadowMaps(scene);
      ground?.geometry.dispose();
      if (ground) (ground.material as THREE.Material).dispose();
      rendererState.dispose();
    },
  };
}
