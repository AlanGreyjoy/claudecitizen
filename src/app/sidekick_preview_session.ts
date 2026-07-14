import * as THREE from 'three';
import { OrbitControls } from 'three/examples/jsm/controls/OrbitControls';
import { RoomEnvironment } from 'three/examples/jsm/environments/RoomEnvironment.js';
import { GLTFLoader } from 'three/examples/jsm/loaders/GLTFLoader';
import {
  buildDefaultDefinition,
  findPreviewSpecies,
  loadSidekickCatalog,
} from '../player/character_creator/sidekick_catalog';
import { createSidekickCreatorStore } from '../player/character_creator/sidekick_creator_store';
import { createSidekickCreatorUi } from './sidekick_creator_ui';
import { assembleSidekickCharacter } from '../render/characters/sidekick/assemble_avatar';
import {
  canRetargetUalToUnityHumanoid,
  findFirstSkinnedMesh,
  retargetUnityHumanoidAnimations,
  UNIVERSAL_ANIMATION_LIBRARY_URL,
} from '../render/characters/unity_humanoid_retarget';

const loader = new GLTFLoader();
const meshBoundsScratch = new THREE.Box3();

/**
 * Fit from authored geometry bounds instead of Box3.setFromObject's skinned
 * vertex path. During skeleton remapping, Three can briefly report enormous
 * posed bounds even though the exported geometry is correctly meter-scaled.
 * Using the stable local bounds keeps the initial camera usable while the
 * shared skeleton and morph state settle.
 */
function getVisibleGeometryBounds(root: THREE.Object3D): THREE.Box3 {
  const bounds = new THREE.Box3().makeEmpty();
  root.updateMatrixWorld(true);
  root.traverse((object) => {
    if (!(object instanceof THREE.Mesh) || !object.visible) return;
    if (!object.geometry.boundingBox) object.geometry.computeBoundingBox();
    if (!object.geometry.boundingBox) return;
    meshBoundsScratch.copy(object.geometry.boundingBox).applyMatrix4(object.matrixWorld);
    bounds.union(meshBoundsScratch);
  });
  return bounds.isEmpty() ? new THREE.Box3().setFromObject(root) : bounds;
}

function loadAnimationLibrary(): Promise<{
  scene: THREE.Object3D;
  animations: THREE.AnimationClip[];
}> {
  return new Promise((resolve, reject) => {
    loader.load(
      UNIVERSAL_ANIMATION_LIBRARY_URL,
      (gltf) => resolve({ scene: gltf.scene, animations: gltf.animations }),
      undefined,
      reject,
    );
  });
}

function requireElement<T extends HTMLElement>(id: string): T {
  const element = document.getElementById(id);
  if (!(element instanceof HTMLElement))
    throw new Error(`Missing #${id} element for Sidekick preview.`);
  return element as T;
}

function showPreviewShell(): HTMLCanvasElement {
  document.getElementById('title-screen')?.classList.add('is-hidden');
  document.getElementById('loading-screen')?.classList.add('is-hidden');
  requireElement<HTMLElement>('app').classList.remove('is-hidden');
  for (const selector of [
    '.sc-hud-minimap', '.sc-hud-chat', '.sc-hud-debug-wrap', '.hud',
    '#interact-prompt', '#flight-reticle', '#vegetation-menu', '#game-menu',
    '#avms-terminal', '#build-terminal', '#haloband',
  ]) {
    document.querySelector<HTMLElement>(selector)?.style.setProperty('display', 'none');
  }
  const canvas = requireElement<HTMLCanvasElement>('view');
  if (!(canvas instanceof HTMLCanvasElement))
    throw new Error('Missing #view canvas for Sidekick preview.');
  return canvas;
}

