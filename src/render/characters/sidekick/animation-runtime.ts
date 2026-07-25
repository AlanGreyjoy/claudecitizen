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

type LayerKind = 'full' | 'lower' | 'upper';

interface AnimationLibraryAsset {
  animations: THREE.AnimationClip[];
  scene: THREE.Object3D;
}

export interface SidekickAnimationRuntime {
  clipNames: string[];
  activeClipName: string;
  activeUpperClipName: string | null;
  playing: boolean;
  timeScale: number;
  sourceLabel: string;
  dispose: () => void;
  loadDefaultLibrary: () => Promise<void>;
  loadAnimationSource: (
    url: string,
    label?: string,
    yawOffsetDegrees?: number,
    options?: { activate?: boolean },
  ) => Promise<void>;
  setAnimation: (name: string, fadeSeconds?: number) => void;
  setUpperBodyAnimation: (name: string | null, fadeSeconds?: number) => void;
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
  if (/^death[_-]/i.test(name) || /headshot/i.test(name)) return false;
  if (/(?:^|_)jump(?:[_-]|$)/i.test(name) && !/_loop$/i.test(name)) return false;
  if (/stand_to_kneel|kneel_to_stand/i.test(name) || /turn_\d+/i.test(name)) return false;
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

function boneNameFromTrack(trackName: string): string | null {
  const match = /\.bones\[([^\]]+)\]/.exec(trackName);
  return match?.[1] ?? null;
}

/** Spine+/arms/head (and attach sockets) for the ADS override layer. */
function isUpperBodyBone(boneName: string): boolean {
  const n = boneName.toLowerCase();
  if (n === 'head' || n.startsWith('neck')) return true;
  if (n.startsWith('spine')) return true;
  if (
    n.startsWith('clavicle')
    || n.startsWith('upperarm')
    || n.startsWith('lowerarm')
    || n.startsWith('hand')
  ) {
    return true;
  }
  if (
    n.startsWith('thumb')
    || n.startsWith('index')
    || n.startsWith('middle')
    || n.startsWith('ring')
    || n.startsWith('pinky')
  ) {
    return true;
  }
  if (n.includes('attach') || n.includes('weapon') || n.includes('holster')) return true;
  return false;
}

/** Split a clip at spine_01 so lower locomotion and the authored ADS pose never double-drive bones. */
function maskClipToBodyLayer(
  clip: THREE.AnimationClip,
  layer: Exclude<LayerKind, 'full'>,
): THREE.AnimationClip {
  const tracks = clip.tracks.filter((track) => {
    const bone = boneNameFromTrack(track.name);
    if (!bone) return layer === 'lower';
    return layer === 'upper' ? isUpperBodyBone(bone) : !isUpperBodyBone(bone);
  });
  return new THREE.AnimationClip(`${clip.name}__${layer}`, clip.duration, tracks);
}

function actionKey(name: string, kind: LayerKind): string {
  if (kind === 'full') return name;
  return `${name}__${kind}`;
}

