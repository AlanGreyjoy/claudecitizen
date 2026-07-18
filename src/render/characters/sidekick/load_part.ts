import * as THREE from 'three';
import { GLTFLoader, type GLTF } from 'three/examples/jsm/loaders/GLTFLoader';
import { buildBoneNameMap, findSkinnedMeshes, findSkeletonRootBone } from './skeleton_map';

const loader = new GLTFLoader();

let patchedNormalizeSkinWeights = false;

function ensureSkinnedGeometryAttributes(geometry: THREE.BufferGeometry): void {
  const skinIndex = geometry.attributes.skinIndex;
  if (!skinIndex || geometry.attributes.skinWeight)
    return;

  const weights = new Float32Array(skinIndex.count * 4);
  for (let i = 0; i < skinIndex.count; i++)
    weights[i * 4] = 1;

  geometry.setAttribute('skinWeight', new THREE.BufferAttribute(weights, 4));
}

function patchSkinnedMeshNormalizeSkinWeights(): void {
  if (patchedNormalizeSkinWeights)
    return;
  patchedNormalizeSkinWeights = true;

  const skinnedMeshProto = THREE.SkinnedMesh.prototype as THREE.SkinnedMesh & {
    normalizeSkinWeights: () => void;
  };
  const original = skinnedMeshProto.normalizeSkinWeights;

  skinnedMeshProto.normalizeSkinWeights = function normalizeSkinWeightsWithFallback(this: THREE.SkinnedMesh) {
    ensureSkinnedGeometryAttributes(this.geometry);
    if (!this.geometry.attributes.skinIndex || !this.geometry.attributes.skinWeight)
      return;
    original.call(this);
  };
}

patchSkinnedMeshNormalizeSkinWeights();

export function sanitizeSidekickMorphInfluences(
  weights: readonly number[],
): number[] {
  return weights.map((weight) => Number.isFinite(weight) ? weight : 0);
}

function loadGltf(url: string): Promise<GLTF> {
  return new Promise((resolve, reject) => {
    loader.load(url, resolve, undefined, reject);
  });
}

function cloneBoneSubtree(source: THREE.Object3D): THREE.Bone {
  const bone = new THREE.Bone();
  bone.name = source.name;
  bone.position.copy(source.position);
  bone.quaternion.copy(source.quaternion);
  bone.scale.copy(source.scale);
  bone.userData = { ...source.userData };
  for (const child of source.children) {
    if (child instanceof THREE.Mesh)
      continue;
    bone.add(cloneBoneSubtree(child));
  }
  return bone;
}

function findDescendantBoneByName(parent: THREE.Object3D, name: string): THREE.Bone | null {
  for (const child of parent.children) {
    if (child.name === name && child instanceof THREE.Bone)
      return child;
    const nested = findDescendantBoneByName(child, name);
    if (nested)
      return nested;
  }
  return null;
}

function rebuildBoneMap(boneMap: Map<string, THREE.Bone>, skeletonRoot: THREE.Bone): void {
  boneMap.clear();
  for (const [name, bone] of buildBoneNameMap(skeletonRoot))
    boneMap.set(name, bone);
}

/**
 * Port of Combiner.JoinAdditionalBonesToBoneArray: part meshes (hair, cloth, etc.)
 * often carry extra bones not present on the base rig. Graft those subtrees under
 * the matching parent in the shared skeleton so skin weights stay valid.
 */
export function graftAdditionalBones(
  sourceBones: readonly THREE.Bone[],
  boneMap: Map<string, THREE.Bone>,
  skeletonRoot: THREE.Bone,
): void {
  let grafted = false;

  for (const sourceBone of sourceBones) {
    if (boneMap.has(sourceBone.name))
      continue;

    const parentName = sourceBone.parent?.name;
    if (!parentName)
      continue;

    const sharedParent = boneMap.get(parentName);
    if (!sharedParent)
      continue;

    if (findDescendantBoneByName(sharedParent, sourceBone.name))
      continue;

    sharedParent.add(cloneBoneSubtree(sourceBone));
    grafted = true;
  }

  if (!grafted)
    return;

  skeletonRoot.updateMatrixWorld(true);
  rebuildBoneMap(boneMap, skeletonRoot);
}

