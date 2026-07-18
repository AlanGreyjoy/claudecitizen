import * as THREE from 'three';
import { OrbitControls } from 'three/examples/jsm/controls/OrbitControls';
import { GLTFLoader, type GLTF } from 'three/examples/jsm/loaders/GLTFLoader';
import { clone as cloneSkinnedScene } from 'three/examples/jsm/utils/SkeletonUtils.js';
import { clearChildren, el } from '../../editor/dom';
import {
  canRetargetUalToUnityHumanoid,
  findFirstSkinnedMesh,
  retargetUnityHumanoidAnimations,
  UNIVERSAL_ANIMATION_LIBRARY_URL,
} from '../characters/unity_humanoid_retarget';
import { applyDefaultFrustumCulling } from '../frustum_policy';

export interface CharacterAnimationPreviewer {
  loadAnimationSource: (url: string) => Promise<void>;
  loadCharacter: (url: string) => Promise<void>;
  loadDefaultAnimations: () => Promise<void>;
  dispose: () => void;
}

const loader = new GLTFLoader();
const LOOP_CLIPS = new Set(['Idle_Loop', 'Jump_Loop', 'Sprint_Loop', 'Walk_Loop']);
const visibleBoxScratch = new THREE.Box3();

function loadGltf(url: string): Promise<GLTF> {
  return new Promise((resolve, reject) => {
    loader.load(url, resolve, undefined, reject);
  });
}

