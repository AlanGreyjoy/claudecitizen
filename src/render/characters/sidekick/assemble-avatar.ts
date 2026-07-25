import * as THREE from 'three';
import type { SidekickCatalog } from '../../../player/character_creator/sidekick_manifest';
import type {
  SidekickCharacterDefinitionV2,
  SidekickSerializedBlendShapes,
  SidekickSerializedColorRow,
  SidekickSerializedMaterialEffects,
} from '../../../player/character_creator/sidekick_definition';
import { getBaseModelUrl, getPartMeshUrl } from '../../../player/character_creator/sidekick_catalog';
import {
  createSharedBoneMap,
  getSharedSkeletonRoot,
  hideBaseRenderMeshes,
  loadBaseRigScene,
  loadPartMeshes,
} from './load_part';
import { loadSidekickMaterialResources } from './materials';

export interface SidekickAvatarDiagnostics {
  rootId: string;
  activeParts: number;
  activeMeshes: number;
  cachedParts: number;
  loadingParts: number;
  morphTargets: string[];
  atlasCells: number;
}

export interface SidekickAvatarInstance {
  root: THREE.Group;
  applyDefinition: (definition: SidekickCharacterDefinitionV2) => Promise<void>;
  setPart: (partType: number, partName: string | null) => Promise<void>;
  setBodyShape: (values: SidekickSerializedBlendShapes) => void;
  setColors: (rows: readonly SidekickSerializedColorRow[]) => void;
  setMaterialEffects: (effects: SidekickSerializedMaterialEffects) => void;
  getDiagnostics: () => SidekickAvatarDiagnostics;
  getRenderedMeshCount: () => number;
  dispose: () => void;
}

/** Backward-compatible name retained for existing callers. */
export type AssembledSidekickCharacter = SidekickAvatarInstance;

const ATTACHMENT_BONES: Record<number, string> = {
  24: 'backAttach',
  25: 'hipAttachFront',
  26: 'hipAttachBack',
  27: 'hipAttach_l',
  28: 'hipAttach_r',
  29: 'shoulderAttach_l',
  30: 'shoulderAttach_r',
  31: 'elbowAttach_l',
  32: 'elbowAttach_r',
  33: 'kneeAttach_l',
  34: 'kneeAttach_r',
};

/** Map Sidekick/Unity 0..360 exports into signed degrees (356 → -4). */
function signedDegrees(degrees: number): number {
  const wrapped = ((degrees % 360) + 360) % 360;
  return wrapped > 180 ? wrapped - 360 : wrapped;
}

export function getSidekickBodyMorphWeight(
  morphName: string,
  body: SidekickSerializedBlendShapes,
): number | null {
  const lower = morphName.toLowerCase();
  if (lower.includes('masculinefeminine')) return (body.bodyTypeValue + 100) / 200;
  if (lower.includes('defaultskinny')) return Math.max(0, -body.bodySizeValue) / 100;
  if (lower.includes('defaultheavy')) return Math.max(0, body.bodySizeValue) / 100;
  if (lower.includes('defaultbuff') || lower.endsWith('buff')) return (body.muscleValue + 100) / 200;
  return null;
}

export function createSidekickSelectionGeneration(): {
  begin: (partType: number) => number;
  isCurrent: (partType: number, generation: number) => boolean;
} {
  const generations = new Map<number, number>();
  return {
    begin: (partType) => {
      const generation = (generations.get(partType) ?? 0) + 1;
      generations.set(partType, generation);
      return generation;
    },
    isCurrent: (partType, generation) => generations.get(partType) === generation,
  };
}

interface CachedPart {
  group: THREE.Group;
  lastUsed: number;
}

function disposeGroup(group: THREE.Group): void {
  group.traverse((object) => {
    if (object instanceof THREE.Mesh)
      object.geometry.dispose();
  });
  group.removeFromParent();
  group.clear();
}

