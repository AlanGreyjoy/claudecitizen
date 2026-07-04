import * as THREE from 'three';
import { GLTFLoader } from 'three/examples/jsm/loaders/GLTFLoader';
import type { GLTF } from 'three/examples/jsm/loaders/GLTFLoader';
import { clone as cloneSkinnedScene } from 'three/examples/jsm/utils/SkeletonUtils.js';
import { CHARACTER_GROUND_OFFSET_METERS } from '../../../player/character_controller';
import type { CharacterRenderState, Vec3 } from '../../../types';

const AVATAR_URL = new URL(
  '../../../assets/universal-animation-library-1/Universal Animation Library[Standard]/Unreal-Godot/UAL1_Standard.glb',
  import.meta.url,
).href;

export const CHARACTER_ANIMATION_TIME_SCALE = 1.35;

const LOOPING_CLIPS = new Set([
  'Idle_Loop',
  'Jump_Loop',
  'Sprint_Loop',
  'Walk_Loop',
]);

interface AvatarAsset {
  animations: THREE.AnimationClip[];
  template: THREE.Object3D;
}

export interface CharacterAvatarInstance {
  root: THREE.Group;
  dispose: () => void;
  getHeadBone: () => THREE.Object3D | null;
  hasLoadError: () => boolean;
  isReady: () => boolean;
  setAnimation: (name: string) => void;
  setPose: (character: CharacterRenderState, focusPosition: Vec3, renderScale: number) => void;
  updateMixer: (nowSeconds: number, timeScale?: number) => void;
}

let avatarAssetPromise: Promise<AvatarAsset> | null = null;
let avatarLoadError: unknown = null;

function clamp01(value: number): number {
  return Math.max(0, Math.min(1, value));
}

function prepareTemplateScene(sceneRoot: THREE.Object3D): void {
  sceneRoot.traverse((object: THREE.Object3D) => {
    object.frustumCulled = false;
    if (object instanceof THREE.Mesh) {
      object.castShadow = true;
      object.receiveShadow = true;
    }
  });
}

function loadAvatarAsset(): Promise<AvatarAsset> {
  if (avatarLoadError) return Promise.reject(avatarLoadError);
  if (!avatarAssetPromise) {
    avatarAssetPromise = new Promise((resolve, reject) => {
      const loader = new GLTFLoader();
      loader.load(
        AVATAR_URL,
        (gltf: GLTF) => {
          prepareTemplateScene(gltf.scene);
          resolve({
            animations: gltf.animations,
            template: gltf.scene,
          });
        },
        undefined,
        (error: unknown) => {
          avatarLoadError = error;
          avatarAssetPromise = null;
          console.error('ClaudeCitizen avatar load failed.', error);
          reject(error);
        },
      );
    });
  }
  return avatarAssetPromise;
}

export function createCharacterAvatarInstance(renderScale: number): CharacterAvatarInstance {
  const root = new THREE.Group();
  const modelOffset = new THREE.Group();
  root.frustumCulled = false;
  root.add(modelOffset);

  const mixerClock: { lastNowSeconds: number | null } = { lastNowSeconds: null };
  let mixer: THREE.AnimationMixer | null = null;
  let activeAction: THREE.AnimationAction | null = null;
  let activeAnimation: string | null = null;
  let headBone: THREE.Object3D | null = null;
  let ready = false;
  let loadError: unknown = null;
  let modelOffsetY = -CHARACTER_GROUND_OFFSET_METERS * renderScale;
  const actions = new Map<string, THREE.AnimationAction>();

  loadAvatarAsset()
    .then((asset) => {
      const sceneRoot = cloneSkinnedScene(asset.template);
      sceneRoot.scale.setScalar(renderScale);
      const bbox = new THREE.Box3().setFromObject(sceneRoot);
      modelOffsetY = -bbox.min.y - CHARACTER_GROUND_OFFSET_METERS * renderScale;
      headBone = sceneRoot.getObjectByName('Head') ?? null;
      modelOffset.add(sceneRoot);
      mixer = new THREE.AnimationMixer(sceneRoot);
      for (const clip of asset.animations) {
        const action = mixer.clipAction(clip);
        if (LOOPING_CLIPS.has(clip.name)) {
          action.setLoop(THREE.LoopRepeat, Infinity);
          action.clampWhenFinished = false;
        } else {
          action.setLoop(THREE.LoopOnce, 1);
          action.clampWhenFinished = true;
        }
        actions.set(clip.name, action);
      }
      const idle = actions.get('Idle_Loop');
      idle?.play();
      activeAction = idle ?? null;
      activeAnimation = idle ? 'Idle_Loop' : null;
      ready = true;
    })
    .catch((error: unknown) => {
      loadError = error;
    });

  function setAnimation(name: string): void {
    if (!mixer || !name || activeAnimation === name) return;
    const nextAction = actions.get(name);
    if (!nextAction) return;
    nextAction.reset();
    nextAction.enabled = true;
    nextAction.fadeIn(0.16);
    nextAction.play();
    activeAction?.fadeOut(0.16);
    activeAction = nextAction;
    activeAnimation = name;
  }

  function setPose(
    character: CharacterRenderState,
    focusPosition: Vec3,
    scale: number,
  ): void {
    root.position.set(
      (character.position.x - focusPosition.x) * scale,
      (character.position.y - focusPosition.y) * scale,
      (character.position.z - focusPosition.z) * scale,
    );
    root.up.set(character.up.x, character.up.y, character.up.z);
    root.lookAt(
      root.position.x + character.forward.x * 8 * scale,
      root.position.y + character.forward.y * 8 * scale,
      root.position.z + character.forward.z * 8 * scale,
    );
    modelOffset.position.y = modelOffsetY;
  }

  function updateMixer(nowSeconds: number, timeScale = CHARACTER_ANIMATION_TIME_SCALE): void {
    if (!mixer) return;
    const dt =
      mixerClock.lastNowSeconds == null
        ? 0
        : clamp01(nowSeconds - mixerClock.lastNowSeconds) * timeScale;
    mixer.update(dt);
    mixerClock.lastNowSeconds = nowSeconds;
  }

  function dispose(): void {
    mixer?.stopAllAction();
  }

  return {
    root,
    dispose,
    getHeadBone: () => headBone,
    hasLoadError: () => loadError !== null,
    isReady: () => ready,
    setAnimation,
    setPose,
    updateMixer,
  };
}
