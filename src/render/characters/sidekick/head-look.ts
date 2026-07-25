import * as THREE from 'three';
import type { CharacterUpperBodyAim } from '../../../types';

const LOOK_HALF_LIFE_SECONDS = 0.09;
const HEAD_BONE_NAMES = ['Head', 'head', 'head_01', 'Head_01'] as const;

/**
 * Procedural Head-bone look layered over the animation mixer — used for
 * station vendor-screen hotspots (camera stays free).
 */

export interface SidekickHeadLookController {
  dispose: () => void;
  restore: () => void;
  setTarget: (look: CharacterUpperBodyAim | null) => void;
  update: (dt: number) => void;
}

/**
 * Adds a world-space rotation to a bone while preserving its animated local
 * quaternion (same parent-space delta as upper-body aim).
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

function findHeadBone(root: THREE.Object3D): THREE.Object3D | null {
  for (const name of HEAD_BONE_NAMES) {
    const bone = root.getObjectByName(name);
    if (bone) return bone;
  }
  return null;
}

export function createSidekickHeadLookController(
  characterRoot: THREE.Object3D,
  skeletonRoot: THREE.Object3D,
): SidekickHeadLookController | null {
  const found = findHeadBone(skeletonRoot);
  if (!found) return null;
  const headBone = found;

  let targetPitch = 0;
  let targetYaw = 0;
  let currentPitch = 0;
  let currentYaw = 0;
  let overlayApplied = false;
  const baseQuaternion = new THREE.Quaternion();

  const rootWorld = new THREE.Quaternion();
  const upWorld = new THREE.Vector3();
  const rightWorld = new THREE.Vector3();
  const yawDelta = new THREE.Quaternion();
  const pitchDelta = new THREE.Quaternion();
  const combinedDelta = new THREE.Quaternion();
  const parentWorld = new THREE.Quaternion();
  const parentWorldInverse = new THREE.Quaternion();
  const localDelta = new THREE.Quaternion();

  function restore(): void {
    if (!overlayApplied) return;
    headBone.quaternion.copy(baseQuaternion);
    skeletonRoot.updateMatrixWorld(true);
    overlayApplied = false;
  }

  function setTarget(look: CharacterUpperBodyAim | null): void {
    targetPitch = look?.pitchRadians ?? 0;
    targetYaw = look?.yawRadians ?? 0;
  }

  function update(dt: number): void {
    const blend =
      dt <= 0 ? 0 : 1 - Math.exp((-Math.LN2 * dt) / LOOK_HALF_LIFE_SECONDS);
    currentPitch += (targetPitch - currentPitch) * blend;
    currentYaw += (targetYaw - currentYaw) * blend;

    if (Math.abs(currentPitch) < 1e-4 && Math.abs(currentYaw) < 1e-4) {
      currentPitch = 0;
      currentYaw = 0;
      return;
    }

    baseQuaternion.copy(headBone.quaternion);
    overlayApplied = true;

    characterRoot.updateMatrixWorld(true);
    characterRoot.getWorldQuaternion(rootWorld);
    upWorld.set(0, 1, 0).applyQuaternion(rootWorld).normalize();
    // Gameplay right = forward × up; characterRoot forward is +Z.
    rightWorld.set(-1, 0, 0).applyQuaternion(rootWorld).normalize();

    yawDelta.setFromAxisAngle(upWorld, currentYaw);
    rightWorld.applyQuaternion(yawDelta).normalize();
    pitchDelta.setFromAxisAngle(rightWorld, currentPitch);
    combinedDelta.copy(pitchDelta).multiply(yawDelta).normalize();

    applyWorldDelta(
      headBone,
      combinedDelta,
      parentWorld,
      parentWorldInverse,
      localDelta,
    );
  }

  return {
    dispose: restore,
    restore,
    setTarget,
    update,
  };
}
