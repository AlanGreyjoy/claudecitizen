import * as THREE from 'three';

export function buildBoneNameMap(root: THREE.Object3D): Map<string, THREE.Bone> {
  const map = new Map<string, THREE.Bone>();
  root.traverse((object) => {
    if (object instanceof THREE.Bone && !map.has(object.name))
      map.set(object.name, object);
  });
  return map;
}

export function findBoneByName(root: THREE.Object3D, boneName: string): THREE.Bone | null {
  let found: THREE.Bone | null = null;
  root.traverse((object) => {
    if (!found && object instanceof THREE.Bone && object.name === boneName)
      found = object;
  });
  return found;
}

export function findSkeletonRootBone(root: THREE.Object3D): THREE.Bone | null {
  return findBoneByName(root, 'root') ?? findFirstBone(root);
}

function findFirstBone(root: THREE.Object3D): THREE.Bone | null {
  let found: THREE.Bone | null = null;
  root.traverse((object) => {
    if (!found && object instanceof THREE.Bone)
      found = object;
  });
  return found;
}

export function findSkinnedMeshes(root: THREE.Object3D): THREE.SkinnedMesh[] {
  const meshes: THREE.SkinnedMesh[] = [];
  root.traverse((object) => {
    if (object instanceof THREE.SkinnedMesh)
      meshes.push(object);
  });
  return meshes;
}
