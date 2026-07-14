import * as THREE from 'three';
import { GLTFLoader } from 'three/examples/jsm/loaders/GLTFLoader';
import { clone as cloneSkinnedScene } from 'three/examples/jsm/utils/SkeletonUtils.js';
import {
  canRetargetUalToUnityHumanoid,
  findFirstSkinnedMesh,
  retargetUnityHumanoidAnimations,
  UNIVERSAL_ANIMATION_LIBRARY_URL,
} from '../unity_humanoid_retarget';

const LOOPING_CLIPS = new Set(['Idle_Loop', 'Jump_Loop', 'Sprint_Loop', 'Walk_Loop']);

interface AnimationLibraryAsset {
  animations: THREE.AnimationClip[];
  scene: THREE.Object3D;
}

export interface SidekickAnimationRuntime {
  clipNames: string[];
  dispose: () => void;
  setAnimation: (name: string, fadeSeconds?: number) => void;
  update: (deltaSeconds: number) => void;
}

let animationLibraryPromise: Promise<AnimationLibraryAsset> | null = null;

function loadAnimationLibrary(): Promise<AnimationLibraryAsset> {
  if (!animationLibraryPromise) {
    const loading = new Promise<AnimationLibraryAsset>((resolve, reject) => {
      new GLTFLoader().load(
        UNIVERSAL_ANIMATION_LIBRARY_URL,
        (gltf) => resolve({ scene: gltf.scene, animations: gltf.animations }),
        undefined,
        reject,
      );
    }).catch((error: unknown) => {
      animationLibraryPromise = null;
      throw error;
    });
    animationLibraryPromise = loading;
  }
  return animationLibraryPromise;
}

export async function createSidekickAnimationRuntime(
  target: THREE.Object3D,
): Promise<SidekickAnimationRuntime> {
  const library = await loadAnimationLibrary();
  const source = cloneSkinnedScene(library.scene);
  if (!canRetargetUalToUnityHumanoid(target, source)) {
    throw new Error('Animation library rig is incompatible with this character.');
  }
  const clips = retargetUnityHumanoidAnimations(target, source, library.animations);
  const mixerRoot = findFirstSkinnedMesh(target) ?? target;
  const mixer = new THREE.AnimationMixer(mixerRoot);
  const actions = new Map<string, THREE.AnimationAction>();
  for (const clip of clips) {
    const action = mixer.clipAction(clip);
    const looping = LOOPING_CLIPS.has(clip.name) || clip.name.includes('_Loop');
    action.setLoop(looping ? THREE.LoopRepeat : THREE.LoopOnce, looping ? Infinity : 1);
    action.clampWhenFinished = !looping;
    actions.set(clip.name, action);
  }

  let activeAction: THREE.AnimationAction | null = null;
  let activeName = '';
  const setAnimation = (name: string, fadeSeconds = 0.16): void => {
    const next = actions.get(name) ?? actions.get('Idle_Loop');
    if (!next || activeName === next.getClip().name) return;
    next.reset().fadeIn(fadeSeconds).play();
    activeAction?.fadeOut(fadeSeconds);
    activeAction = next;
    activeName = next.getClip().name;
  };
  setAnimation(actions.has('Idle_Loop') ? 'Idle_Loop' : clips[0]?.name ?? '', 0);

  return {
    clipNames: clips.map((clip) => clip.name),
    setAnimation,
    update: (deltaSeconds) => mixer.update(Math.max(0, Math.min(1, deltaSeconds))),
    dispose: () => {
      mixer.stopAllAction();
      mixer.uncacheRoot(mixerRoot);
    },
  };
}
