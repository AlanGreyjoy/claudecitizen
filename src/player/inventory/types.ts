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
}

export interface PlayerItemStack {
  itemDefinitionId: string;
  quantity: number;
}

export interface InventoryState {
  catalog: ItemDefinition[];
  items: PlayerItemStack[];
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
