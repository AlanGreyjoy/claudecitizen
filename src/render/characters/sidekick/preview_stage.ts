import * as THREE from 'three';
import { OrbitControls } from 'three/examples/jsm/controls/OrbitControls';
import { RoomEnvironment } from 'three/examples/jsm/environments/RoomEnvironment.js';
import type { SidekickCatalog } from '../../../player/character_creator/sidekick_manifest';
import type { SidekickCharacterDefinitionV2 } from '../../../player/character_creator/sidekick_definition';
import { assembleSidekickCharacter } from './assemble_avatar';
import { createSidekickAnimationRuntime } from './animation_runtime';

export interface SidekickPreviewStage {
  dispose: () => void;
  setAnimation: (clipName: string) => void;
  setDefinition: (definition: SidekickCharacterDefinitionV2) => void;
}

export interface SidekickPreviewStageHooks {
  onAnimationsReady?: (clipNames: readonly string[], activeClipName: string) => void;
  onBusyChange?: (busy: boolean) => void;
  onError?: (error: unknown) => void;
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

export async function createSidekickPreviewStage(
  canvas: HTMLCanvasElement,
  catalog: SidekickCatalog,
  initialDefinition: SidekickCharacterDefinitionV2,
  hooks: SidekickPreviewStageHooks = {},
): Promise<SidekickPreviewStage> {
  const renderer = new THREE.WebGLRenderer({ canvas, antialias: true });
  renderer.setPixelRatio(Math.min(window.devicePixelRatio, 2));
  renderer.shadowMap.enabled = true;
  renderer.outputColorSpace = THREE.SRGBColorSpace;
  renderer.toneMapping = THREE.ACESFilmicToneMapping;
  renderer.toneMappingExposure = 1.05;

  const scene = new THREE.Scene();
  scene.background = new THREE.Color(0x08101d);
  const environmentScene = new RoomEnvironment();
  const pmremGenerator = new THREE.PMREMGenerator(renderer);
  const environmentTarget = pmremGenerator.fromScene(environmentScene, 0.04);
  scene.environment = environmentTarget.texture;
  environmentScene.dispose();
  pmremGenerator.dispose();

  const camera = new THREE.PerspectiveCamera(45, 1, 0.05, 200);
  const controls = new OrbitControls(camera, canvas);
  controls.enableDamping = true;
  controls.minDistance = 1.2;
  controls.maxDistance = 5;
  controls.enablePan = false;

  scene.add(new THREE.HemisphereLight(0xc6dcff, 0x263047, 1.5));
  const keyLight = new THREE.DirectionalLight(0xffffff, 2.2);
  keyLight.position.set(2.5, 4.5, 2);
  keyLight.castShadow = true;
  scene.add(keyLight);
  const rimLight = new THREE.DirectionalLight(0x78bfff, 1.1);
  rimLight.position.set(-2.5, 2.5, -2);
  scene.add(rimLight);

  const ground = new THREE.Mesh(
    new THREE.CircleGeometry(3, 64),
    new THREE.MeshStandardMaterial({ color: 0x17243a, roughness: 0.95 }),
  );
  ground.rotation.x = -Math.PI / 2;
  ground.receiveShadow = true;
  scene.add(ground);

  hooks.onBusyChange?.(true);
  const avatar = await assembleSidekickCharacter(catalog, initialDefinition);
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
      hooks.onError?.(error);
    } finally {
      applying = false;
      hooks.onBusyChange?.(false);
      if (pendingDefinition && !disposed) void flushDefinitions();
    }
  };

  const resize = (): void => {
    const width = Math.max(1, canvas.clientWidth);
    const height = Math.max(1, canvas.clientHeight);
    renderer.setSize(width, height, false);
    camera.aspect = width / height;
    camera.updateProjectionMatrix();
  };
  const resizeObserver = new ResizeObserver(resize);
  resizeObserver.observe(canvas);
  resize();

  const clock = new THREE.Clock();
  let frame = 0;
  const render = (): void => {
    if (disposed) return;
    frame = requestAnimationFrame(render);
    animation?.update(clock.getDelta());
    controls.update();
    renderer.render(scene, camera);
  };
  render();
  hooks.onBusyChange?.(false);

  return {
    setAnimation: (clipName) => {
      desiredAnimation = clipName;
      animation?.setAnimation(clipName);
    },
    setDefinition: (definition) => {
      pendingDefinition = definition;
      void flushDefinitions();
    },
    dispose: () => {
      disposed = true;
      cancelAnimationFrame(frame);
      resizeObserver.disconnect();
      controls.dispose();
      animation?.dispose();
      avatar.dispose();
      environmentTarget.dispose();
      ground.geometry.dispose();
      (ground.material as THREE.Material).dispose();
      renderer.dispose();
    },
  };
}
