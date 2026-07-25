import type * as THREE from 'three';
import type { BaseCharacterEquipmentV1, BaseCharacterType } from '../../player/equipment/base-character-equipment';
import type { PrefabEntity } from '../../world/prefabs/schema';
import {
  resolveEquipmentTransformTarget,
  type MountEditMode,
} from './base-character-equipment-transform';
import type { CatalogDefinition } from './base-character-equipment-utils';
import { currentDrawnMount, currentMount, currentSlot } from './base-character-equipment-avatar';

export interface EquipmentTransformLookupParams {
  documentState: BaseCharacterEquipmentV1 | null;
  selectedType: BaseCharacterType;
  selectedSlotId: string;
  mountEditMode: MountEditMode;
  assignments: Map<string, CatalogDefinition>;
  activeBackpackPrefabId: string | null;
  weaponPreviewRoots: Map<string, THREE.Object3D>;
  weaponGripEntities: Map<string, PrefabEntity>;
  drawnPivots: Map<string, THREE.Group>;
  mountPivots: Map<string, THREE.Group>;
  backpackSocketObjects: Map<string, THREE.Object3D>;
  backpackSocketEntities: Map<string, PrefabEntity>;
}

export function currentTransformTarget(
  params: EquipmentTransformLookupParams,
): ReturnType<typeof resolveEquipmentTransformTarget> {
  const {
    documentState,
    selectedType,
    selectedSlotId,
    mountEditMode,
    assignments,
    activeBackpackPrefabId,
    weaponPreviewRoots,
    weaponGripEntities,
    drawnPivots,
    mountPivots,
    backpackSocketObjects,
    backpackSocketEntities,
  } = params;
  const slot = currentSlot(documentState, selectedSlotId);
  if (!slot) return null;
  return resolveEquipmentTransformTarget({
    slot,
    mountEditMode,
    selectedType,
    selectedSlotId,
    assignments,
    activeBackpackPrefabId,
    weaponPreviewRoots,
    weaponGripEntities,
    drawnPivots,
    mountPivots,
    backpackSocketObjects,
    backpackSocketEntities,
    currentDrawnMount: () => currentDrawnMount(documentState, selectedType, selectedSlotId),
    currentMount: () => currentMount(documentState, selectedType, selectedSlotId),
  });
}