export async function startSidekickPreviewSession(): Promise<void> {
  const canvas = showPreviewShell();
  const renderer = new THREE.WebGLRenderer({ canvas, antialias: true });
  renderer.setPixelRatio(Math.min(window.devicePixelRatio, 2));
  renderer.setSize(window.innerWidth, window.innerHeight, false);
  renderer.shadowMap.enabled = true;
  renderer.outputColorSpace = THREE.SRGBColorSpace;
  renderer.toneMapping = THREE.ACESFilmicToneMapping;
  renderer.toneMappingExposure = 1.05;

  const scene = new THREE.Scene();
  scene.background = new THREE.Color(0x101826);
  // Sidekick's material atlas contains fully metallic cells. Direct lights do
  // not provide the reflected surroundings those surfaces need, so without an
  // environment map otherwise valid armor and attachments render nearly black.
  const environmentScene = new RoomEnvironment();
  const pmremGenerator = new THREE.PMREMGenerator(renderer);
  const environmentTarget = pmremGenerator.fromScene(environmentScene, 0.04);
  scene.environment = environmentTarget.texture;
  environmentScene.dispose();
  pmremGenerator.dispose();
  const camera = new THREE.PerspectiveCamera(45, window.innerWidth / window.innerHeight, 0.05, 200);
  camera.position.set(0, 1.55, 2.8);
  const controls = new OrbitControls(camera, canvas);
  controls.target.set(0, 1.2, 0);
  controls.enableDamping = true;
  controls.update();

  scene.add(new THREE.HemisphereLight(0xc6dcff, 0x263047, 1.5));
  const keyLight = new THREE.DirectionalLight(0xffffff, 2.2);
  keyLight.position.set(2.5, 4.5, 2.0);
  keyLight.castShadow = true;
  scene.add(keyLight);
  const rimLight = new THREE.DirectionalLight(0x78bfff, 1.1);
  rimLight.position.set(-2.5, 2.5, -2);
  scene.add(rimLight);

  const ground = new THREE.Mesh(
    new THREE.CircleGeometry(3, 64),
    new THREE.MeshStandardMaterial({ color: 0x1a2438, roughness: 0.95 }),
  );
  ground.rotation.x = -Math.PI / 2;
  ground.receiveShadow = true;
  scene.add(ground);

  const catalog = await loadSidekickCatalog();
  const species = findPreviewSpecies(catalog);
  if (!species)
    throw new Error('No playable species found in the Sidekick manifest.');
  const definition = buildDefaultDefinition(catalog, species);
  const store = createSidekickCreatorStore(catalog, definition);

  let avatar: Awaited<ReturnType<typeof assembleSidekickCharacter>> | null = null;
  const creatorUi = createSidekickCreatorUi(catalog, store, {
    getAvatarDiagnostics: () => avatar?.getDiagnostics() ?? null,
  });
  creatorUi.setStatus('Assembling character…');

  avatar = await assembleSidekickCharacter(catalog, definition);
  scene.add(avatar.root);
  const initialBox = getVisibleGeometryBounds(avatar.root);
  const size = initialBox.getSize(new THREE.Vector3());
  const center = initialBox.getCenter(new THREE.Vector3());
  const creatorBias = window.innerWidth > 760 ? -0.42 : 0;
  controls.target.copy(center).add(new THREE.Vector3(creatorBias, 0, 0));
  camera.position.set(
    center.x + creatorBias,
    center.y + size.y * 0.12,
    center.z + Math.max(2.2, size.y * 1.3),
  );
  controls.update();
  creatorUi.setStatus(`Ready · ${species.name} · ${definition.parts.length} parts`);

  let latestRevision = store.getState().revision;
  const unsubscribeStore = store.subscribe((state) => {
    if (!avatar || state.revision === latestRevision) return;
    latestRevision = state.revision;
    const revision = state.revision;
    creatorUi.setStatus(`Applying ${state.lastAction}…`);
    void avatar.applyDefinition(state.definition).then(() => {
      if (store.getState().revision !== revision) return;
      const diagnostics = avatar?.getDiagnostics();
      creatorUi.setStatus(
        `Ready · ${diagnostics?.activeParts ?? state.definition.parts.length} parts · ${diagnostics?.activeMeshes ?? 0} meshes`,
      );
      creatorUi.refreshDiagnostics();
    }).catch((error: unknown) => {
      console.error('Sidekick character update failed.', error);
      creatorUi.setStatus(error instanceof Error ? error.message : 'Character update failed.', true);
    });
  });

  let mixer: THREE.AnimationMixer | null = null;
  try {
    const animationLibrary = await loadAnimationLibrary();
    if (canRetargetUalToUnityHumanoid(avatar.root, animationLibrary.scene)) {
      const clips = retargetUnityHumanoidAnimations(
        avatar.root,
        animationLibrary.scene,
        animationLibrary.animations,
      );
      const idle = clips.find((clip) => clip.name === 'Idle_Loop') ?? clips[0];
      if (idle) {
        mixer = new THREE.AnimationMixer(findFirstSkinnedMesh(avatar.root) ?? avatar.root);
        mixer.clipAction(idle).play();
      }
    }
  } catch (error) {
    console.warn('Sidekick preview: animation retarget skipped.', error);
  }

  const onResize = (): void => {
    camera.aspect = window.innerWidth / window.innerHeight;
    camera.updateProjectionMatrix();
    renderer.setSize(window.innerWidth, window.innerHeight, false);
  };
  window.addEventListener('resize', onResize);

  const clock = new THREE.Clock();
  const fpsElement = requireElement<HTMLElement>('hud-fps-value');
  let fpsSeconds = 0;
  let fpsFrames = 0;
  let disposed = false;
  const animate = (): void => {
    if (disposed) return;
    requestAnimationFrame(animate);
    const delta = clock.getDelta();
    mixer?.update(delta);
    fpsSeconds += delta;
    fpsFrames += 1;
    if (fpsSeconds >= 0.5) {
      fpsElement.textContent = String(Math.round(fpsFrames / fpsSeconds));
      fpsSeconds = 0;
      fpsFrames = 0;
    }
    controls.update();
    renderer.render(scene, camera);
  };
  animate();

  window.addEventListener('beforeunload', () => {
    disposed = true;
    unsubscribeStore();
    window.removeEventListener('resize', onResize);
    creatorUi.dispose();
    avatar?.dispose();
    scene.environment = null;
    environmentTarget.dispose();
    ground.geometry.dispose();
    (ground.material as THREE.Material).dispose();
    renderer.dispose();
  }, { once: true });
}
