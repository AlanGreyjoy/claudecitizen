import * as THREE from 'three';
import { retargetClip } from 'three/examples/jsm/utils/SkeletonUtils.js';

export const UNIVERSAL_ANIMATION_LIBRARY_URL = new URL(
  '../../assets/universal-animation-library-1/Universal Animation Library[Standard]/Unreal-Godot/UAL1_Standard.glb',
  import.meta.url,
).href;

export const UNITY_HUMANOID_TO_UAL_BONES: Record<string, string> = {
  Hips: 'pelvis',
  Spine_01: 'spine_01',
  Spine_02: 'spine_02',
  Spine_03: 'spine_03',
  Neck: 'neck_01',
  Head: 'Head',
  Clavicle_L: 'clavicle_l',
  Shoulder_L: 'upperarm_l',
  Elbow_L: 'lowerarm_l',
  Hand_L: 'hand_l',
  Thumb_01: 'thumb_01_l',
  Thumb_02: 'thumb_02_l',
  Thumb_03: 'thumb_03_l',
  IndexFinger_01: 'index_01_l',
  IndexFinger_02: 'index_02_l',
  IndexFinger_03: 'index_03_l',
  Finger_01: 'middle_01_l',
  Finger_02: 'middle_02_l',
  Finger_03: 'middle_03_l',
  Clavicle_R: 'clavicle_r',
  Shoulder_R: 'upperarm_r',
  Elbow_R: 'lowerarm_r',
  Hand_R: 'hand_r',
  'Thumb_01 1': 'thumb_01_r',
  'Thumb_02 1': 'thumb_02_r',
  'Thumb_03 1': 'thumb_03_r',
  'IndexFinger_01 1': 'index_01_r',
  'IndexFinger_02 1': 'index_02_r',
  'IndexFinger_03 1': 'index_03_r',
  'Finger_01 1': 'middle_01_r',
  'Finger_02 1': 'middle_02_r',
  'Finger_03 1': 'middle_03_r',
  UpperLeg_L: 'thigh_l',
  LowerLeg_L: 'calf_l',
  Ankle_L: 'foot_l',
  Ball_L: 'ball_l',
  UpperLeg_R: 'thigh_r',
  LowerLeg_R: 'calf_r',
  Ankle_R: 'foot_r',
  Ball_R: 'ball_r',
};

/** Mixamo/UnityGLTF often collapses spaced right-hand names to Thumb_011. */
const UNITY_SOURCE_NAME_ALIASES: Record<string, readonly string[]> = {
  'Thumb_01 1': ['Thumb_011', 'Thumb_01 1'],
  'Thumb_02 1': ['Thumb_021', 'Thumb_02 1'],
  'Thumb_03 1': ['Thumb_031', 'Thumb_03 1'],
  'IndexFinger_01 1': ['IndexFinger_011', 'IndexFinger_01 1'],
  'IndexFinger_02 1': ['IndexFinger_021', 'IndexFinger_02 1'],
  'IndexFinger_03 1': ['IndexFinger_031', 'IndexFinger_03 1'],
  'Finger_01 1': ['Finger_011', 'Finger_01 1'],
  'Finger_02 1': ['Finger_021', 'Finger_02 1'],
  'Finger_03 1': ['Finger_031', 'Finger_03 1'],
};

function resolveSourceBoneName(
  preferred: string,
  sourceNames: ReadonlySet<string>,
): string | null {
  if (sourceNames.has(preferred)) return preferred;
  const aliases = UNITY_SOURCE_NAME_ALIASES[preferred];
  if (aliases) {
    for (const alias of aliases) {
      if (sourceNames.has(alias)) return alias;
    }
  }
  const compact = preferred.replace(/ /g, '');
  if (compact !== preferred && sourceNames.has(compact)) return compact;
  return null;
}

/**
 * Build target-bone → source-bone names for humanoid retargeting.
 * Supports UAL (`pelvis`) and Unity/Mixamo (`Hips`) sources onto Sidekick or
 * Unity-humanoid targets.
 */
