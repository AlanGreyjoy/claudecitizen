import * as THREE from "three";
import type { CharacterEquipmentSlotV1, CharacterBoneMountV1 } from "../../player/equipment/base_character_equipment";
import type { PrefabEntity, PrefabTransform } from "../../world/prefabs/schema";

export type EquipmentTransformSource = "character" | "backpack-socket" | "weapon-grip";

export interface EquipmentTransformTarget {
  object: THREE.Object3D;
  transform: PrefabTransform;
  source: EquipmentTransformSource;
  prefabId?: string;
  label: string;
}

export type MountEditMode = "holster" | "drawn" | "weapon-grip";

export interface EquipmentTransformLookup {
  slot: CharacterEquipmentSlotV1;
  mountEditMode: MountEditMode;
  selectedType: 1 | 2;
  selectedSlotId: string;
  assignments: Map<string, { name: string; prefabId?: string | null; itemType: string }>;
  activeBackpackPrefabId: string | null;
  weaponPreviewRoots: Map<string, THREE.Object3D>;
  weaponGripEntities: Map<string, PrefabEntity>;
  drawnPivots: Map<string, THREE.Group>;
  mountPivots: Map<string, THREE.Group>;
  backpackSocketObjects: Map<string, THREE.Object3D>;
  backpackSocketEntities: Map<string, PrefabEntity>;
  currentDrawnMount: () => CharacterBoneMountV1 | null;
  currentMount: () => CharacterBoneMountV1 | null;
}

function resolveWeaponGripTarget(
  lookup: EquipmentTransformLookup,
): EquipmentTransformTarget | null {
  const {
    selectedSlotId,
    assignments,
    weaponPreviewRoots,
    weaponGripEntities,
  } = lookup;
  const weaponRoot = weaponPreviewRoots.get(selectedSlotId);
  const gripEntity = weaponGripEntities.get(selectedSlotId);
  const assignment = assignments.get(selectedSlotId);
  if (!weaponRoot || !gripEntity || !assignment?.prefabId) return null;
  return {
    object: weaponRoot,
    transform: gripEntity.transform,
    source: "weapon-grip",
    prefabId: assignment.prefabId,
    label: `Weapon grip · ${assignment.name}`,
  };
}

function resolveDrawnMountTarget(
  lookup: EquipmentTransformLookup,
): EquipmentTransformTarget | null {
  const { selectedType, currentDrawnMount, drawnPivots, selectedSlotId } = lookup;
  const drawn = currentDrawnMount();
  const pivot = drawnPivots.get(selectedSlotId);
  if (!drawn || !pivot) return null;
  return {
    object: pivot,
    transform: drawn,
    source: "character",
    label: `Type ${selectedType} hand bone mount`,
  };
}

function resolveBackpackSocketTarget(
  lookup: EquipmentTransformLookup,
): EquipmentTransformTarget | null {
  const {
    slot,
    activeBackpackPrefabId,
    backpackSocketObjects,
    backpackSocketEntities,
  } = lookup;
  if (!slot.providerSocket || !activeBackpackPrefabId) return null;
  const object = backpackSocketObjects.get(slot.providerSocket.socketId);
  const entity = backpackSocketEntities.get(slot.providerSocket.socketId);
  if (!object || !entity) {
    return slot.requiresSlotId ? null : resolveHolsterMountTarget(lookup);
  }
  return {
    object,
    transform: entity.transform,
    source: "backpack-socket",
    prefabId: activeBackpackPrefabId,
    label: `Backpack socket · ${slot.providerSocket.socketId}`,
  };
}

function resolveHolsterMountTarget(
  lookup: EquipmentTransformLookup,
): EquipmentTransformTarget | null {
  const { slot, selectedType, currentMount, mountPivots, selectedSlotId } = lookup;
  const mount = currentMount();
  const pivot = mountPivots.get(selectedSlotId);
  if (!mount || !pivot) return null;
  return {
    object: pivot,
    transform: mount,
    source: "character",
    label: slot.providerSocket
      ? `Type ${selectedType} holster fallback`
      : `Type ${selectedType} holster mount`,
  };
}

export function resolveEquipmentTransformTarget(
  lookup: EquipmentTransformLookup | null,
): EquipmentTransformTarget | null {
  if (!lookup) return null;
  const { slot, mountEditMode, assignments } = lookup;
  if (slot.requiresSlotId && !assignments.has(slot.requiresSlotId)) return null;

  if (mountEditMode === "weapon-grip" && slot.kind === "weapon") {
    return resolveWeaponGripTarget(lookup);
  }
  if (mountEditMode === "drawn" && slot.kind === "weapon") {
    return resolveDrawnMountTarget(lookup);
  }
  if (slot.providerSocket && lookup.activeBackpackPrefabId) {
    return resolveBackpackSocketTarget(lookup);
  }
  return resolveHolsterMountTarget(lookup);
}
