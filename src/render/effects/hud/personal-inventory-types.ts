import type { ItemType } from '../../../player/inventory/types';

export const INVENTORY_DND_TYPE = 'application/x-claudecitizen-inventory-item';

export type InventoryFilter = 'all' | ItemType;
export type InventorySort = 'type' | 'name' | 'rarity' | 'quantity';

export interface PersonalInventoryUiState {
  busy: boolean;
  dragFromSlotId: string | null;
  dragItemId: string | null;
  filtersBuilt: boolean;
  inventoryFilter: InventoryFilter;
  inventorySort: InventorySort;
  searchQuery: string;
  selectedItemId: string | null;
  visibleItemIds: string[];
}

export type SelectedAction =
  | { kind: 'equip' | 'replace' | 'unequip'; slotId: string }
  | { kind: 'use' };
