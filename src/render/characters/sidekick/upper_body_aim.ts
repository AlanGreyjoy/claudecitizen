import * as THREE from 'three';
import type { CharacterUpperBodyAim } from '../../../types';

const AIM_HALF_LIFE_SECONDS = 0.055;
const SPINE_CHAIN = [
  { names: ['spine_01', 'Spine_01'], weight: 0.25 },
  { names: ['spine_02', 'Spine_02'], weight: 0.35 },
  { names: ['spine_03', 'Spine_03'], weight: 0.4 },
] as const;

interface AimBone {
  bone: THREE.Object3D;
  baseQuaternion: THREE.Quaternion;
  weight: number;
}

export interface SidekickUpperBodyAimController {
  dispose: () => void;
  restore: () => void;
  setTarget: (aim: CharacterUpperBodyAim | null) => void;
  update: (dt: number) => void;
}

function findBone(root: THREE.Object3D, names: readonly string[]): THREE.Object3D | null {
  for (const name of names) {
    const bone = root.getObjectByName(name);
    if (bone) return bone;
  }
  return null;
}

/**
 * Adds a world-space rotation to a bone while preserving its animated local
 * quaternion. Expressing the delta in parent space keeps this independent of
 * Sidekick's X-axis-aligned spine bones.
 */
function applyWorldDelta(
  bone: THREE.Object3D,
  worldDelta: THREE.Quaternion,
  parentWorld: THREE.Quaternion,
  parentWorldInverse: THREE.Quaternion,
  localDelta: THREE.Quaternion,
): void {
  const parent = bone.parent;
  if (!parent) return;
  parent.getWorldQuaternion(parentWorld);
  parentWorldInverse.copy(parentWorld).invert();
  localDelta
    .copy(parentWorldInverse)
    .multiply(worldDelta)
    .multiply(parentWorld);
  bone.quaternion.premultiply(localDelta).normalize();
  bone.updateMatrixWorld(true);
}

export function createSidekickUpperBodyAimController(
  characterRoot: THREE.Object3D,
  skeletonRoot: THREE.Object3D,
): SidekickUpperBodyAimController | null {
  const bones: AimBone[] = [];
  for (const { names, weight } of SPINE_CHAIN) {
    const bone = findBone(skeletonRoot, names);
    if (bone) bones.push({ bone, baseQuaternion: new THREE.Quaternion(), weight });
  }
  if (bones.length === 0) return null;

  const totalWeight = bones.reduce((sum, entry) => sum + entry.weight, 0);
  for (const entry of bones) entry.weight /= totalWeight;

  let targetPitch = 0;
  let targetYaw = 0;
  let currentPitch = 0;
  let currentYaw = 0;
  let overlayApplied = false;

  const rootWorld = new THREE.Quaternion();
  const upWorld = new THREE.Vector3();
  const rightWorld = new THREE.Vector3();
  const yawDelta = new THREE.Quaternion();
  const pitchDelta = new THREE.Quaternion();
  const combinedDelta = new THREE.Quaternion();
  const weightedDelta = new THREE.Quaternion();
  const identity = new THREE.Quaternion();
  const parentWorld = new THREE.Quaternion();
  const parentWorldInverse = new THREE.Quaternion();
  const localDelta = new THREE.Quaternion();

  function restore(): void {
    if (!overlayApplied) return;
    for (const entry of bones) entry.bone.quaternion.copy(entry.baseQuaternion);
    skeletonRoot.updateMatrixWorld(true);
    overlayApplied = false;
  }

  function setTarget(aim: CharacterUpperBodyAim | null): void {
    targetPitch = aim?.pitchRadians ?? 0;
    targetYaw = aim?.yawRadians ?? 0;
  }

  function update(dt: number): void {
    const blend = dt <= 0
      ? 0
      : 1 - Math.exp((-Math.LN2 * dt) / AIM_HALF_LIFE_SECONDS);
    currentPitch += (targetPitch - currentPitch) * blend;
    currentYaw += (targetYaw - currentYaw) * blend;

    if (Math.abs(currentPitch) < 1e-4 && Math.abs(currentYaw) < 1e-4) {
      currentPitch = 0;
      currentYaw = 0;
      return;
    }

    for (const entry of bones) entry.baseQuaternion.copy(entry.bone.quaternion);
    overlayApplied = true;

    characterRoot.updateMatrixWorld(true);
    characterRoot.getWorldQuaternion(rootWorld);
    upWorld.set(0, 1, 0).applyQuaternion(rootWorld).normalize();
    // Gameplay's right axis is forward x up; characterRoot's forward is +Z.
    rightWorld.set(-1, 0, 0).applyQuaternion(rootWorld).normalize();

    yawDelta.setFromAxisAngle(upWorld, currentYaw);
    rightWorld.applyQuaternion(yawDelta).normalize();
    pitchDelta.setFromAxisAngle(rightWorld, currentPitch);
    combinedDelta.copy(pitchDelta).multiply(yawDelta).normalize();

    for (const entry of bones) {
      weightedDelta.copy(identity).slerp(combinedDelta, entry.weight).normalize();
      applyWorldDelta(
        entry.bone,
        weightedDelta,
        parentWorld,
        parentWorldInverse,
        localDelta,
      );
    }
  }

  return {
    dispose: restore,
    restore,
    setTarget,
    update,
  };
}
