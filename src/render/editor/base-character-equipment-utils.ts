import * as THREE from 'three';
import type { PrefabEntity, PrefabTransform } from '../../world/prefabs/schema';
import type { CharacterEquipmentSlotV1 } from '../../player/equipment/base-character-equipment';
import type { BackpackDefinition, WeaponDefinition } from '../../net/admin-api';

export type CatalogDefinition = WeaponDefinition | BackpackDefinition;

export const LOCOMOTION_LABELS: Record<string, string> = {
  idle: 'Idle',
  idle_aiming: 'Idle Aiming',
  idle_crouching: 'Idle Crouching',
  idle_crouching_aiming: 'Idle Crouching Aiming',
  walk_crouching: 'Walk Crouching',
  walk: 'Walk',
  run: 'Run',
  sprint: 'Sprint',
  jump_start: 'Jump Start',
  jump_loop: 'Jump Loop',
  jump_land: 'Jump Land',
};

export const BUILTIN_UAL_CLIPS = new Set([
  'Idle_Loop',
  'Walk_Loop',
  'Sprint_Loop',
  'Jump_Start',
  'Jump_Loop',
  'Jump_Land',
]);

export function slugFromUrl(url: string): string {
  const fileName = decodeURIComponent(url.slice(url.lastIndexOf('/') + 1));
  const base = fileName.replace(/\.(glb|gltf)(?:[?#].*)?$/i, '') || 'source';
  const slug = base.toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-+|-+$/g, '').slice(0, 64);
  return slug || 'source';
}

export function labelFromUrl(url: string): string {
  const fileName = decodeURIComponent(url.slice(url.lastIndexOf('/') + 1));
  return fileName.replace(/\.(glb|gltf)(?:[?#].*)?$/i, '') || url;
}

export function button(label: string, onClick: () => void): HTMLButtonElement {
  const node = document.createElement('button');
  node.type = 'button';
  node.className = 'ed-btn';
  node.textContent = label;
  node.addEventListener('click', onClick);
  return node;
}

export function applyTransform(object: THREE.Object3D, transform: PrefabTransform): void {
  object.position.set(transform.position.x, transform.position.y, transform.position.z);
  object.quaternion
    .set(transform.rotation.x, transform.rotation.y, transform.rotation.z, transform.rotation.w)
    .normalize();
  object.scale.set(transform.scale.x, transform.scale.y, transform.scale.z);
}

export function copyObjectToTransform(object: THREE.Object3D, transform: PrefabTransform): void {
  object.quaternion.normalize();
  transform.position = { x: object.position.x, y: object.position.y, z: object.position.z };
  transform.rotation = {
    x: object.quaternion.x,
    y: object.quaternion.y,
    z: object.quaternion.z,
    w: object.quaternion.w,
  };
  transform.scale = { x: object.scale.x, y: object.scale.y, z: object.scale.z };
}

export function transformEulerDegrees(transform: PrefabTransform): { x: number; y: number; z: number } {
  const quaternion = new THREE.Quaternion(
    transform.rotation.x,
    transform.rotation.y,
    transform.rotation.z,
    transform.rotation.w,
  ).normalize();
  const euler = new THREE.Euler().setFromQuaternion(quaternion, 'XYZ');
  return {
    x: THREE.MathUtils.radToDeg(euler.x),
    y: THREE.MathUtils.radToDeg(euler.y),
    z: THREE.MathUtils.radToDeg(euler.z),
  };
}

export function setTransformEulerDegrees(
  transform: PrefabTransform,
  degrees: { x: number; y: number; z: number },
): void {
  const quaternion = new THREE.Quaternion().setFromEuler(new THREE.Euler(
    THREE.MathUtils.degToRad(degrees.x),
    THREE.MathUtils.degToRad(degrees.y),
    THREE.MathUtils.degToRad(degrees.z),
    'XYZ',
  ));
  transform.rotation = {
    x: quaternion.x,
    y: quaternion.y,
    z: quaternion.z,
    w: quaternion.w,
  };
}

export function findPrefabEntity(root: PrefabEntity, entityId: string): PrefabEntity | null {
  if (root.id === entityId) return root;
  for (const child of root.children ?? []) {
    const match = findPrefabEntity(child, entityId);
    if (match) return match;
  }
  return null;
}

export function displayNumber(value: number): string {
  const rounded = Math.round(value * 1000) / 1000;
  return Object.is(rounded, -0) ? '0' : String(rounded);
}

export function findEntityObject(root: THREE.Object3D, entityId: string): THREE.Object3D | null {
  let match: THREE.Object3D | null = null;
  root.traverse((object) => {
    if (!match && object.userData.entityId === entityId) match = object;
  });
  return match;
}

export function placeholder(color: number): THREE.Group {
  const group = new THREE.Group();
  const mesh = new THREE.Mesh(
    new THREE.BoxGeometry(0.18, 0.32, 0.12),
    new THREE.MeshBasicMaterial({ color, wireframe: true }),
  );
  group.add(mesh);
  return group;
}

export function restoreReferencePose(root: THREE.Object3D): void {
  const posedSkeletons = new Set<THREE.Skeleton>();
  root.traverse((object) => {
    if (!(object instanceof THREE.SkinnedMesh) || posedSkeletons.has(object.skeleton)) return;
    object.skeleton.pose();
    posedSkeletons.add(object.skeleton);
  });
  root.updateMatrixWorld(true);
}

export function compatible(slot: CharacterEquipmentSlotV1, definition: CatalogDefinition): boolean {
  if (slot.kind === 'backpack') return 'capacityLiters' in definition;
  return 'weaponSlotType' in definition && definition.weaponSlotType === slot.weaponSlotType;
}
