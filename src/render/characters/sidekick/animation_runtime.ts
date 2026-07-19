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
  activeClipName: string;
  playing: boolean;
  timeScale: number;
  sourceLabel: string;
  dispose: () => void;
  loadDefaultLibrary: () => Promise<void>;
  loadAnimationSource: (
    url: string,
    label?: string,
    yawOffsetDegrees?: number,
  ) => Promise<void>;
  setAnimation: (name: string, fadeSeconds?: number) => void;
  setPlaying: (playing: boolean) => void;
  setTimeScale: (scale: number) => void;
  update: (deltaSeconds: number) => void;
}

let animationLibraryPromise: Promise<AnimationLibraryAsset> | null = null;
const gltfLoader = new GLTFLoader();

function loadAnimationLibrary(): Promise<AnimationLibraryAsset> {
  if (!animationLibraryPromise) {
    const loading = new Promise<AnimationLibraryAsset>((resolve, reject) => {
      gltfLoader.load(
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

function loadGltf(url: string): Promise<AnimationLibraryAsset> {
  return new Promise((resolve, reject) => {
    gltfLoader.load(
      url,
      (gltf) => resolve({ scene: gltf.scene, animations: gltf.animations }),
      undefined,
      reject,
    );
  });
}

function isLoopingClip(name: string): boolean {
  if (LOOPING_CLIPS.has(name) || name.includes('_Loop') || /_loop$/i.test(name)) return true;
  // One-shots: deaths, jump takeoff/land, kneel transitions, in-place turns.
  if (/^death[_-]/i.test(name) || /headshot/i.test(name)) return false;
  if (/(?:^|_)jump(?:[_-]|$)/i.test(name) && !/_loop$/i.test(name)) return false;
  if (/stand_to_kneel|kneel_to_stand/i.test(name) || /turn_\d+/i.test(name)) return false;
  // UAL / Pro Rifle / handgun packs: idle*, walk*, run*, sprint*, strafe*.
  if (/(?:^|_)idle(?:[_-]|$)/i.test(name)) return true;
  if (/(?:^|_)(walk|run|sprint|strafe)(?:[_-]|$)/i.test(name)) return true;
  return false;
}

/** Rotate a clip's skeleton root so its measured travel axis matches gameplay +Z. */
function applyRootYawOffset(
  clips: readonly THREE.AnimationClip[],
  yawOffsetDegrees: number,
): THREE.AnimationClip[] {
  if (!Number.isFinite(yawOffsetDegrees) || Math.abs(yawOffsetDegrees) < 1e-4) {
    return [...clips];
  }
  const yaw = new THREE.Quaternion().setFromAxisAngle(
    new THREE.Vector3(0, 1, 0),
    THREE.MathUtils.degToRad(yawOffsetDegrees),
  );
  const value = new THREE.Quaternion();
  return clips.map((clip) => {
    const tracks = clip.tracks.map((track) => {
      if (
        !(track instanceof THREE.QuaternionKeyframeTrack)
        || track.name !== '.bones[root].quaternion'
      ) {
        return track;
      }
      const adjusted = track.clone();
      for (let offset = 0; offset < adjusted.values.length; offset += 4) {
        value.fromArray(adjusted.values, offset).premultiply(yaw).normalize();
        value.toArray(adjusted.values, offset);
      }
      return adjusted;
    });
    return new THREE.AnimationClip(clip.name, clip.duration, tracks).optimize();
  });
}

export async function createSidekickAnimationRuntime(
  target: THREE.Object3D,
): Promise<SidekickAnimationRuntime> {
  const mixerRoot = findFirstSkinnedMesh(target) ?? target;
  const mixer = new THREE.AnimationMixer(mixerRoot);
  const actions = new Map<string, THREE.AnimationAction>();
  let activeAction: THREE.AnimationAction | null = null;
  let activeName = '';
  let playing = true;
  let timeScale = 1;
  let sourceLabel = 'none';
  let clipNames: string[] = [];

  const refreshClipNames = (): void => {
    clipNames = [...actions.keys()].sort((a, b) => a.localeCompare(b));
  };

  const clearActions = (): void => {
    mixer.stopAllAction();
    for (const action of actions.values()) {
      mixer.uncacheAction(action.getClip(), mixerRoot);
    }
    actions.clear();
    activeAction = null;
    activeName = '';
    clipNames = [];
  };

  const registerClips = (clips: THREE.AnimationClip[], replaceAll: boolean): void => {
    if (replaceAll) clearActions();
    for (const clip of clips) {
      const existing = actions.get(clip.name);
      if (existing) {
        existing.stop();
        mixer.uncacheAction(existing.getClip(), mixerRoot);
      }
      const action = mixer.clipAction(clip);
      const looping = isLoopingClip(clip.name);
      action.setLoop(looping ? THREE.LoopRepeat : THREE.LoopOnce, looping ? Infinity : 1);
      action.clampWhenFinished = !looping;
      action.timeScale = timeScale;
      actions.set(clip.name, action);
    }
    refreshClipNames();
  };

  const setAnimation = (name: string, fadeSeconds = 0.16): void => {
    const next = actions.get(name) ?? (clipNames[0] ? actions.get(clipNames[0]) : undefined);
    if (!next) return;
    const nextName = next.getClip().name;
    if (activeName === nextName && next.isRunning()) return;
    next.reset().fadeIn(fadeSeconds).play();
    next.paused = !playing;
    next.timeScale = timeScale;
    activeAction?.fadeOut(fadeSeconds);
    activeAction = next;
    activeName = nextName;
  };

  const retargetFromAsset = (asset: AnimationLibraryAsset): THREE.AnimationClip[] => {
    const source = cloneSkinnedScene(asset.scene);
    if (!canRetargetUalToUnityHumanoid(target, source)) {
      throw new Error('Animation source rig is incompatible with this Sidekick character.');
    }
    if (asset.animations.length === 0) {
      throw new Error('Animation source has no clips.');
    }
    return retargetUnityHumanoidAnimations(target, source, asset.animations);
  };

  const loadDefaultLibrary = async (): Promise<void> => {
    const library = await loadAnimationLibrary();
    registerClips(retargetFromAsset(library), true);
    sourceLabel = 'UAL locomotion';
    const preferred = actions.has('Idle_Loop') ? 'Idle_Loop' : clipNames[0] ?? '';
    if (preferred) setAnimation(preferred, 0);
  };

  const loadAnimationSource = async (
    url: string,
    label?: string,
    yawOffsetDegrees = 0,
  ): Promise<void> => {
    const asset = await loadGltf(url);
    // Merge so UAL locomotion stays available beside Mixamo/combat packs.
    registerClips(
      applyRootYawOffset(retargetFromAsset(asset), yawOffsetDegrees),
      false,
    );
    const fileLabel = label ?? url.split(/[/?#]/).filter(Boolean).at(-1) ?? url;
    sourceLabel = sourceLabel === 'none' || sourceLabel === 'UAL locomotion'
      ? fileLabel
      : `${sourceLabel} + ${fileLabel}`;
    const preferred = asset.animations[0]?.name ?? clipNames[0] ?? '';
    if (preferred) setAnimation(preferred, 0);
  };

  await loadDefaultLibrary();

  return {
    get clipNames() {
      return clipNames;
    },
    get activeClipName() {
      return activeName;
    },
    get playing() {
      return playing;
    },
    get timeScale() {
      return timeScale;
    },
    get sourceLabel() {
      return sourceLabel;
    },
    loadDefaultLibrary,
    loadAnimationSource,
    setAnimation,
    setPlaying(nextPlaying: boolean) {
      playing = nextPlaying;
      if (activeAction) activeAction.paused = !playing;
    },
    setTimeScale(scale: number) {
      timeScale = Number.isFinite(scale) ? Math.max(0, Math.min(3, scale)) : 1;
      for (const action of actions.values()) action.timeScale = timeScale;
    },
    update: (deltaSeconds) => {
      if (!playing) return;
      mixer.update(Math.max(0, Math.min(1, deltaSeconds)));
    },
    dispose: () => {
      mixer.stopAllAction();
      mixer.uncacheRoot(mixerRoot);
      actions.clear();
      activeAction = null;
      activeName = '';
      clipNames = [];
    },
  };
}
