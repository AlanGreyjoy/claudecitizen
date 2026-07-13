import * as THREE from 'three';
import type { SidekickCatalog } from '../../../player/character_creator/sidekick_manifest';
import type { SidekickCharacterDefinition } from '../../../player/character_creator/sidekick_definition';
import { getBaseModelUrl, getPartMeshUrl } from '../../../player/character_creator/sidekick_catalog';
import {
  createSharedBoneMap,
  getSharedSkeletonRoot,
  hideBaseRenderMeshes,
  loadBaseRigScene,
  loadPartMeshes,
} from './load_part';

const placeholderMaterial = new THREE.MeshStandardMaterial({
  color: 0xc8d0dc,
  metalness: 0.1,
  roughness: 0.75,
});

export interface AssembledSidekickCharacter {
  root: THREE.Group;
  dispose: () => void;
}

export async function assembleSidekickCharacter(
  catalog: SidekickCatalog,
  definition: SidekickCharacterDefinition,
): Promise<AssembledSidekickCharacter> {
  const root = new THREE.Group();
  root.name = definition.name || 'Sidekick Character';

  const baseScene = await loadBaseRigScene(getBaseModelUrl(catalog));
  hideBaseRenderMeshes(baseScene);
  const skeletonRoot = getSharedSkeletonRoot(baseScene);
  const boneMap = createSharedBoneMap(baseScene);
  root.add(baseScene);

  const partMeshes: THREE.SkinnedMesh[] = [];
  const uniquePartNames = [...new Set(definition.parts.map((part) => part.name).filter(Boolean))];

  for (const partName of uniquePartNames) {
    const meshUrl = getPartMeshUrl(catalog, partName);
    if (!meshUrl) {
      console.warn(`[sidekick] Missing mesh URL for part "${partName}"`);
      continue;
    }

    try {
      const meshes = await loadPartMeshes(meshUrl, boneMap, skeletonRoot);
      for (const mesh of meshes) {
        mesh.material = placeholderMaterial;
        baseScene.add(mesh);
        partMeshes.push(mesh);
      }
    } catch (error) {
      console.warn(`[sidekick] Failed to load part "${partName}"`, error);
    }
  }

  root.updateMatrixWorld(true);

  return {
    root,
    dispose: () => {
      for (const mesh of partMeshes) {
        mesh.geometry.dispose();
        root.remove(mesh);
      }
      baseScene.traverse((object) => {
        if (object instanceof THREE.Mesh) {
          object.geometry.dispose();
          if (Array.isArray(object.material))
            object.material.forEach((material) => material.dispose());
          else
            object.material.dispose();
        }
      });
      root.remove(baseScene);
    },
  };
}
