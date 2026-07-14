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

/**
 * Unity's FBX importer commonly renames humanoid bones to Hips/Spine_01/etc.,
 * while GLB exports from Sidekick retain the source pelvis/spine_01/etc.
 * Prefer the explicit Unity map, then use identity mappings where both rigs
 * kept the same bone name.
 */
export function buildUalBoneMap(
  targetBones: readonly THREE.Bone[],
  sourceBones: readonly THREE.Bone[],
): Record<string, string> {
  const sourceNames = new Set(sourceBones.map((bone) => bone.name));
  const names = { ...UNITY_HUMANOID_TO_UAL_BONES };
  for (const bone of targetBones) {
    if (sourceNames.has(bone.name)) names[bone.name] = bone.name;
  }
  if (sourceNames.has('Head') && targetBones.some((bone) => bone.name === 'head'))
    names.head = 'Head';
  return names;
}

interface MatchingSyntyRetargetContext {
  targetRoot: THREE.Object3D;
  targetMesh: THREE.SkinnedMesh;
  sourceRoot: THREE.Object3D;
  sourceMesh: THREE.SkinnedMesh;
  names: Readonly<Record<string, string>>;
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

function retargetMatchingSyntyClip(
  context: MatchingSyntyRetargetContext,
  sourceClip: THREE.AnimationClip,
): THREE.AnimationClip {
  const { targetRoot, targetMesh, sourceRoot, sourceMesh, names } = context;
  targetMesh.skeleton.pose();
  sourceMesh.skeleton.pose();
  targetRoot.updateMatrixWorld(true);
  sourceRoot.updateMatrixWorld(true);

  const sourceBones = new Map(sourceMesh.skeleton.bones.map((bone) => [bone.name, bone]));
  const frameCount = Math.max(2, Math.round(sourceClip.duration * 30) + 1);
  const times = new Float32Array(frameCount);
  const boneData = targetMesh.skeleton.bones.flatMap((targetBone) => {
    const sourceName = names[targetBone.name];
    const sourceBone = sourceName ? sourceBones.get(sourceName) : undefined;
    if (!sourceBone) return [];

    const sourceParentWorld = new THREE.Quaternion();
    const targetParentWorldInverse = new THREE.Quaternion();
    sourceBone.parent?.getWorldQuaternion(sourceParentWorld);
    targetBone.parent?.getWorldQuaternion(targetParentWorldInverse).invert();
    const transfersPosition = targetBone.name === 'root' || targetBone.name === 'pelvis';
    return [{
      sourceBone,
      sourceRestLocalPosition: sourceBone.position.clone(),
      sourceRestWorldInverse: sourceBone.getWorldQuaternion(new THREE.Quaternion()).invert(),
      targetBone,
      targetRestLocalPosition: targetBone.position.clone(),
      targetRestWorld: targetBone.getWorldQuaternion(new THREE.Quaternion()),
      positionCorrection: targetParentWorldInverse.multiply(sourceParentWorld),
      quaternionValues: new Float32Array(frameCount * 4),
      positionValues: transfersPosition ? new Float32Array(frameCount * 3) : null,
    }];
  }).sort((a, b) => boneDepth(a.targetBone) - boneDepth(b.targetBone));

  const sourceMixer = new THREE.AnimationMixer(sourceRoot);
  const sourceAction = sourceMixer.clipAction(sourceClip);
  sourceAction.clampWhenFinished = true;
  sourceAction.setLoop(THREE.LoopOnce, 1).play();
  const sourceAnimatedWorld = new THREE.Quaternion();
  const motionDeltaWorld = new THREE.Quaternion();
  const targetAnimatedWorld = new THREE.Quaternion();
  const targetParentWorldInverse = new THREE.Quaternion();
  const positionDelta = new THREE.Vector3();

  for (let frame = 0; frame < frameCount; frame += 1) {
    const time = frame === frameCount - 1
      ? sourceClip.duration
      : frame / 30;
    times[frame] = time;
    sourceMixer.setTime(time);
    sourceRoot.updateMatrixWorld(true);
    targetMesh.skeleton.pose();
    targetRoot.updateMatrixWorld(true);

    for (const data of boneData) {
      data.sourceBone.getWorldQuaternion(sourceAnimatedWorld);
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
        .normalize()
        .toArray(data.quaternionValues, frame * 4);

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
  targetMesh.skeleton.pose();
  sourceMesh.skeleton.pose();
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
  return new THREE.AnimationClip(sourceClip.name, sourceClip.duration, tracks).optimize();
}

export function findFirstSkinnedMesh(root: THREE.Object3D): THREE.SkinnedMesh | null {
  let mesh: THREE.SkinnedMesh | null = null;
  root.traverse((object: THREE.Object3D) => {
    if (!mesh && object instanceof THREE.SkinnedMesh) {
      mesh = object;
    }
  });
  return mesh;
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
  return (
    (skeletonHasBone(targetScene, 'Hips') || skeletonHasBone(targetScene, 'pelvis')) &&
    skeletonHasBone(sourceScene, 'pelvis')
  );
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

  const names = buildUalBoneMap(targetMesh.skeleton.bones, sourceMesh.skeleton.bones);
  const usesMatchingSyntyRig = targetMesh.skeleton.getBoneByName('pelvis') !== undefined;
  if (usesMatchingSyntyRig) {
    const context: MatchingSyntyRetargetContext = {
      targetRoot: targetScene,
      targetMesh,
      sourceRoot: sourceScene,
      sourceMesh,
      names,
    };
    return sourceClips.map((clip) => retargetMatchingSyntyClip(context, clip));
  }

  const retargetOptions = {
    fps: 30,
    hip: 'pelvis',
    hipInfluence: new THREE.Vector3(0, 1, 0),
    names,
    preserveBonePositions: true,
    useFirstFramePosition: true,
  } as Parameters<typeof retargetClip>[3] & { preserveBonePositions: boolean };

  return sourceClips.map((clip) => {
    targetMesh.skeleton.pose();
    sourceMesh.skeleton.pose();
    const retargeted = retargetClip(targetMesh, sourceMesh, clip, retargetOptions);
    retargeted.name = clip.name;
    return retargeted.optimize();
  });
}
