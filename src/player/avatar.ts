import * as THREE from 'three';
import { GLTFLoader } from 'three/examples/jsm/loaders/GLTFLoader';
import type { GLTF } from 'three/examples/jsm/loaders/GLTFLoader';
import { CHARACTER_GROUND_OFFSET_METERS } from './character_controller';
import type { CharacterRenderState, Vec3 } from '../types';

const AVATAR_URL = new URL(
  '../assets/universal-animation-library-1/Universal Animation Library[Standard]/Unreal-Godot/UAL1_Standard.glb',
  import.meta.url,
).href;

const ANIMATION_TIME_SCALE = 1.35;

const LOOPING_CLIPS = new Set([
  'Idle_Loop',
  'Jump_Loop',
  'Sprint_Loop',
  'Walk_Loop',
]);

interface CharacterAvatar {
  dispose: () => void;
  update: (
    character: CharacterRenderState | null | undefined,
    focusPosition: Vec3,
    nowSeconds: number,
  ) => void;
}

function clamp01(value: number): number {
  return Math.max(0, Math.min(1, value));
}

export function createCharacterAvatar(scene: THREE.Scene, renderScale: number): CharacterAvatar {
  const root = new THREE.Group();
  const modelOffset = new THREE.Group();
  root.visible = false;
  root.frustumCulled = false;
  scene.add(root);
  root.add(modelOffset);

  const loader = new GLTFLoader();
  const mixerClock: { lastNowSeconds: number | null } = { lastNowSeconds: null };
  let mixer: THREE.AnimationMixer | null = null;
  let activeAction: THREE.AnimationAction | null = null;
  let activeAnimation: string | null = null;
  let loadError: unknown = null;
  let modelOffsetY = -CHARACTER_GROUND_OFFSET_METERS * renderScale;
  const actions = new Map<string, THREE.AnimationAction>();
  const bbox = new THREE.Box3();

  loader.load(
    AVATAR_URL,
    (gltf: GLTF) => {
      const sceneRoot = gltf.scene;
      sceneRoot.scale.setScalar(renderScale);
      sceneRoot.traverse((object: THREE.Object3D) => {
        object.frustumCulled = false;
        if (object instanceof THREE.Mesh) {
          object.castShadow = true;
          object.receiveShadow = true;
        }
      });
      bbox.setFromObject(sceneRoot);
      modelOffsetY = -bbox.min.y - CHARACTER_GROUND_OFFSET_METERS * renderScale;
      modelOffset.add(sceneRoot);
      mixer = new THREE.AnimationMixer(sceneRoot);
      for (const clip of gltf.animations) {
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
    },
    undefined,
    (error: unknown) => {
      loadError = error;
      console.error('ClaudeCitizen avatar load failed.', error);
    },
  );

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

  function update(
    character: CharacterRenderState | null | undefined,
    focusPosition: Vec3,
    nowSeconds: number,
  ): void {
    if (!character || loadError) {
      root.visible = false;
      return;
    }
    root.visible = true;
    root.position.set(
      (character.position.x - focusPosition.x) * renderScale,
      (character.position.y - focusPosition.y) * renderScale,
      (character.position.z - focusPosition.z) * renderScale,
    );
    root.up.set(character.up.x, character.up.y, character.up.z);
    root.lookAt(
      root.position.x + character.forward.x * 8 * renderScale,
      root.position.y + character.forward.y * 8 * renderScale,
      root.position.z + character.forward.z * 8 * renderScale,
    );
    modelOffset.position.y = modelOffsetY;
    setAnimation(character.animation);
    if (mixer) {
      const dt =
        mixerClock.lastNowSeconds == null
          ? 0
          : clamp01(nowSeconds - mixerClock.lastNowSeconds) * ANIMATION_TIME_SCALE;
      mixer.update(dt);
    }
    mixerClock.lastNowSeconds = nowSeconds;
  }

  function dispose(): void {
    mixer?.stopAllAction();
    scene.remove(root);
  }

  return {
    dispose,
    update,
  };
}
