import * as THREE from 'three';
import { GLTFLoader } from 'three/examples/jsm/loaders/GLTFLoader';
import { clone as cloneSkinnedScene } from 'three/examples/jsm/utils/SkeletonUtils.js';
import {
  canRetargetUalToUnityHumanoid,
  findFirstSkinnedMesh,
  retargetUnityHumanoidAnimations,
  UNIVERSAL_ANIMATION_LIBRARY_URL,
  UNIVERSAL_ANIMATION_LIBRARY_URLS,
} from '../unity-humanoid-retarget';
import { createUpperParentCompensation } from './upper-parent-compensation';

const LOOPING_CLIPS = new Set(['Idle_Loop', 'Jump_Loop', 'Sprint_Loop', 'Walk_Loop']);

type LayerKind = 'full' | 'lower' | 'upper';

interface AnimationLibraryAsset {
  animations: THREE.AnimationClip[];
  scene: THREE.Object3D;
}

export interface SidekickAnimationClipPack {
  /** Display label for the loaded GLB / library (e.g. `ProRifle/idle`, `UAL1_Standard`). */
  label: string;
  clipNames: string[];
}

export interface SidekickAnimationRuntime {
  clipNames: string[];
  /** Clips grouped by the pack/file they were loaded from (load order). */
  clipPacks: SidekickAnimationClipPack[];
  activeClipName: string;
  activeUpperClipName: string | null;
  playing: boolean;
  timeScale: number;
  sourceLabel: string;
  /** Project (or absolute) URL the named clip was loaded from, if any. */
  getClipSourceUrl: (clipName: string) => string | null;
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
    // Projects place the licensed pack under different folder names, so every
    // candidate is tried before this is treated as a missing pack.
    const loading = (async () => {
      let lastError: unknown = null;
      for (const url of UNIVERSAL_ANIMATION_LIBRARY_URLS) {
        try {
          return await loadGltf(url);
        } catch (error: unknown) {
          lastError = error;
        }
      }
      throw lastError ?? new Error('No animation library URL was provided.');
    })().catch((error: unknown) => {
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

function preferredClipName(
  label: string | undefined,
  known: ReadonlyMap<string, THREE.AnimationClip>,
  clipNames: readonly string[],
): string {
  if (label && known.has(label)) return label;
  return clipNames[0] ?? '';
}

/** Force a single exported clip to match the controller / source label. */
function renameSoleClipToLabel(clips: THREE.AnimationClip[], label: string | undefined): void {
  if (!label || clips.length !== 1 || !clips[0] || clips[0].name === label) return;
  clips[0].name = label;
}

function appendLoadedSourceLabel(current: string, fileLabel: string): string {
  if (current === 'none' || current === 'UAL locomotion') return fileLabel;
  return `${current} + ${fileLabel}`;
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
  const upperParentCompensation = createUpperParentCompensation(mixerMesh, sourceClips);

  let activeBaseAction: THREE.AnimationAction | null = null;
  let activeUpperAction: THREE.AnimationAction | null = null;
  let activeBaseName = '';
  let activeBaseLayer: Extract<LayerKind, 'full' | 'lower'> = 'full';
  let activeUpperName: string | null = null;
  let playing = true;
  let timeScale = 1;
  let sourceLabel = 'none';
  let clipNames: string[] = [];
  let clipPacks: SidekickAnimationClipPack[] = [];
  /** clip name → pack label for the load that currently owns that clip. */
  const clipPackByName = new Map<string, string>();
  /** clip name → source URL used to load it (blob: for file picker). */
  const clipSourceUrlByName = new Map<string, string>();
  /** URLs already fetched into this runtime (skip re-network). */
  const loadedSourceUrls = new Set<string>();
  /** In-flight loads keyed by URL so concurrent callers share one fetch. */
  const sourceLoadInFlight = new Map<string, Promise<void>>();
  const packLoadOrder: string[] = [];
  const pendingFadeStops: Array<{
    action: THREE.AnimationAction;
    remainingSeconds: number;
  }> = [];

  const rebuildClipIndex = (): void => {
    clipNames = [...sourceClips.keys()].sort((a, b) => a.localeCompare(b));
    const byPack = new Map<string, string[]>();
    for (const name of clipNames) {
      const pack = clipPackByName.get(name) ?? 'Loaded';
      const list = byPack.get(pack);
      if (list) list.push(name);
      else byPack.set(pack, [name]);
    }
    const ordered = packLoadOrder.filter((pack) => byPack.has(pack));
    for (const pack of byPack.keys()) {
      if (!ordered.includes(pack)) ordered.push(pack);
    }
    clipPacks = ordered.map((label) => ({
      label,
      clipNames: byPack.get(label) ?? [],
    }));
  };

  const rememberPack = (packLabel: string): void => {
    if (!packLoadOrder.includes(packLabel)) packLoadOrder.push(packLabel);
  };

  const packLabelForUrl = (url: string, explicit?: string): string => {
    if (explicit && !/\.(glb|gltf)$/i.test(explicit)) return explicit;
    try {
      const path = decodeURIComponent((url.split(/[?#]/)[0] ?? url));
      const parts = path.split('/').filter(Boolean);
      const file = (parts.at(-1) ?? path).replace(/\.(glb|gltf)$/i, '');
      const folder = parts.at(-2);
      if (folder && folder !== 'assets' && folder !== 'animations') {
        return `${folder}/${file}`;
      }
      return file || explicit || url;
    } catch {
      return explicit || url;
    }
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
    upperParentCompensation.setCorrection(next, name);
    return true;
  };

  const clearUpper = (fadeSeconds: number): void => {
    if (activeUpperAction) {
      if (fadeSeconds > 0) {
        activeUpperAction.fadeOut(fadeSeconds);
        queueFadeStop(activeUpperAction, fadeSeconds);
      } else {
        activeUpperAction.stop();
        if (upperParentCompensation.getCorrectionAction() === activeUpperAction) {
          upperParentCompensation.setCorrection(null, null);
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
      if (upperParentCompensation.getCorrectionAction() === action) {
        upperParentCompensation.setCorrection(null, null);
      }
    }
    maskedClips.delete(actionKey(name, 'lower'));
    maskedClips.delete(actionKey(name, 'upper'));
  };

  const clearActions = (): void => {
    upperParentCompensation.restore();
    mixer.stopAllAction();
    for (const action of actions.values()) {
      mixer.uncacheAction(action.getClip(), mixerRoot);
    }
    actions.clear();
    sourceClips.clear();
    maskedClips.clear();
    upperParentCompensation.clearSamplers();
    pendingFadeStops.length = 0;
    activeBaseAction = null;
    activeUpperAction = null;
    activeBaseName = '';
    activeBaseLayer = 'full';
    activeUpperName = null;
    upperParentCompensation.setCorrection(null, null);
    clipNames = [];
    clipPacks = [];
    clipPackByName.clear();
    clipSourceUrlByName.clear();
    loadedSourceUrls.clear();
    sourceLoadInFlight.clear();
    packLoadOrder.length = 0;
  };

  const registerClips = (
    clips: THREE.AnimationClip[],
    replaceAll: boolean,
    packLabel: string,
    sourceUrl: string,
  ): void => {
    if (replaceAll) clearActions();
    rememberPack(packLabel);
    for (const clip of clips) {
      if (sourceClips.has(clip.name)) clearActionKeysForClip(clip.name);
      sourceClips.set(clip.name, clip);
      clipPackByName.set(clip.name, packLabel);
      clipSourceUrlByName.set(clip.name, sourceUrl);
    }
    rebuildClipIndex();
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

  /**
   * Optional convenience pack. Controllers + gameplay load project GLBs via
   * `loadAnimationSource` — runtime creation must not depend on UAL existing.
   */
  const loadDefaultLibrary = async (): Promise<void> => {
    const library = await loadAnimationLibrary();
    registerClips(
      retargetFromAsset(library),
      true,
      'UAL locomotion',
      UNIVERSAL_ANIMATION_LIBRARY_URL,
    );
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
    const activate = options?.activate !== false;
    const activatePreferred = (): void => {
      if (!activate) return;
      const preferred = preferredClipName(label, sourceClips, clipNames);
      if (preferred) setAnimation(preferred, 0);
    };

    if (loadedSourceUrls.has(url)) {
      activatePreferred();
      return;
    }
    const existing = sourceLoadInFlight.get(url);
    if (existing) {
      await existing;
      activatePreferred();
      return;
    }

    const loading = (async () => {
      const asset = await loadGltf(url);
      const clips = applyRootYawOffset(retargetFromAsset(asset), yawOffsetDegrees);
      renameSoleClipToLabel(clips, label);
      const packLabel = packLabelForUrl(url, label);
      registerClips(clips, false, packLabel, url);
      loadedSourceUrls.add(url);
      sourceLabel = appendLoadedSourceLabel(sourceLabel, packLabel);
    })();
    sourceLoadInFlight.set(url, loading);
    try {
      await loading;
    } finally {
      sourceLoadInFlight.delete(url);
    }
    activatePreferred();
  };

  // Empty mixer is valid: clip GLBs come from the open project / controller
  // sources. Do not hard-require a protected UAL pack at create time.
  return {
    get clipNames() {
      return clipNames;
    },
    get clipPacks() {
      return clipPacks;
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
    getClipSourceUrl(clipName: string) {
      return clipSourceUrlByName.get(clipName) ?? null;
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
      upperParentCompensation.restore();
      mixer.update(delta);
      upperParentCompensation.apply();
      if (pendingFadeStops.length > 0) {
        for (let index = pendingFadeStops.length - 1; index >= 0; index -= 1) {
          const entry = pendingFadeStops[index]!;
          entry.remainingSeconds -= delta;
          if (entry.remainingSeconds > 0) continue;
          if (entry.action !== activeBaseAction && entry.action !== activeUpperAction) {
            entry.action.stop();
          }
          if (entry.action === upperParentCompensation.getCorrectionAction() && entry.action !== activeUpperAction) {
            upperParentCompensation.setCorrection(null, null);
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