export function buildUalBoneMap(
  targetBones: readonly THREE.Bone[],
  sourceBones: readonly THREE.Bone[],
): Record<string, string> {
  const sourceNames = new Set(sourceBones.map((bone) => bone.name));
  const names: Record<string, string> = {};

  for (const bone of targetBones) {
    const identity = resolveSourceBoneName(bone.name, sourceNames);
    if (identity) names[bone.name] = identity;
  }

  // Unity-named target ← UAL / Sidekick source
  for (const [unity, ual] of Object.entries(UNITY_HUMANOID_TO_UAL_BONES)) {
    const resolved = resolveSourceBoneName(ual, sourceNames);
    if (resolved) names[unity] = resolved;
  }

  // Sidekick / UAL-named target ← Unity / Mixamo source
  for (const [unity, ual] of Object.entries(UNITY_HUMANOID_TO_UAL_BONES)) {
    const resolved = resolveSourceBoneName(unity, sourceNames);
    if (resolved) names[ual] = resolved;
  }

  // Sidekick uses lowercase `head`; avoid also writing PascalCase `Head` when both exist.
  if (sourceNames.has('Head')) {
    if (targetBones.some((bone) => bone.name === 'head')) names.head = 'Head';
    else if (targetBones.some((bone) => bone.name === 'Head')) names.Head = 'Head';
  }
  // Mixamo toe tips → Sidekick ball when Ball_* is missing from the clip.
  if (!names.ball_l && sourceNames.has('Toes_L') && targetBones.some((b) => b.name === 'ball_l'))
    names.ball_l = 'Toes_L';
  if (!names.ball_r && sourceNames.has('Toes_R') && targetBones.some((b) => b.name === 'ball_r'))
    names.ball_r = 'Toes_R';
  return names;
}

interface MatchingSyntyRetargetContext {
  targetRoot: THREE.Object3D;
  targetMesh: THREE.SkinnedMesh;
  sourceRoot: THREE.Object3D;
  sourceMesh: THREE.SkinnedMesh;
  names: Readonly<Record<string, string>>;
  /** Mixamo cm-root sources must not copy hip/root translation onto Sidekick. */
  transferRootPosition: boolean;
  /**
   * Mixamo/UnityGLTF often bake the clip pose into scene rest (rifle as bind).
   * Relative rest→rest then only transfers micro-motion onto Sidekick T-pose.
   * Aim mode swings Sidekick rest bones so their limb axes match Mixamo aims,
   * preserving Sidekick bind twist (raw world-quat copy melts the skin).
   */
  aimAlignSourcePose: boolean;
}

/**
 * Mixamo/UnityGLTF often leave a 0.01 Root scale (cm → m). Baking must scale
 * every descendant localPosition — only fixing Hips leaves spine/limbs in cm
 * and produces NaN retarget quaternions / invisible avatars.
 * @returns bake factor for position tracks, plus whether Root/Hips tracks need it.
 */
export function normalizeMixamoRootScale(root: THREE.Object3D): {
  bake: number;
  scaleRootTracks: boolean;
} {
  const mixamoRoot =
    root.getObjectByName('Root') ??
    root.getObjectByName('mixamorig:Hips')?.parent ??
    null;
  if (!mixamoRoot) return { bake: 1, scaleRootTracks: true };

  const sx = mixamoRoot.scale.x;
  const sy = mixamoRoot.scale.y;
  const sz = mixamoRoot.scale.z;
  const uniform = Math.abs(sx - sy) < 1e-4 && Math.abs(sy - sz) < 1e-4;
  const hips = root.getObjectByName('Hips') ?? root.getObjectByName('mixamorig:Hips');
  const spine =
    root.getObjectByName('Spine_01') ??
    root.getObjectByName('spine_01') ??
    root.getObjectByName('mixamorig:Spine');

  // Case A: untouched Mixamo Root@0.01 — bake every descendant localPosition.
  if (uniform && sx > 1e-4 && sx <= 0.5) {
    mixamoRoot.traverse((node) => {
      if (node === mixamoRoot) return;
      node.position.multiplyScalar(sx);
    });
    mixamoRoot.scale.set(1, 1, 1);
    return { bake: sx, scaleRootTracks: true };
  }

  // Case B: partial export baked only Hips into meters; limbs still cm.
  if (
    hips &&
    spine &&
    hips.position.length() < 3 &&
    spine.position.length() > 5
  ) {
    hips.traverse((node) => {
      if (node === hips) return;
      node.position.multiplyScalar(0.01);
    });
    mixamoRoot.scale.set(1, 1, 1);
    return { bake: 0.01, scaleRootTracks: false };
  }

  return { bake: 1, scaleRootTracks: true };
}