export async function assembleSidekickCharacter(
  catalog: SidekickCatalog,
  initialDefinition: SidekickCharacterDefinitionV2,
  maxHiddenCache = 32,
): Promise<SidekickAvatarInstance> {
  const root = new THREE.Group();
  root.name = initialDefinition.name || 'Sidekick Character';
  root.userData.sidekickRootId = THREE.MathUtils.generateUUID();

  const [baseScene, materials] = await Promise.all([
    loadBaseRigScene(getBaseModelUrl(catalog)),
    loadSidekickMaterialResources(catalog),
  ]);
  hideBaseRenderMeshes(baseScene);
  const skeletonRoot = getSharedSkeletonRoot(baseScene);
  const boneMap = createSharedBoneMap(baseScene);
  root.add(baseScene);

  const baseBoneTransforms = new Map<string, {
    position: THREE.Vector3;
    quaternion: THREE.Quaternion;
    scale: THREE.Vector3;
  }>();
  for (const [name, bone] of boneMap) {
    baseBoneTransforms.set(name, {
      position: bone.position.clone(),
      quaternion: bone.quaternion.clone(),
      scale: bone.scale.clone(),
    });
  }

  const cache = new Map<string, CachedPart>();
  const inflight = new Map<string, Promise<THREE.Group>>();
  const activePartByType = new Map<number, string>();
  const selectionGeneration = createSidekickSelectionGeneration();
  let useCounter = 0;
  let currentBody = { ...initialDefinition.blendShapes };
  let disposed = false;

  const applyBodyToMesh = (mesh: THREE.SkinnedMesh): void => {
    const dictionary = mesh.morphTargetDictionary;
    const influences = mesh.morphTargetInfluences;
    if (!dictionary || !influences) return;
    for (const [name, index] of Object.entries(dictionary)) {
      const weight = getSidekickBodyMorphWeight(name, currentBody);
      if (weight !== null)
        influences[index] = THREE.MathUtils.clamp(weight, 0, 1);
    }
  };

  const bodyFactors = (): Record<number, number> => ({
    0: (currentBody.bodyTypeValue + 100) / 200,
    1: Math.max(0, currentBody.bodySizeValue) / 100,
    2: Math.max(0, -currentBody.bodySizeValue) / 100,
    3: (currentBody.muscleValue + 100) / 200,
  });

  const applyRigMovement = (): void => {
    const factors = bodyFactors();
    for (const [partTypeText, boneName] of Object.entries(ATTACHMENT_BONES)) {
      const bone = boneMap.get(boneName);
      const base = baseBoneTransforms.get(boneName);
      if (!bone || !base) continue;
      bone.position.copy(base.position);
      bone.quaternion.copy(base.quaternion);
      bone.scale.copy(base.scale);
      const rows = catalog.blendShapeRigMovement.filter(
        (movement) => movement.partType === Number(partTypeText),
      );
      for (const movement of rows) {
        const factor = factors[movement.blendType] ?? 0;
        bone.position.add(new THREE.Vector3(
          movement.maxOffsetX * factor,
          movement.maxOffsetY * factor,
          movement.maxOffsetZ * factor,
        ));
        // Sidekick exports small negative angles as 352..358 instead of -8..-2.
        // Applying 356° * 0.5 as 178° flips attachment bones (backpack upside down).
        const rotation = new THREE.Quaternion().setFromEuler(new THREE.Euler(
          THREE.MathUtils.degToRad(signedDegrees(movement.maxRotationX) * factor),
          THREE.MathUtils.degToRad(signedDegrees(movement.maxRotationY) * factor),
          THREE.MathUtils.degToRad(signedDegrees(movement.maxRotationZ) * factor),
          'XYZ',
        ));
        bone.quaternion.multiply(rotation);
      }
    }
    skeletonRoot.updateMatrixWorld(true);
  };

  const evictHidden = (): void => {
    const activeNames = new Set(activePartByType.values());
    const hidden = [...cache.entries()]
      .filter(([name]) => !activeNames.has(name))
      .sort((left, right) => left[1].lastUsed - right[1].lastUsed);
    while (hidden.length > maxHiddenCache) {
      const oldest = hidden.shift();
      if (!oldest) break;
      cache.delete(oldest[0]);
      disposeGroup(oldest[1].group);
    }
  };

  const loadPart = (partName: string): Promise<THREE.Group> => {
    const cached = cache.get(partName);
    if (cached) {
      cached.lastUsed = ++useCounter;
      return Promise.resolve(cached.group);
    }
    const existing = inflight.get(partName);
    if (existing) return existing;

    const promise = (async () => {
      const meshUrl = getPartMeshUrl(catalog, partName);
      if (!meshUrl)
        throw new Error(`Missing mesh URL for part "${partName}".`);
      const meshes = await loadPartMeshes(meshUrl, boneMap, skeletonRoot);
      if (disposed) {
        for (const mesh of meshes) mesh.geometry.dispose();
        throw new Error('Sidekick avatar was disposed while loading a part.');
      }
      const group = new THREE.Group();
      group.name = `SidekickPart:${partName}`;
      for (const mesh of meshes) {
        mesh.material = materials.material;
        applyBodyToMesh(mesh);
        group.add(mesh);
      }
      group.visible = false;
      baseScene.add(group);
      cache.set(partName, { group, lastUsed: ++useCounter });
      return group;
    })().finally(() => inflight.delete(partName));
    inflight.set(partName, promise);
    return promise;
  };

  const setPart = async (partType: number, partName: string | null): Promise<void> => {
    const generation = selectionGeneration.begin(partType);
    const previousName = activePartByType.get(partType);

    if (!partName) {
      if (previousName) {
        const previous = cache.get(previousName);
        if (previous) previous.group.visible = false;
      }
      activePartByType.delete(partType);
      evictHidden();
      return;
    }

    if (previousName === partName) {
      const current = cache.get(partName);
      if (current) {
        current.group.visible = true;
        current.lastUsed = ++useCounter;
        return;
      }
    }

    const nextGroup = await loadPart(partName);
    if (!selectionGeneration.isCurrent(partType, generation)) return;
    if (previousName && previousName !== partName) {
      const previous = cache.get(previousName);
      if (previous) previous.group.visible = false;
    }
    nextGroup.visible = true;
    activePartByType.set(partType, partName);
    cache.get(partName)!.lastUsed = ++useCounter;
    baseScene.updateMatrixWorld(true);
    evictHidden();
  };

  const setBodyShape = (values: SidekickSerializedBlendShapes): void => {
    currentBody = { ...values };
    for (const partName of activePartByType.values()) {
      cache.get(partName)?.group.traverse((object) => {
        if (object instanceof THREE.SkinnedMesh)
          applyBodyToMesh(object);
      });
    }
    applyRigMovement();
  };

  const setColors = (rows: readonly SidekickSerializedColorRow[]): void => materials.setColors(rows);
  const setMaterialEffects = (effects: SidekickSerializedMaterialEffects): void => {
    materials.setMaterialEffects(effects);
  };

  const applyDefinition = async (definition: SidekickCharacterDefinitionV2): Promise<void> => {
    const nextByType = new Map(definition.parts.map((part) => [part.partType as number, part.name]));
    const allTypes = new Set([...activePartByType.keys(), ...nextByType.keys()]);
    await Promise.all([...allTypes].map((partType) => setPart(partType, nextByType.get(partType) ?? null)));
    setBodyShape(definition.blendShapes);
    setColors(definition.colorRows);
    setMaterialEffects(definition.materialEffects);
    root.name = definition.name || root.name;
  };

  await applyDefinition(initialDefinition);
  root.updateMatrixWorld(true);

  const getRenderedMeshCount = (): number => {
    let count = 0;
    for (const partName of activePartByType.values()) {
      cache.get(partName)?.group.traverse((object) => {
        if (object instanceof THREE.SkinnedMesh && object.visible) count += 1;
      });
    }
    return count;
  };

  return {
    root,
    applyDefinition,
    setPart,
    setBodyShape,
    setColors,
    setMaterialEffects,
    getDiagnostics: () => {
      const morphTargets = new Set<string>();
      for (const partName of activePartByType.values()) {
        cache.get(partName)?.group.traverse((object) => {
          if (object instanceof THREE.SkinnedMesh) {
            for (const name of Object.keys(object.morphTargetDictionary ?? {}))
              morphTargets.add(name);
          }
        });
      }
      return {
        rootId: root.userData.sidekickRootId as string,
        activeParts: activePartByType.size,
        activeMeshes: getRenderedMeshCount(),
        cachedParts: cache.size,
        loadingParts: inflight.size,
        morphTargets: [...morphTargets].sort(),
        atlasCells: materials.getAtlasCellCount(),
      };
    },
    getRenderedMeshCount,
    dispose: () => {
      disposed = true;
      for (const cached of cache.values())
        disposeGroup(cached.group);
      cache.clear();
      materials.dispose();
      root.remove(baseScene);
    },
  };
}