export function remapSkinnedMesh(
  sourceMesh: THREE.SkinnedMesh,
  boneMap: Map<string, THREE.Bone>,
  fallbackBone: THREE.Bone,
): THREE.SkinnedMesh {
  graftAdditionalBones(sourceMesh.skeleton.bones, boneMap, fallbackBone);

  const remappedBones = sourceMesh.skeleton.bones.map((bone) => {
    const mapped = boneMap.get(bone.name);
    if (!mapped)
      console.warn(`[sidekick] Missing bone remap for "${bone.name}"`);
    return mapped ?? fallbackBone;
  });
  const skeleton = new THREE.Skeleton(remappedBones, sourceMesh.skeleton.boneInverses);
  const mesh = new THREE.SkinnedMesh(sourceMesh.geometry, sourceMesh.material);
  mesh.name = sourceMesh.name;
  mesh.castShadow = true;
  mesh.receiveShadow = true;
  mesh.bind(skeleton, sourceMesh.bindMatrix);
  mesh.skeleton = skeleton;
  mesh.geometry.computeBoundingSphere();
  if (sourceMesh.morphTargetInfluences) {
    // Older Sidekick GLBs may contain UnityGLTF's invalid string "NaN" as a
    // default morph weight. GLTFLoader carries that through as NaN, causing
    // the entire skinned mesh (most visibly the head) to disappear. Creator
    // state applies finite body values immediately after this neutralization.
    mesh.morphTargetInfluences = sanitizeSidekickMorphInfluences(
      sourceMesh.morphTargetInfluences,
    );
  }
  if (sourceMesh.morphTargetDictionary)
    mesh.morphTargetDictionary = { ...sourceMesh.morphTargetDictionary };
  mesh.updateMatrixWorld(true);
  return mesh;
}

export async function loadPartMeshes(
  meshUrl: string,
  boneMap: Map<string, THREE.Bone>,
  fallbackBone: THREE.Bone,
): Promise<THREE.SkinnedMesh[]> {
  const gltf = await loadGltf(meshUrl);
  const meshes: THREE.SkinnedMesh[] = [];
  for (const skinnedMesh of findSkinnedMeshes(gltf.scene)) {
    meshes.push(remapSkinnedMesh(skinnedMesh, boneMap, fallbackBone));
  }
  return meshes;
}

/**
 * glTF nodes are only promoted to THREE.Bone when referenced by a skin.
 * Skeleton-only base exports have a bone hierarchy but no skins, so promote
 * plain Object3D/Group nodes under the scene root into Bones.
 */
function promoteHierarchyToBones(root: THREE.Object3D): void {
  const convert = (object: THREE.Object3D): void => {
    for (const child of [...object.children])
      convert(child);

    if (object === root || object instanceof THREE.Bone || object instanceof THREE.Mesh)
      return;

    const parent = object.parent;
    if (!parent)
      return;

    const bone = new THREE.Bone();
    bone.name = object.name;
    bone.position.copy(object.position);
    bone.quaternion.copy(object.quaternion);
    bone.scale.copy(object.scale);
    bone.userData = { ...object.userData };

    for (const child of [...object.children])
      bone.add(child);

    const index = parent.children.indexOf(object);
    parent.remove(object);
    parent.children.splice(index, 0, bone);
    bone.parent = parent;
  };

  convert(root);
}

export async function loadBaseRigScene(baseModelUrl: string): Promise<THREE.Object3D> {
  const gltf = await loadGltf(baseModelUrl);
  for (const mesh of findSkinnedMeshes(gltf.scene)) {
    mesh.parent?.remove(mesh);
    mesh.geometry.dispose();
    if (Array.isArray(mesh.material))
      mesh.material.forEach((material) => material.dispose());
    else
      mesh.material.dispose();
  }
  promoteHierarchyToBones(gltf.scene);
  gltf.scene.updateMatrixWorld(true);
  return gltf.scene;
}

export function hideBaseRenderMeshes(baseScene: THREE.Object3D): void {
  // Base rig export should be skeleton-only; keep legacy render nodes visible
  // here because older exports may still contain meshes that callers expect.
  baseScene.visible = true;
}

export function getSharedSkeletonRoot(baseScene: THREE.Object3D): THREE.Bone {
  const rootBone = findSkeletonRootBone(baseScene);
  if (!rootBone)
    throw new Error('Sidekick base rig is missing a skeleton root bone.');
  return rootBone;
}

export function createSharedBoneMap(baseScene: THREE.Object3D): Map<string, THREE.Bone> {
  return buildBoneNameMap(baseScene);
}
