import type { WeaponSlotType } from '../../types/equipment';

export const ITEM_TYPES = [
  'consumable',
  'weapon',
  'backpack',
  'armor',
  'clothing',
  'material',
  'misc',
] as const;

export type ItemType = (typeof ITEM_TYPES)[number];

export const WEARABLE_SLOT_TYPES = [
  'head',
  'torso',
  'arms',
  'legs',
  'feet',
] as const;

export type WearableSlotType = (typeof WEARABLE_SLOT_TYPES)[number];

export interface ItemDefinition {
  id: string;
  name: string;
  description: string;
  itemType: ItemType;
  subType: string;
  prefabId: string | null;
  iconUrl: string | null;
  stackMax: number;
  costArc: number;
  rarity: string;
  /** Present for weapons. */
  weaponSlotType?: WeaponSlotType;
  /** Present for backpacks. */
  capacityLiters?: number;
  emptyMassKg?: number;
  /** Present for armor and clothing backed by a Sidekick part preset. */
  wearableSlotType?: WearableSlotType;
  occupiedSlotTypes?: WearableSlotType[];
  sidekickPartPresetId?: number;
}

export interface PlayerItemStack {
  itemDefinitionId: string;
  quantity: number;
}

/** Slot id → equipped itemDefinitionId. */
export type LoadoutState = Record<string, string>;

export interface InventoryState {
  catalog: ItemDefinition[];
  items: PlayerItemStack[];
  loadout: LoadoutState;
}

export function normalizeInventoryState(value: unknown): InventoryState {
  if (!value || typeof value !== 'object') {
    return { catalog: [], items: [], loadout: {} };
  }
  const source = value as Partial<InventoryState>;
  return {
    catalog: Array.isArray(source.catalog) ? (source.catalog as ItemDefinition[]) : [],
    items: Array.isArray(source.items) ? (source.items as PlayerItemStack[]) : [],
    loadout:
      source.loadout && typeof source.loadout === 'object' && !Array.isArray(source.loadout)
        ? { ...(source.loadout as LoadoutState) }
        : {},
  };
}

export function findItemDefinition(
  catalog: ItemDefinition[],
  itemDefinitionId: string,
): ItemDefinition | undefined {
  return catalog.find((entry) => entry.id === itemDefinitionId);
}

export function itemQuantity(state: InventoryState, itemDefinitionId: string): number {
  return state.items.find((entry) => entry.itemDefinitionId === itemDefinitionId)?.quantity ?? 0;
}

export function itemsByType(state: InventoryState, itemType: ItemType | null): PlayerItemStack[] {
  const owned = state.items.filter((entry) => entry.quantity > 0);
  if (!itemType) return owned;
  return owned.filter((entry) => {
    const definition = findItemDefinition(state.catalog, entry.itemDefinitionId);
    return definition?.itemType === itemType;
  });
}

export function groupStacksByType(
  state: InventoryState,
): Map<ItemType, Array<{ definition: ItemDefinition; quantity: number }>> {
  const grouped = new Map<ItemType, Array<{ definition: ItemDefinition; quantity: number }>>();
  for (const stack of state.items) {
    if (stack.quantity <= 0) continue;
    const definition = findItemDefinition(state.catalog, stack.itemDefinitionId);
    if (!definition) continue;
    const bucket = grouped.get(definition.itemType) ?? [];
    bucket.push({ definition, quantity: stack.quantity });
    grouped.set(definition.itemType, bucket);
  }
  return grouped;
}

/** First compatible empty loadout slot for an item, or null if none. */
export function findQuickEquipSlot(
  state: InventoryState,
  itemDefinitionId: string,
  slots: ReadonlyArray<{
    id: string;
    kind: 'weapon' | 'backpack' | 'wearable';
    weaponSlotType?: WeaponSlotType;
    wearableSlotType?: WearableSlotType;
    requiresSlotId?: string;
  }>,
): string | null {
  const definition = findItemDefinition(state.catalog, itemDefinitionId);
  if (!definition) return null;
  for (const slot of slots) {
    if (state.loadout[slot.id]) continue;
    if (slot.requiresSlotId && !state.loadout[slot.requiresSlotId]) continue;
    if (slot.kind === 'backpack' && definition.itemType === 'backpack') return slot.id;
    if (
      slot.kind === 'wearable' &&
      definition.wearableSlotType === slot.wearableSlotType &&
      (definition.itemType === 'armor' || definition.itemType === 'clothing')
    ) {
      return slot.id;
    }
    if (
      slot.kind === 'weapon' &&
      definition.itemType === 'weapon' &&
      definition.weaponSlotType === slot.weaponSlotType
    ) {
      return slot.id;
    }
  }
  return null;
}

export function itemCompatibleWithSlot(
  definition: ItemDefinition,
  slot: {
    kind: 'weapon' | 'backpack' | 'wearable';
    weaponSlotType?: WeaponSlotType;
    wearableSlotType?: WearableSlotType;
    requiresSlotId?: string;
  },
  loadout: LoadoutState,
): boolean {
  if (slot.requiresSlotId && !loadout[slot.requiresSlotId]) return false;
  if (slot.kind === 'backpack') return definition.itemType === 'backpack';
  if (slot.kind === 'wearable') {
    return (
      (definition.itemType === 'armor' || definition.itemType === 'clothing') &&
      definition.wearableSlotType === slot.wearableSlotType
    );
  }
  return (
    definition.itemType === 'weapon' && definition.weaponSlotType === slot.weaponSlotType
  );
}