export async function createSidekickAnimationRuntime(
  target: THREE.Object3D,
): Promise<SidekickAnimationRuntime> {
  const mixerMesh = findFirstSkinnedMesh(target);
  const mixerRoot = mixerMesh ?? target;
  const mixer = new THREE.AnimationMixer(mixerRoot);
  const sourceClips = new Map<string, THREE.AnimationClip>();
  const maskedClips = new Map<string, THREE.AnimationClip>();
  const actions = new Map<string, THREE.AnimationAction>();
  const quaternionSamplers = new Map<
    string,
    ((timeSeconds: number, target: THREE.Quaternion) => THREE.Quaternion) | null
  >();

  const upperSpineBone = mixerMesh?.skeleton.getBoneByName('spine_01')
    ?? mixerMesh?.skeleton.getBoneByName('Spine_01')
    ?? null;
  const upperParentBones: THREE.Bone[] = [];
  let upperParent = upperSpineBone?.parent ?? null;
  while (upperParent instanceof THREE.Bone) {
    upperParentBones.unshift(upperParent);
    upperParent = upperParent.parent;
  }
  const upperParentRestQuaternions = new Map(
    upperParentBones.map((bone) => [bone.name, bone.quaternion.clone()]),
  );
  const currentUpperParentQuaternion = new THREE.Quaternion();
  const referenceUpperParentQuaternion = new THREE.Quaternion();
  const sampledParentQuaternion = new THREE.Quaternion();
  const upperParentCorrection = new THREE.Quaternion();
  const weightedUpperParentCorrection = new THREE.Quaternion();
  const uncompensatedUpperSpineQuaternion = new THREE.Quaternion();
  let upperParentCompensationApplied = false;

  let activeBaseAction: THREE.AnimationAction | null = null;
  let activeUpperAction: THREE.AnimationAction | null = null;
  let activeBaseName = '';
  let activeBaseLayer: Extract<LayerKind, 'full' | 'lower'> = 'full';
  let activeUpperName: string | null = null;
  let upperCorrectionAction: THREE.AnimationAction | null = null;
  let upperCorrectionClipName: string | null = null;
  let playing = true;
  let timeScale = 1;
  let sourceLabel = 'none';
  let clipNames: string[] = [];
  const pendingFadeStops: Array<{
    action: THREE.AnimationAction;
    remainingSeconds: number;
  }> = [];

  const quaternionSamplerFor = (
    clip: THREE.AnimationClip,
    boneName: string,
  ): ((timeSeconds: number, target: THREE.Quaternion) => THREE.Quaternion) | null => {
    const key = `${clip.uuid}:${boneName}`;
    if (quaternionSamplers.has(key)) return quaternionSamplers.get(key) ?? null;
    const track = clip.tracks.find((candidate): candidate is THREE.QuaternionKeyframeTrack =>
      candidate instanceof THREE.QuaternionKeyframeTrack
      && boneNameFromTrack(candidate.name) === boneName,
    );
    if (!track) {
      quaternionSamplers.set(key, null);
      return null;
    }
    const interpolant = track.InterpolantFactoryMethodLinear(new Float32Array(4));
    const firstTime = track.times[0] ?? 0;
    const lastTime = track.times[track.times.length - 1] ?? firstTime;
    const sampler = (timeSeconds: number, result: THREE.Quaternion): THREE.Quaternion => {
      const time = Math.max(firstTime, Math.min(lastTime, timeSeconds));
      return result.fromArray(interpolant.evaluate(time)).normalize();
    };
    quaternionSamplers.set(key, sampler);
    return sampler;
  };

  const restoreUpperParentCompensation = (): void => {
    if (!upperSpineBone || !upperParentCompensationApplied) return;
    upperSpineBone.quaternion.copy(uncompensatedUpperSpineQuaternion);
    upperParentCompensationApplied = false;
  };

  /**
   * Rifle gait clips animate root/pelvis in incompatible orientations. Keep
   * those transforms for the legs, then cancel them at spine_01 so the masked
   * torso retains the authored ADS parent space instead of looking down/left.
   */
  const applyUpperParentCompensation = (): void => {
    if (
      !upperSpineBone
      || upperParentBones.length === 0
      || !upperCorrectionAction
      || !upperCorrectionClipName
    ) {
      return;
    }
    const weight = THREE.MathUtils.clamp(upperCorrectionAction.getEffectiveWeight(), 0, 1);
    if (weight <= 1e-4) return;
    const referenceClip = sourceClips.get(upperCorrectionClipName);
    if (!referenceClip) return;

    currentUpperParentQuaternion.identity();
    referenceUpperParentQuaternion.identity();
    for (const bone of upperParentBones) {
      currentUpperParentQuaternion.multiply(bone.quaternion);
      const rest = upperParentRestQuaternions.get(bone.name);
      const sampler = quaternionSamplerFor(referenceClip, bone.name);
      if (sampler) {
        sampler(upperCorrectionAction.time, sampledParentQuaternion);
      } else if (rest) {
        sampledParentQuaternion.copy(rest);
      } else {
        sampledParentQuaternion.identity();
      }
      referenceUpperParentQuaternion.multiply(sampledParentQuaternion);
    }

    upperParentCorrection
      .copy(currentUpperParentQuaternion)
      .invert()
      .multiply(referenceUpperParentQuaternion)
      .normalize();
    weightedUpperParentCorrection.identity().slerp(upperParentCorrection, weight);
    uncompensatedUpperSpineQuaternion.copy(upperSpineBone.quaternion);
    upperParentCompensationApplied = true;
    upperSpineBone.quaternion.premultiply(weightedUpperParentCorrection).normalize();
  };

  const ensureLayerClip = (
    name: string,
    layer: Exclude<LayerKind, 'full'>,
  ): THREE.AnimationClip | null => {
    const key = actionKey(name, layer);
    const cached = maskedClips.get(key);
    if (cached) return cached;
    const source = sourceClips.get(name);
    if (!source) return null;
    const masked = maskClipToBodyLayer(source, layer);
    masked.name = key;
    if (masked.tracks.length === 0) return null;
    maskedClips.set(key, masked);
    return masked;
  };

  const actionFor = (name: string, kind: LayerKind): THREE.AnimationAction | null => {
    const key = actionKey(name, kind);
    const existing = actions.get(key);
    if (existing) return existing;
    const clip = kind === 'full' ? sourceClips.get(name) : ensureLayerClip(name, kind);
    if (!clip) return null;
    const action = mixer.clipAction(clip);
    const looping = isLoopingClip(name);
    action.setLoop(looping ? THREE.LoopRepeat : THREE.LoopOnce, looping ? Infinity : 1);
    action.clampWhenFinished = !looping;
    action.timeScale = timeScale;
    actions.set(key, action);
    return action;
  };

  const queueFadeStop = (action: THREE.AnimationAction, fadeSeconds: number): void => {
    if (fadeSeconds <= 0) {
      action.stop();
      return;
    }
    pendingFadeStops.push({ action, remainingSeconds: fadeSeconds });
  };

  const activateBase = (
    name: string,
    layer: Extract<LayerKind, 'full' | 'lower'>,
    fadeSeconds: number,
  ): boolean => {
    const next = actionFor(name, layer);
    if (!next) return false;
    if (next === activeBaseAction && next.isRunning()) {
      activeBaseName = name;
      activeBaseLayer = layer;
      return true;
    }

    const preservedTime = activeBaseAction && activeBaseName === name
      ? activeBaseAction.time
      : 0;
    next.reset();
    if (preservedTime > 0 && next.getClip().duration > 0) {
      next.time = preservedTime % next.getClip().duration;
    }
    next.enabled = true;
    next.paused = !playing;
    next.setEffectiveTimeScale(timeScale);
    next.setEffectiveWeight(1);
    next.play();
    if (activeBaseAction && fadeSeconds > 0 && activeBaseAction !== next) {
      activeBaseAction.enabled = true;
      next.crossFadeFrom(activeBaseAction, fadeSeconds, false);
      queueFadeStop(activeBaseAction, fadeSeconds);
    } else if (activeBaseAction && activeBaseAction !== next) {
      activeBaseAction.stop();
    }

    activeBaseAction = next;
    activeBaseName = name;
    activeBaseLayer = layer;
    return true;
  };

  const activateUpper = (name: string, fadeSeconds: number): boolean => {
    const next = actionFor(name, 'upper');
    if (!next) return false;
    if (next === activeUpperAction && next.isRunning()) {
      activeUpperName = name;
      return true;
    }

    next.reset();
    next.enabled = true;
    next.paused = !playing;
    next.setEffectiveTimeScale(timeScale);
    next.setEffectiveWeight(1);
    next.play();
    if (activeUpperAction && fadeSeconds > 0 && activeUpperAction !== next) {
      activeUpperAction.enabled = true;
      next.crossFadeFrom(activeUpperAction, fadeSeconds, false);
      queueFadeStop(activeUpperAction, fadeSeconds);
    } else if (activeUpperAction && activeUpperAction !== next) {
      activeUpperAction.stop();
    } else if (fadeSeconds > 0) {
      next.fadeIn(fadeSeconds);
    }

    activeUpperAction = next;
    activeUpperName = name;
    upperCorrectionAction = next;
    upperCorrectionClipName = name;
    return true;
  };

  const clearUpper = (fadeSeconds: number): void => {
    if (activeUpperAction) {
      if (fadeSeconds > 0) {
        activeUpperAction.fadeOut(fadeSeconds);
        queueFadeStop(activeUpperAction, fadeSeconds);
      } else {
        activeUpperAction.stop();
        if (upperCorrectionAction === activeUpperAction) {
          upperCorrectionAction = null;
          upperCorrectionClipName = null;
        }
      }
    }
    activeUpperAction = null;
    activeUpperName = null;
  };

  const clearActionKeysForClip = (name: string): void => {
    for (const kind of ['full', 'lower', 'upper'] as const) {
      const key = actionKey(name, kind);
      const action = actions.get(key);
      if (!action) continue;
      action.stop();
      mixer.uncacheAction(action.getClip(), mixerRoot);
      actions.delete(key);
      if (activeBaseAction === action) {
        activeBaseAction = null;
        activeBaseName = '';
        activeBaseLayer = 'full';
      }
      if (activeUpperAction === action) {
        activeUpperAction = null;
        activeUpperName = null;
      }
      if (upperCorrectionAction === action) {
        upperCorrectionAction = null;
        upperCorrectionClipName = null;
      }
    }
    maskedClips.delete(actionKey(name, 'lower'));
    maskedClips.delete(actionKey(name, 'upper'));
  };

  const clearActions = (): void => {
    restoreUpperParentCompensation();
    mixer.stopAllAction();
    for (const action of actions.values()) {
      mixer.uncacheAction(action.getClip(), mixerRoot);
    }
    actions.clear();
    sourceClips.clear();
    maskedClips.clear();
    quaternionSamplers.clear();
    pendingFadeStops.length = 0;
    activeBaseAction = null;
    activeUpperAction = null;
    activeBaseName = '';
    activeBaseLayer = 'full';
    activeUpperName = null;
    upperCorrectionAction = null;
    upperCorrectionClipName = null;
    clipNames = [];
  };

  const registerClips = (
    clips: THREE.AnimationClip[],
    replaceAll: boolean,
  ): void => {
    if (replaceAll) clearActions();
    for (const clip of clips) {
      if (sourceClips.has(clip.name)) clearActionKeysForClip(clip.name);
      sourceClips.set(clip.name, clip);
    }
    clipNames = [...sourceClips.keys()].sort((a, b) => a.localeCompare(b));
  };

  const setAnimation = (name: string, fadeSeconds = 0.16): void => {
    const nextName = sourceClips.has(name) ? name : clipNames[0];
    if (!nextName) return;
    activateBase(nextName, activeUpperAction ? 'lower' : 'full', fadeSeconds);
  };

  const setUpperBodyAnimation = (name: string | null, fadeSeconds = 0.16): void => {
    if (!name) {
      clearUpper(fadeSeconds);
      if (activeBaseName && activeBaseLayer !== 'full') {
        activateBase(activeBaseName, 'full', fadeSeconds);
      }
      return;
    }
    if (!sourceClips.has(name)) return;
    if (!activateUpper(name, fadeSeconds)) return;
    if (activeBaseName && activeBaseLayer !== 'lower') {
      activateBase(activeBaseName, 'lower', fadeSeconds);
    }
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
    const preferred = sourceClips.has('Idle_Loop') ? 'Idle_Loop' : clipNames[0] ?? '';
    if (preferred) setAnimation(preferred, 0);
  };

  const loadAnimationSource = async (
    url: string,
    label?: string,
    yawOffsetDegrees = 0,
    options?: { activate?: boolean },
  ): Promise<void> => {
    const asset = await loadGltf(url);
    const clips = applyRootYawOffset(retargetFromAsset(asset), yawOffsetDegrees);
    // Controller clipName / source.label is the gameplay key — force match when
    // a pack GLB ships a single clip under a mismatched or empty name.
    if (label && clips.length === 1 && clips[0] && clips[0].name !== label) {
      clips[0].name = label;
    }
    registerClips(clips, false);
    const fileLabel = label ?? url.split(/[/?#]/).filter(Boolean).at(-1) ?? url;
    sourceLabel = sourceLabel === 'none' || sourceLabel === 'UAL locomotion'
      ? fileLabel
      : `${sourceLabel} + ${fileLabel}`;
    if (options?.activate === false) return;
    const preferred = (label && sourceClips.has(label) ? label : null)
      ?? asset.animations[0]?.name
      ?? clipNames[0]
      ?? '';
    if (preferred) setAnimation(preferred, 0);
  };

  await loadDefaultLibrary();

  return {
    get clipNames() {
      return clipNames;
    },
    get activeClipName() {
      return activeBaseName;
    },
    get activeUpperClipName() {
      return activeUpperName;
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
    setUpperBodyAnimation,
    setPlaying(nextPlaying: boolean) {
      playing = nextPlaying;
      for (const action of actions.values()) {
        action.paused = !playing;
      }
    },
    setTimeScale(scale: number) {
      timeScale = Number.isFinite(scale) ? Math.max(0, Math.min(3, scale)) : 1;
      for (const action of actions.values()) {
        action.timeScale = timeScale;
      }
    },
    update(deltaSeconds: number) {
      if (!playing) return;
      const delta = Math.max(0, Math.min(1, deltaSeconds));
      // The mixer may skip unchanged tracks, so undo last frame's procedural
      // correction before asking it to apply the authored pose again.
      restoreUpperParentCompensation();
      mixer.update(delta);
      applyUpperParentCompensation();
      if (pendingFadeStops.length > 0) {
        for (let index = pendingFadeStops.length - 1; index >= 0; index -= 1) {
          const entry = pendingFadeStops[index]!;
          entry.remainingSeconds -= delta;
          if (entry.remainingSeconds > 0) continue;
          if (entry.action !== activeBaseAction && entry.action !== activeUpperAction) {
            entry.action.stop();
          }
          if (entry.action === upperCorrectionAction && entry.action !== activeUpperAction) {
            upperCorrectionAction = null;
            upperCorrectionClipName = null;
          }
          pendingFadeStops.splice(index, 1);
        }
      }
    },
    dispose() {
      clearActions();
      mixer.uncacheRoot(mixerRoot);
    },
  };
}
