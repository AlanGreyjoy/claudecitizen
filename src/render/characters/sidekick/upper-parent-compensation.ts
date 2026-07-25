import * as THREE from 'three';

function boneNameFromTrack(trackName: string): string | null {
  const match = /\.bones\[([^\]]+)\]/.exec(trackName);
  return match?.[1] ?? null;
}

export interface UpperParentCompensation {
  restore: () => void;
  apply: () => void;
  clearSamplers: () => void;
  setCorrection: (
    action: THREE.AnimationAction | null,
    clipName: string | null,
  ) => void;
  getCorrectionAction: () => THREE.AnimationAction | null;
  getCorrectionClipName: () => string | null;
}

/**
 * Rifle gait clips animate root/pelvis in incompatible orientations. Keep
 * those transforms for the legs, then cancel them at spine_01 so the masked
 * torso retains the authored ADS parent space instead of looking down/left.
 */
export function createUpperParentCompensation(
  mixerMesh: THREE.SkinnedMesh | null,
  sourceClips: Map<string, THREE.AnimationClip>,
): UpperParentCompensation {
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
  let upperCorrectionAction: THREE.AnimationAction | null = null;
  let upperCorrectionClipName: string | null = null;
  const quaternionSamplers = new Map<
    string,
    ((timeSeconds: number, target: THREE.Quaternion) => THREE.Quaternion) | null
  >();

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

  const restore = (): void => {
    if (!upperSpineBone || !upperParentCompensationApplied) return;
    upperSpineBone.quaternion.copy(uncompensatedUpperSpineQuaternion);
    upperParentCompensationApplied = false;
  };

  const apply = (): void => {
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

  return {
    restore,
    apply,
    clearSamplers: () => {
      quaternionSamplers.clear();
    },
    setCorrection: (action, clipName) => {
      upperCorrectionAction = action;
      upperCorrectionClipName = clipName;
    },
    getCorrectionAction: () => upperCorrectionAction,
    getCorrectionClipName: () => upperCorrectionClipName,
  };
}