function stripScaleTracks(clip: THREE.AnimationClip): THREE.AnimationClip {
  const tracks = clip.tracks.filter((track) => !/\.scale(?:\[|$)/.test(track.name) && !track.name.endsWith('.scale'));
  if (tracks.length === clip.tracks.length) return clip;
  return new THREE.AnimationClip(clip.name, clip.duration, tracks);
}

/** Scale position keyframes to match normalizeMixamoRootScale bind-pose baking. */
function scaleTranslationTracks(
  clip: THREE.AnimationClip,
  bake: number,
  scaleRootTracks: boolean,
): THREE.AnimationClip {
  if (bake === 1) return clip;
  const tracks = clip.tracks.map((track) => {
    if (!track.name.endsWith('.position') && !/\.position\[/.test(track.name)) return track;
    const nodeName = track.name.slice(0, track.name.lastIndexOf('.'));
    if (
      !scaleRootTracks &&
      (nodeName === 'Root' ||
        nodeName === 'Hips' ||
        nodeName === 'mixamorig:Hips' ||
        nodeName.endsWith('/Root') ||
        nodeName.endsWith('/Hips'))
    ) {
      return track;
    }
    const cloned = track.clone();
    for (let i = 0; i < cloned.values.length; i += 1) cloned.values[i]! *= bake;
    return cloned;
  });
  return new THREE.AnimationClip(clip.name, clip.duration, tracks);
}

function prepareMixamoClip(
  clip: THREE.AnimationClip,
  bake: number,
  scaleRootTracks: boolean,
): THREE.AnimationClip {
  return scaleTranslationTracks(stripScaleTracks(clip), bake, scaleRootTracks);
}

function isUnityOrMixamoSource(sourceMesh: THREE.SkinnedMesh): boolean {
  return (
    sourceMesh.skeleton.getBoneByName('Hips') !== undefined &&
    sourceMesh.skeleton.getBoneByName('pelvis') === undefined
  );
}

/**
 * Unity Sidekick animation exports (Mixamo on SidekickSyntyCharacter) include
 * attachment bones. UAL also uses pelvis names but must keep the retarget path.
 */
function isSidekickNativeExport(sourceMesh: THREE.SkinnedMesh): boolean {
  if (sourceMesh.skeleton.getBoneByName('pelvis') === undefined) return false;
  if (sourceMesh.skeleton.getBoneByName('Hips') !== undefined) return false;
  return (
    sourceMesh.name === 'SkeletonMarker' ||
    sourceMesh.skeleton.getBoneByName('backAttach') !== undefined ||
    sourceMesh.skeleton.getBoneByName('hipAttach_l') !== undefined
  );
}

/**
 * Rebind `pelvis.quaternion` style tracks onto `.bones[pelvis].quaternion` for the
 * Sidekick mixer. No pose remapping — source is already the Sidekick rig.
 * Position tracks only on root/pelvis (same as UAL retarget); per-bone positions
 * from UAL/Mixamo exports fight Sidekick bind lengths and melt the mesh.
 */
export function rebindSidekickNativeClips(
  clips: readonly THREE.AnimationClip[],
  targetBones: readonly THREE.Bone[],
): THREE.AnimationClip[] {
  const boneNames = new Set(targetBones.map((bone) => bone.name));
  return clips.map((clip) => {
    const tracks: THREE.KeyframeTrack[] = [];
    for (const track of clip.tracks) {
      if (/\.scale(?:\[|$)/.test(track.name) || track.name.endsWith('.scale')) continue;
      const dot = track.name.lastIndexOf('.');
      if (dot <= 0) continue;
      const nodeName = track.name.slice(0, dot);
      const property = track.name.slice(dot + 1).replace(/\[.*$/, '');
      if (property !== 'quaternion' && property !== 'position') continue;
      if (!boneNames.has(nodeName)) continue;
      if (property === 'position' && nodeName !== 'root' && nodeName !== 'pelvis') continue;
      const cloned = track.clone();
      cloned.name = `.bones[${nodeName}].${property}`;
      tracks.push(cloned);
    }
    if (tracks.length === 0) {
      throw new Error(
        `Sidekick-native clip "${clip.name}" has no tracks matching this character's bones.`,
      );
    }
    return new THREE.AnimationClip(clip.name, clip.duration, tracks).optimize();
  });
}

function boneDepth(bone: THREE.Bone): number {
  let depth = 0;
  let parent = bone.parent;
  while (parent instanceof THREE.Bone) {
    depth += 1;
    parent = parent.parent;
  }
  return depth;
}

function skeletonBindPoseIsUsable(mesh: THREE.SkinnedMesh): boolean {
  // SkeletonMarker / placeholder skins ship invalid inverse-binds. Calling
  // skeleton.pose() NaNs every bone and makes retarget produce NaN clips.
  if (mesh.name === 'SkeletonMarker' || mesh.geometry?.name === 'SkeletonMarker') return false;
  if (mesh.geometry instanceof THREE.BufferGeometry) {
    const positions = mesh.geometry.getAttribute('position');
    if (positions && positions.count <= 3) return false;
  }
  // Probe one bind inverse; NaN/Inf means pose() will corrupt the hierarchy.
  const inverse = mesh.skeleton.boneInverses[0];
  if (inverse) {
    const e = inverse.elements;
    for (let i = 0; i < 16; i += 1) {
      if (!Number.isFinite(e[i]!)) return false;
    }
  }
  return true;
}

function resetSkeletonToRest(mesh: THREE.SkinnedMesh, usableBindPose: boolean): void {
  if (usableBindPose) mesh.skeleton.pose();
}

function isRetargetIgnorableBone(name: string): boolean {
  const lower = name.toLowerCase();
  return (
    lower.includes('attach') ||
    lower.startsWith('ik_') ||
    lower.includes('twist') ||
    lower.includes('roll')
  );
}

/**
 * Swing-only aim on long bones. Clavicle/hand/twist made Mixamo axis mismatch melt
 * the skin; spine stays at Sidekick rest (Mixamo rest is already the clip pose).
 */
const AIM_ALIGN_BONE_RE = /^(upperarm_|lowerarm_|thigh_|calf_)/i;

function shouldAimAlignTargetBone(targetBoneName: string): boolean {
  return AIM_ALIGN_BONE_RE.test(targetBoneName);
}

/** Keep quaternions in the same hemisphere so rest≈anim does not become a -I delta. */
function alignQuaternionHemisphere(q: THREE.Quaternion, reference: THREE.Quaternion): void {
  if (q.dot(reference) < 0) {
    q.x = -q.x;
    q.y = -q.y;
    q.z = -q.z;
    q.w = -q.w;
  }
}

function primaryAimChild(bone: THREE.Bone): THREE.Bone | null {
  let fallback: THREE.Bone | null = null;
  for (const child of bone.children) {
    if (!(child instanceof THREE.Bone)) continue;
    if (!fallback) fallback = child;
    if (!isRetargetIgnorableBone(child.name) && child.position.lengthSq() > 1e-8) return child;
  }
  return fallback;
}

/** Prefer the target bone that maps from the source aim child's name. */
function resolveAimChildPair(
  sourceBone: THREE.Bone,
  targetBone: THREE.Bone,
  sourceToTarget: ReadonlyMap<string, string>,
  targetBones: ReadonlyMap<string, THREE.Bone>,
): { sourceChild: THREE.Bone; targetChild: THREE.Bone } | null {
  const sourceChild = primaryAimChild(sourceBone);
  if (!sourceChild) return null;
  const mappedTargetName = sourceToTarget.get(sourceChild.name);
  const targetChild = (mappedTargetName ? targetBones.get(mappedTargetName) : null)
    ?? primaryAimChild(targetBone);
  if (!targetChild) return null;
  return { sourceChild, targetChild };
}

interface AimAlignScratch {
  sourceBonePos: THREE.Vector3;
  sourceChildPos: THREE.Vector3;
  targetBonePos: THREE.Vector3;
  targetChildPos: THREE.Vector3;
  sourceAimWorld: THREE.Vector3;
  targetAimWorld: THREE.Vector3;
  swing: THREE.Quaternion;
  currentTargetRestWorld: THREE.Quaternion;
  targetAnimatedWorld: THREE.Quaternion;
}

function sampleAimAlignedWorld(
  data: {
    sourceBone: THREE.Bone;
    sourceAimChild: THREE.Bone;
    targetAimChild: THREE.Bone;
    targetBone: THREE.Bone;
  },
  s: AimAlignScratch,
): void {
  data.targetBone.getWorldQuaternion(s.currentTargetRestWorld);
  data.targetBone.getWorldPosition(s.targetBonePos);
  data.targetAimChild.getWorldPosition(s.targetChildPos);
  s.targetAimWorld.copy(s.targetChildPos).sub(s.targetBonePos);
  data.sourceBone.getWorldPosition(s.sourceBonePos);
  data.sourceAimChild.getWorldPosition(s.sourceChildPos);
  s.sourceAimWorld.copy(s.sourceChildPos).sub(s.sourceBonePos);
  if (s.targetAimWorld.lengthSq() <= 1e-8 || s.sourceAimWorld.lengthSq() <= 1e-8) {
    s.targetAnimatedWorld.copy(s.currentTargetRestWorld);
    return;
  }
  s.targetAimWorld.normalize();
  s.sourceAimWorld.normalize();
  s.swing.setFromUnitVectors(s.targetAimWorld, s.sourceAimWorld);
  s.targetAnimatedWorld.copy(s.swing).multiply(s.currentTargetRestWorld);
}

function retargetMatchingSyntyClip(
  context: MatchingSyntyRetargetContext,
  sourceClip: THREE.AnimationClip,
): THREE.AnimationClip {
  const {
    targetRoot,
    targetMesh,
    sourceRoot,
    sourceMesh,
    names,
    transferRootPosition,
    aimAlignSourcePose,
  } = context;
  const sampleClip = sourceClip;
  const poseSource = skeletonBindPoseIsUsable(sourceMesh);
  const poseTarget = skeletonBindPoseIsUsable(targetMesh);
  resetSkeletonToRest(targetMesh, poseTarget);
  resetSkeletonToRest(sourceMesh, poseSource);
  targetRoot.updateMatrixWorld(true);
  sourceRoot.updateMatrixWorld(true);

  const sourceBones = new Map(sourceMesh.skeleton.bones.map((bone) => [bone.name, bone]));
  const targetBones = new Map(targetMesh.skeleton.bones.map((bone) => [bone.name, bone]));
  const sourceToTarget = new Map(
    Object.entries(names).map(([targetName, sourceName]) => [sourceName, targetName]),
  );
  const frameCount = Math.max(2, Math.round(sampleClip.duration * 30) + 1);
  const times = new Float32Array(frameCount);
  const sourceBonePos = new THREE.Vector3();
  const sourceChildPos = new THREE.Vector3();
  const targetBonePos = new THREE.Vector3();
  const targetChildPos = new THREE.Vector3();
  const sourceAimWorld = new THREE.Vector3();
  const targetAimWorld = new THREE.Vector3();
  const swing = new THREE.Quaternion();
  const currentTargetRestWorld = new THREE.Quaternion();
  const sourceRestWorld = new THREE.Quaternion();

  const boneData = targetMesh.skeleton.bones.flatMap((targetBone) => {
    const sourceName = names[targetBone.name];
    const sourceBone = sourceName ? sourceBones.get(sourceName) : undefined;
    if (!sourceBone) return [];

    const sourceParentWorld = new THREE.Quaternion();
    const targetParentWorldInverse = new THREE.Quaternion();
    sourceBone.parent?.getWorldQuaternion(sourceParentWorld);
    targetBone.parent?.getWorldQuaternion(targetParentWorldInverse).invert();
    const transfersPosition =
      transferRootPosition &&
      (targetBone.name === 'root' || targetBone.name === 'pelvis');
    const aimPair = aimAlignSourcePose && shouldAimAlignTargetBone(targetBone.name)
      ? resolveAimChildPair(sourceBone, targetBone, sourceToTarget, targetBones)
      : null;
    return [{
      sourceBone,
      sourceAimChild: aimPair?.sourceChild ?? null,
      targetAimChild: aimPair?.targetChild ?? null,
      sourceRestLocalPosition: sourceBone.position.clone(),
      sourceRestWorldInverse: sourceBone.getWorldQuaternion(new THREE.Quaternion()).invert(),
      targetBone,
      targetRestLocalPosition: targetBone.position.clone(),
      targetRestLocalQuaternion: targetBone.quaternion.clone(),
      targetRestWorld: targetBone.getWorldQuaternion(new THREE.Quaternion()),
      positionCorrection: targetParentWorldInverse.multiply(sourceParentWorld),
      quaternionValues: new Float32Array(frameCount * 4),
      positionValues: transfersPosition ? new Float32Array(frameCount * 3) : null,
    }];
  }).sort((a, b) => boneDepth(a.targetBone) - boneDepth(b.targetBone));

  const restoreTargetRestLocals = (): void => {
    if (poseTarget) {
      targetMesh.skeleton.pose();
      return;
    }
    // Marker / invalid-bind targets cannot pose(); restore captured rest locals.
    for (const data of boneData) {
      data.targetBone.position.copy(data.targetRestLocalPosition);
      data.targetBone.quaternion.copy(data.targetRestLocalQuaternion);
    }
  };

  const sourceMixer = new THREE.AnimationMixer(sourceRoot);
  const sourceAction = sourceMixer.clipAction(sampleClip);
  sourceAction.clampWhenFinished = true;
  sourceAction.setLoop(THREE.LoopOnce, 1).play();
  const sourceAnimatedWorld = new THREE.Quaternion();
  const motionDeltaWorld = new THREE.Quaternion();
  const targetAnimatedWorld = new THREE.Quaternion();
  const targetParentWorldInverse = new THREE.Quaternion();
  const positionDelta = new THREE.Vector3();

  for (let frame = 0; frame < frameCount; frame += 1) {
    const time = frame === frameCount - 1
      ? sampleClip.duration
      : frame / 30;
    times[frame] = time;
    sourceMixer.setTime(time);
    sourceRoot.updateMatrixWorld(true);
    restoreTargetRestLocals();
    targetRoot.updateMatrixWorld(true);

    for (const data of boneData) {
      if (data.sourceAimChild && data.targetAimChild) {
        sampleAimAlignedWorld(
          {
            sourceBone: data.sourceBone,
            sourceAimChild: data.sourceAimChild,
            targetAimChild: data.targetAimChild,
            targetBone: data.targetBone,
          },
          {
            sourceBonePos,
            sourceChildPos,
            targetBonePos,
            targetChildPos,
            sourceAimWorld,
            targetAimWorld,
            swing,
            currentTargetRestWorld,
            targetAnimatedWorld,
          },
        );
        data.targetBone.parent?.getWorldQuaternion(targetParentWorldInverse).invert();
        data.targetBone.quaternion
          .copy(targetParentWorldInverse)
          .multiply(targetAnimatedWorld)
          .normalize();
      } else if (aimAlignSourcePose) {
        // Mixamo bakes clip pose into rest; keep Sidekick spine/head/fingers at rest locals.
        data.targetBone.quaternion.copy(data.targetRestLocalQuaternion);
      } else {
        data.sourceBone.getWorldQuaternion(sourceAnimatedWorld);
        sourceRestWorld.copy(data.sourceRestWorldInverse).invert();
        alignQuaternionHemisphere(sourceAnimatedWorld, sourceRestWorld);
        motionDeltaWorld
          .copy(sourceAnimatedWorld)
          .multiply(data.sourceRestWorldInverse);
        targetAnimatedWorld
          .copy(motionDeltaWorld)
          .multiply(data.targetRestWorld);
        data.targetBone.parent?.getWorldQuaternion(targetParentWorldInverse).invert();
        data.targetBone.quaternion
          .copy(targetParentWorldInverse)
          .multiply(targetAnimatedWorld)
          .normalize();
      }
      data.targetBone.quaternion.toArray(data.quaternionValues, frame * 4);

      if (data.positionValues) {
        positionDelta
          .copy(data.sourceBone.position)
          .sub(data.sourceRestLocalPosition)
          .applyQuaternion(data.positionCorrection);
        data.targetBone.position
          .copy(data.targetRestLocalPosition)
          .add(positionDelta)
          .toArray(data.positionValues, frame * 3);
      }
      data.targetBone.updateMatrixWorld(true);
    }
  }

  sourceMixer.stopAllAction();
  sourceMixer.uncacheRoot(sourceRoot);
  resetSkeletonToRest(targetMesh, poseTarget);
  resetSkeletonToRest(sourceMesh, poseSource);
  targetRoot.updateMatrixWorld(true);
  sourceRoot.updateMatrixWorld(true);

  const tracks = boneData.flatMap((data) => {
    const quaternionTrack = new THREE.QuaternionKeyframeTrack(
      `.bones[${data.targetBone.name}].quaternion`,
      times,
      data.quaternionValues,
    );
    if (!data.positionValues) return [quaternionTrack];
    return [quaternionTrack, new THREE.VectorKeyframeTrack(
      `.bones[${data.targetBone.name}].position`,
      times,
      data.positionValues,
    )];
  });
  return new THREE.AnimationClip(sourceClip.name, sampleClip.duration, tracks).optimize();
}

export function findFirstSkinnedMesh(root: THREE.Object3D): THREE.SkinnedMesh | null {
  let fallback: THREE.SkinnedMesh | null = null;
  let preferred: THREE.SkinnedMesh | null = null;
  root.traverse((object: THREE.Object3D) => {
    if (!(object instanceof THREE.SkinnedMesh)) return;
    if (!fallback) fallback = object;
    if (!preferred && skeletonBindPoseIsUsable(object)) preferred = object;
  });
  return preferred ?? fallback;
}

export function skeletonHasBone(root: THREE.Object3D, boneName: string): boolean {
  let found = false;
  root.traverse((object: THREE.Object3D) => {
    if (found || !(object instanceof THREE.SkinnedMesh)) return;
    found = object.skeleton.getBoneByName(boneName) !== undefined;
  });
  return found;
}

export function canRetargetUalToUnityHumanoid(
  targetScene: THREE.Object3D,
  sourceScene: THREE.Object3D,
): boolean {
  const targetOk =
    skeletonHasBone(targetScene, 'Hips') || skeletonHasBone(targetScene, 'pelvis');
  const sourceOk =
    skeletonHasBone(sourceScene, 'Hips') || skeletonHasBone(sourceScene, 'pelvis');
  return targetOk && sourceOk;
}

export function retargetUnityHumanoidAnimations(
  targetScene: THREE.Object3D,
  sourceScene: THREE.Object3D,
  sourceClips: THREE.AnimationClip[],
): THREE.AnimationClip[] {
  const targetMesh = findFirstSkinnedMesh(targetScene);
  const sourceMesh = findFirstSkinnedMesh(sourceScene);
  if (!targetMesh || !sourceMesh) {
    throw new Error('Unity humanoid retargeting needs skinned source and target meshes.');
  }

  // Sidekick-on-Sidekick Unity exports already share bone names — remapping melts
  // the pose. UAL also uses pelvis names but still goes through retarget below.
  if (isSidekickNativeExport(sourceMesh)) {
    return rebindSidekickNativeClips(
      sourceClips.map((clip) => prepareMixamoClip(clip, 1, true)),
      targetMesh.skeleton.bones,
    );
  }

  const { bake, scaleRootTracks } = normalizeMixamoRootScale(sourceScene);
  sourceScene.updateMatrixWorld(true);
  const preparedClips = sourceClips.map((clip) =>
    prepareMixamoClip(clip, bake, scaleRootTracks),
  );

  const names = buildUalBoneMap(targetMesh.skeleton.bones, sourceMesh.skeleton.bones);
  const usesMatchingSyntyRig = targetMesh.skeleton.getBoneByName('pelvis') !== undefined;
  const mixamoSource = isUnityOrMixamoSource(sourceMesh);
  if (usesMatchingSyntyRig) {
    const context: MatchingSyntyRetargetContext = {
      targetRoot: targetScene,
      targetMesh,
      sourceRoot: sourceScene,
      sourceMesh,
      names,
      // UAL shares Sidekick-scale hips; Mixamo cm/root motion must stay rotation-only.
      transferRootPosition: !mixamoSource,
      aimAlignSourcePose: mixamoSource,
    };
    return preparedClips.map((clip) => retargetMatchingSyntyClip(context, clip));
  }

  const sourceHip = sourceMesh.skeleton.getBoneByName('pelvis')
    ? 'pelvis'
    : 'Hips';
  const retargetOptions = {
    fps: 30,
    hip: sourceHip,
    hipInfluence: new THREE.Vector3(0, mixamoSource ? 0 : 1, 0),
    names,
    preserveBonePositions: true,
    useFirstFramePosition: true,
  } as Parameters<typeof retargetClip>[3] & { preserveBonePositions: boolean };

  const poseSource = skeletonBindPoseIsUsable(sourceMesh);
  const poseTarget = skeletonBindPoseIsUsable(targetMesh);
  return preparedClips.map((clip) => {
    resetSkeletonToRest(targetMesh, poseTarget);
    resetSkeletonToRest(sourceMesh, poseSource);
    const retargeted = retargetClip(targetMesh, sourceMesh, clip, retargetOptions);
    retargeted.name = clip.name;
    return retargeted.optimize();
  });
}