function fileLabel(url: string): string {
  const path = url.split(/[?#]/, 1)[0];
  const encoded = path.slice(path.lastIndexOf('/') + 1);
  try {
    return decodeURIComponent(encoded);
  } catch {
    return encoded;
  }
}

function modelBodyName(url: string): string {
  return fileLabel(url).replace(/\.(glb|gltf)$/i, '');
}

function isSelectedBodyMeshName(objectName: string, bodyName: string): boolean {
  return objectName === bodyName || objectName.startsWith(`${bodyName}_`);
}

function prepareCharacterScene(sceneRoot: THREE.Object3D, url: string): void {
  const visibleBodyName = modelBodyName(url);
  applyDefaultFrustumCulling(sceneRoot);
  sceneRoot.traverse((object: THREE.Object3D) => {
    if (object instanceof THREE.Mesh) {
      if (
        visibleBodyName.startsWith('SM_Chr_ScifiWorlds_') &&
        object.name.startsWith('SM_Chr_ScifiWorlds_')
      ) {
        object.visible = isSelectedBodyMeshName(object.name, visibleBodyName);
      }
      object.castShadow = true;
      object.receiveShadow = true;
    }
  });
}

function setVisibleMeshBox(root: THREE.Object3D, target: THREE.Box3): THREE.Box3 {
  target.makeEmpty();
  root.updateMatrixWorld(true);
  root.traverse((object: THREE.Object3D) => {
    if (!(object instanceof THREE.Mesh) || !object.visible) return;
    const geometry = object.geometry;
    if (!geometry.boundingBox) geometry.computeBoundingBox();
    if (!geometry.boundingBox) return;
    visibleBoxScratch.copy(geometry.boundingBox).applyMatrix4(object.matrixWorld);
    target.union(visibleBoxScratch);
  });
  if (target.isEmpty()) target.setFromObject(root);
  return target;
}

export function createCharacterAnimationPreviewer(
  container: HTMLElement,
): CharacterAnimationPreviewer {
  const canvasWrap = el('div', { className: 'ed-character-preview-canvas' });
  const clipSelect = el('select', {
    className: 'ed-select ed-character-preview-select',
    title: 'Animation clip',
  });
  const playBtn = el('button', {
    className: 'ed-btn',
    text: 'Pause',
    title: 'Play or pause',
  });
  const speedInput = el('input', {
    className: 'ed-character-preview-speed',
    title: 'Playback speed',
    attrs: {
      type: 'range',
      min: '0',
      max: '2',
      step: '0.05',
      value: '1',
    },
  });
  const defaultAnimBtn = el('button', {
    className: 'ed-btn',
    text: 'UAL',
    title: 'Use Universal Animation Library locomotion clips',
  });
  const characterLabel = el('div', {
    className: 'ed-character-preview-source',
    text: 'Character: none',
  });
  const animationLabel = el('div', {
    className: 'ed-character-preview-source',
    text: 'Animations: none',
  });
  const status = el('div', {
    className: 'ed-character-preview-status',
    text: 'Choose a model as Character, then choose a model as Anims.',
  });

  container.append(
    el('div', { className: 'ed-character-preview-toolbar' }, [
      el('span', { className: 'ed-label', text: 'Clip' }),
      clipSelect,
      playBtn,
      el('span', { className: 'ed-label', text: 'Speed' }),
      speedInput,
      defaultAnimBtn,
    ]),
    canvasWrap,
    el('div', { className: 'ed-character-preview-meta' }, [
      characterLabel,
      animationLabel,
      status,
    ]),
  );

  const canvas = document.createElement('canvas');
  canvasWrap.append(canvas);

  const renderer = new THREE.WebGLRenderer({ canvas, antialias: true });
  renderer.setPixelRatio(Math.min(window.devicePixelRatio, 2));
  renderer.outputColorSpace = THREE.SRGBColorSpace;

  const scene = new THREE.Scene();
  scene.background = new THREE.Color(0x090f1c);
  scene.add(new THREE.HemisphereLight(0xbcd4ff, 0x151a27, 1.2));
  const key = new THREE.DirectionalLight(0xffffff, 2.4);
  key.position.set(4, 8, 5);
  scene.add(key);
  const fill = new THREE.DirectionalLight(0x7db8ff, 0.65);
  fill.position.set(-5, 3, -4);
  scene.add(fill);

  const floor = new THREE.GridHelper(8, 16, 0x34527c, 0x18243c);
  (floor.material as THREE.Material).transparent = true;
  (floor.material as THREE.Material).opacity = 0.62;
  scene.add(floor);

  const modelRoot = new THREE.Group();
  scene.add(modelRoot);

  const camera = new THREE.PerspectiveCamera(48, 1, 0.03, 200);
  camera.position.set(0, 1.6, 4);
  const orbit = new OrbitControls(camera, canvas);
  orbit.enableDamping = true;
  orbit.dampingFactor = 0.12;
  orbit.target.set(0, 1, 0);

  let characterScene: THREE.Object3D | null = null;
  let characterUrl: string | null = null;
  let animationSource: { clips: THREE.AnimationClip[]; scene: THREE.Object3D; url: string } | null =
    null;
  let mixer: THREE.AnimationMixer | null = null;
  let activeAction: THREE.AnimationAction | null = null;
  let activeClips: THREE.AnimationClip[] = [];
  let activeClipName: string | null = null;
  let playing = true;
  let disposed = false;
  let lastNow = performance.now();

  function setStatus(message: string, isError = false): void {
    status.textContent = message;
    status.classList.toggle('is-error', isError);
  }

  function disposeObject(root: THREE.Object3D): void {
    root.traverse((object: THREE.Object3D) => {
      if (object instanceof THREE.Mesh) {
        object.geometry.dispose();
        if (Array.isArray(object.material)) {
          for (const material of object.material) material.dispose();
        } else {
          object.material.dispose();
        }
      }
    });
  }

  function resize(): void {
    const rect = canvasWrap.getBoundingClientRect();
    const width = Math.max(1, Math.floor(rect.width));
    const height = Math.max(1, Math.floor(rect.height));
    if (canvas.width === width && canvas.height === height) return;
    renderer.setSize(width, height, false);
    camera.aspect = width / height;
    camera.updateProjectionMatrix();
  }

  function fitCamera(): void {
    if (!characterScene) return;
    const box = setVisibleMeshBox(characterScene, new THREE.Box3());
    const size = box.getSize(new THREE.Vector3());
    const height = Math.max(1.4, size.y);
    const radius = Math.max(1.5, Math.max(size.x, size.z) * 1.35, height * 0.95);
    orbit.target.set(0, height * 0.52, 0);
    camera.position.set(0, height * 0.55, radius);
    camera.near = Math.max(0.02, radius / 100);
    camera.far = Math.max(80, radius * 40);
    camera.updateProjectionMatrix();
    orbit.update();
  }

  function normalizeCharacterScene(): void {
    if (!characterScene) return;
    const box = setVisibleMeshBox(characterScene, new THREE.Box3());
    const center = box.getCenter(new THREE.Vector3());
    characterScene.position.x -= center.x;
    characterScene.position.y -= box.min.y;
    characterScene.position.z -= center.z;
  }

  function setClipOptions(clips: THREE.AnimationClip[]): void {
    clearChildren(clipSelect);
    for (const clip of clips) {
      clipSelect.append(el('option', { text: clip.name, attrs: { value: clip.name } }));
    }
    clipSelect.disabled = clips.length === 0;
  }

  function stopMixer(): void {
    activeAction?.stop();
    mixer?.stopAllAction();
    activeAction = null;
    activeClips = [];
    activeClipName = null;
    mixer = null;
  }

  function playClip(name: string): void {
    if (!mixer || activeClipName === name) return;
    const clip = activeClips.find((candidate) => candidate.name === name);
    if (!clip) return;
    const action = mixer.clipAction(clip);
    action.reset();
    action.enabled = true;
    action.clampWhenFinished = !LOOP_CLIPS.has(clip.name);
    action.timeScale = Number((speedInput as HTMLInputElement).value);
    action.setLoop(LOOP_CLIPS.has(clip.name) ? THREE.LoopRepeat : THREE.LoopOnce, LOOP_CLIPS.has(clip.name) ? Infinity : 1);
    action.fadeIn(0.12);
    action.play();
    activeAction?.fadeOut(0.12);
    activeAction = action;
    activeClipName = clip.name;
  }

  function rebuildAnimationActions(): void {
    stopMixer();
    if (!characterScene || !animationSource) return;

    let clips = animationSource.clips;
    let mixerRoot: THREE.Object3D = characterScene;
    const targetSkinnedMesh = findFirstSkinnedMesh(characterScene);
    if (
      targetSkinnedMesh &&
      canRetargetUalToUnityHumanoid(characterScene, animationSource.scene)
    ) {
      clips = retargetUnityHumanoidAnimations(
        characterScene,
        animationSource.scene,
        animationSource.clips,
      );
      mixerRoot = targetSkinnedMesh;
      setStatus(`Retargeted ${clips.length} clip(s) onto ${fileLabel(characterUrl ?? '')}.`);
    } else {
      setStatus(`Loaded ${clips.length} direct clip(s).`);
    }

    mixer = new THREE.AnimationMixer(mixerRoot);
    activeClips = clips;
    for (const clip of clips) {
      const action = mixer.clipAction(clip);
      action.enabled = true;
    }
    setClipOptions(clips);
    const firstLoop = clips.find((clip) => LOOP_CLIPS.has(clip.name));
    const firstClip = firstLoop ?? clips[0];
    if (firstClip) {
      clipSelect.value = firstClip.name;
      playClip(firstClip.name);
    }
  }

  async function loadCharacter(url: string): Promise<void> {
    setStatus(`Loading ${fileLabel(url)}...`);
    const gltf = await loadGltf(url);
    stopMixer();
    if (characterScene) {
      modelRoot.remove(characterScene);
      disposeObject(characterScene);
    }
    characterUrl = url;
    characterScene = cloneSkinnedScene(gltf.scene);
    prepareCharacterScene(characterScene, url);
    modelRoot.add(characterScene);
    normalizeCharacterScene();
    fitCamera();
    characterLabel.textContent = `Character: ${fileLabel(url)}`;
    if (!animationSource && gltf.animations.length > 0) {
      animationSource = { clips: gltf.animations, scene: gltf.scene, url };
      animationLabel.textContent = `Animations: ${fileLabel(url)}`;
    }
    rebuildAnimationActions();
    if (!animationSource) setStatus('Character loaded. Choose animation clips to test it.');
  }

  async function loadAnimationSource(url: string): Promise<void> {
    setStatus(`Loading animations from ${fileLabel(url)}...`);
    const gltf = await loadGltf(url);
    if (gltf.animations.length === 0) {
      setStatus(`${fileLabel(url)} has no animation clips.`, true);
      return;
    }
    animationSource = { clips: gltf.animations, scene: gltf.scene, url };
    animationLabel.textContent = `Animations: ${fileLabel(url)}`;
    rebuildAnimationActions();
  }

  async function loadDefaultAnimations(): Promise<void> {
    await loadAnimationSource(UNIVERSAL_ANIMATION_LIBRARY_URL);
  }

  clipSelect.addEventListener('change', () => {
    playClip(clipSelect.value);
  });
  playBtn.addEventListener('click', () => {
    playing = !playing;
    playBtn.textContent = playing ? 'Pause' : 'Play';
  });
  speedInput.addEventListener('input', () => {
    const speed = Number((speedInput as HTMLInputElement).value);
    if (activeAction) activeAction.timeScale = speed;
  });
  defaultAnimBtn.addEventListener('click', () => {
    void loadDefaultAnimations().catch((error) => {
      setStatus((error as Error).message, true);
    });
  });

  function tick(now: number): void {
    if (disposed) return;
    const dt = Math.min(0.05, (now - lastNow) / 1000);
    lastNow = now;
    resize();
    orbit.update();
    if (playing && mixer) mixer.update(dt);
    renderer.render(scene, camera);
    requestAnimationFrame(tick);
  }
  requestAnimationFrame(tick);

  return {
    loadAnimationSource,
    loadCharacter,
    loadDefaultAnimations,
    dispose() {
      disposed = true;
      stopMixer();
      if (characterScene) disposeObject(characterScene);
      renderer.dispose();
    },
  };
}
