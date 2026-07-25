import * as THREE from 'three';
import type { Vec3 } from '../../types';
import type { WeaponMarkerWorldPose } from '../main/domain/types';

const MUZZLE_FLASH_POOL_SIZE = 2;
const MUZZLE_FLASH_LIFETIME_SECONDS = 0.055;

interface MuzzleFlashEntry {
  group: THREE.Group;
  materials: THREE.MeshBasicMaterial[];
  remainingSeconds: number;
  worldPosition: Vec3;
}

export interface MuzzleFlashRenderer {
  dispose(): void;
  spawn(pose: WeaponMarkerWorldPose): void;
  update(dt: number, focusPosition: Vec3, visible: boolean): void;
}

export function createMuzzleFlashRenderer(
  scene: THREE.Scene,
  renderScale: number,
): MuzzleFlashRenderer {
  const geometry = new THREE.PlaneGeometry(0.18, 0.5);
  const forwardAxis = new THREE.Vector3(0, 1, 0);
  const direction = new THREE.Vector3();
  const entries: MuzzleFlashEntry[] = [];
  let cursor = 0;

  for (let index = 0; index < MUZZLE_FLASH_POOL_SIZE; index += 1) {
    const group = new THREE.Group();
    const materials: THREE.MeshBasicMaterial[] = [];
    for (const rotation of [0, Math.PI / 2]) {
      const material = new THREE.MeshBasicMaterial({
        blending: THREE.AdditiveBlending,
        color: index % 2 === 0 ? 0xfff4b0 : 0xffd06a,
        depthWrite: false,
        opacity: 0,
        side: THREE.DoubleSide,
        transparent: true,
      });
      const plane = new THREE.Mesh(geometry, material);
      plane.rotation.y = rotation;
      group.add(plane);
      materials.push(material);
    }
    group.scale.setScalar(renderScale);
    group.visible = false;
    scene.add(group);
    entries.push({
      group,
      materials,
      remainingSeconds: 0,
      worldPosition: { x: 0, y: 0, z: 0 },
    });
  }

  function spawn(pose: WeaponMarkerWorldPose): void {
    const entry = entries[cursor]!;
    cursor = (cursor + 1) % entries.length;
    entry.worldPosition = { ...pose.position };
    entry.remainingSeconds = MUZZLE_FLASH_LIFETIME_SECONDS;
    direction.set(pose.forward.x, pose.forward.y, pose.forward.z).normalize();
    entry.group.quaternion.setFromUnitVectors(forwardAxis, direction);
    entry.group.rotateOnAxis(forwardAxis, Math.random() * Math.PI);
    entry.group.visible = true;
    for (const material of entry.materials) material.opacity = 1;
  }

  function update(dt: number, focusPosition: Vec3, visible: boolean): void {
    for (const entry of entries) {
      entry.remainingSeconds = Math.max(0, entry.remainingSeconds - Math.max(0, dt));
      const active = visible && entry.remainingSeconds > 0;
      entry.group.visible = active;
      if (!active) continue;
      entry.group.position.set(
        (entry.worldPosition.x - focusPosition.x) * renderScale,
        (entry.worldPosition.y - focusPosition.y) * renderScale,
        (entry.worldPosition.z - focusPosition.z) * renderScale,
      );
      const opacity = Math.min(1, entry.remainingSeconds / (MUZZLE_FLASH_LIFETIME_SECONDS * 0.45));
      for (const material of entry.materials) material.opacity = opacity;
    }
  }

  return {
    dispose() {
      for (const entry of entries) {
        entry.group.removeFromParent();
        for (const material of entry.materials) material.dispose();
      }
      geometry.dispose();
    },
    spawn,
    update,
  };
}
