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
  return skeletonHasBone(targetScene, 'Hips') && skeletonHasBone(sourceScene, 'pelvis');
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

  const retargetOptions = {
    fps: 30,
    hip: 'pelvis',
    hipInfluence: new THREE.Vector3(0, 1, 0),
    names: UNITY_HUMANOID_TO_UAL_BONES,
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
