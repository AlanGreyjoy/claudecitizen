import {
  findItemDefinition,
  WEARABLE_SLOT_TYPES,
  type InventoryState,
  type ItemDefinition,
  type WearableSlotType,
} from './types';

export interface EquippedWearable {
  definition: ItemDefinition;
  itemId: string;
  occupiedSlotTypes: readonly WearableSlotType[];
  primarySlotType: WearableSlotType;
}

function normalizedOccupiedSlots(definition: ItemDefinition): WearableSlotType[] {
  const primary = definition.wearableSlotType;
  if (!primary) return [];
  const allowed = new Set<WearableSlotType>(WEARABLE_SLOT_TYPES);
  const result: WearableSlotType[] = [primary];
  for (const slot of definition.occupiedSlotTypes ?? []) {
    if (allowed.has(slot) && !result.includes(slot)) result.push(slot);
  }
  return result;
}

/** Resolve wearable loadout entries in deterministic slot order, ignoring stale conflicts. */
export function resolveEquippedWearables(inventory: InventoryState): EquippedWearable[] {
  const occupied = new Set<WearableSlotType>();
  const resolved: EquippedWearable[] = [];
  for (const primarySlotType of WEARABLE_SLOT_TYPES) {
    const itemId = inventory.loadout[primarySlotType];
    if (!itemId) continue;
    const definition = findItemDefinition(inventory.catalog, itemId);
    if (
      !definition ||
      definition.wearableSlotType !== primarySlotType ||
      (definition.itemType !== 'armor' && definition.itemType !== 'clothing')
    ) {
      continue;
    }
    const occupiedSlotTypes = normalizedOccupiedSlots(definition);
    if (occupiedSlotTypes.some((slot) => occupied.has(slot))) continue;
    for (const slot of occupiedSlotTypes) occupied.add(slot);
    resolved.push({ definition, itemId, occupiedSlotTypes, primarySlotType });
  }
  return resolved;
}

export function equippedWearableAtSlot(
  inventory: InventoryState,
  slotType: WearableSlotType,
): EquippedWearable | null {
  return resolveEquippedWearables(inventory).find(
    (entry) => entry.occupiedSlotTypes.includes(slotType),
  ) ?? null;
}

export function wearableOccupiesSlot(
  definition: ItemDefinition,
  slotType: WearableSlotType,
): boolean {
  return normalizedOccupiedSlots(definition).includes(slotType);
}
