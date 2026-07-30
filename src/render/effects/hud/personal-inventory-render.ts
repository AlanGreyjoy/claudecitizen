/**
 * Grid, loadout, and detail panel rendering for personal inventory.
 */

import {
  Backpack,
  Boxes,
  Crosshair,
  Grid3X3,
  HeartPulse,
  Package,
  Shield,
  Shirt,
  type IconNode,
} from 'lucide';
import {
  ALL_PLAY_LOADOUT_SLOTS,
  type PlayLoadoutSlot,
} from '../../../player/inventory/loadout-slots';
import {
  findItemDefinition,
  itemCompatibleWithSlot,
  itemsByType,
  type InventoryState,
  type ItemDefinition,
  type ItemType,
  type PlayerItemStack,
} from '../../../player/inventory/types';
import {
  equippedWearableAtSlot,
  resolveEquippedWearables,
} from '../../../player/inventory/wearable-loadout';
import { createUiIcon } from '../../../ui/icons';
import { paintItemIcon } from './item-icon';
import { renderPersonalInventoryLoadout, slotDefinition } from './personal-inventory-loadout';
import type { PersonalInventoryElements } from './personal-inventory';
import {
  INVENTORY_DND_TYPE,
  type InventoryFilter,
  type InventorySort,
  type PersonalInventoryUiState,
  type SelectedAction,
} from './personal-inventory-types';

export { INVENTORY_DND_TYPE };
export type { InventoryFilter, InventorySort, PersonalInventoryUiState, SelectedAction };

const PERSONAL_SOFT_CAPACITY = 48;
const ITEM_TYPE_ORDER: readonly ItemType[] = [
  'weapon',
  'backpack',
  'consumable',
  'armor',
  'clothing',
  'material',
  'misc',
];
const RARITY_ORDER = new Map([
  ['legendary', 0],
  ['epic', 1],
  ['rare', 2],
  ['uncommon', 3],
  ['common', 4],
]);

const INVENTORY_FILTERS: Array<{
  id: InventoryFilter;
  label: string;
  icon: IconNode;
}> = [
  { id: 'all', label: 'All', icon: Grid3X3 },
  { id: 'weapon', label: 'Weapons', icon: Crosshair },
  { id: 'backpack', label: 'Backpacks', icon: Backpack },
  { id: 'consumable', label: 'Consumables', icon: HeartPulse },
  { id: 'armor', label: 'Armor', icon: Shield },
  { id: 'clothing', label: 'Clothing', icon: Shirt },
  { id: 'material', label: 'Materials', icon: Boxes },
  { id: 'misc', label: 'Misc', icon: Package },
];

export interface PersonalInventoryRenderDeps {
  elements: PersonalInventoryElements;
  equipToSlot: (slotId: string, itemDefinitionId: string | null) => Promise<void>;
  onFilterChange: () => void;
  state: PersonalInventoryUiState;
}

function consumableCanBeUsed(definition: ItemDefinition): boolean {
  return (
    definition.itemType === 'consumable' &&
    ((definition.hungerRestore01 ?? 0) > 0 ||
      (definition.thirstRestore01 ?? 0) > 0 ||
      (definition.healthRestore01 ?? 0) > 0)
  );
}

function appendConsumableRestoreStats(
  appendStat: (label: string, value: string) => void,
  definition: ItemDefinition,
): void {
  const restores: Array<{ label: string; amount: number }> = [
    { label: 'Hunger', amount: definition.hungerRestore01 ?? 0 },
    { label: 'Thirst', amount: definition.thirstRestore01 ?? 0 },
    { label: 'Health', amount: definition.healthRestore01 ?? 0 },
  ];
  for (const entry of restores) {
    if (entry.amount > 0) {
      appendStat(entry.label, `+${Math.round(entry.amount * 100)}%`);
    }
  }
}

function formatCapacity(used: number, max: number, unit: string): string {
  const pct = max > 0 ? Math.round((used / max) * 100) : 0;
  return `${used}/${max} ${unit} · ${pct}%`;
}

function rarityClass(rarity: string): string {
  return rarity.toLowerCase().replace(/[^a-z0-9-]/g, '') || 'unknown';
}

function itemTypeIndex(itemType: ItemType): number {
  const index = ITEM_TYPE_ORDER.indexOf(itemType);
  return index < 0 ? ITEM_TYPE_ORDER.length : index;
}

export function createPersonalInventoryRender(deps: PersonalInventoryRenderDeps) {
  const { elements, equipToSlot, onFilterChange, state } = deps;

  function updateFilterSelection(): void {
    for (const button of elements.filtersEl.querySelectorAll<HTMLButtonElement>(
      '.sc-personal-inv-filter',
    )) {
      const active = button.dataset.inventoryFilter === state.inventoryFilter;
      button.classList.toggle('is-active', active);
      button.setAttribute('aria-selected', active ? 'true' : 'false');
    }
  }

  function ensureFilters(): void {
    if (state.filtersBuilt) return;
    state.filtersBuilt = true;
    elements.filtersEl.replaceChildren();
    elements.filtersEl.setAttribute('role', 'tablist');
    elements.filtersEl.setAttribute('aria-label', 'Inventory categories');
    for (const filter of INVENTORY_FILTERS) {
      const button = document.createElement('button');
      button.type = 'button';
      button.className = 'sc-personal-inv-filter';
      button.dataset.inventoryFilter = filter.id;
      button.title = filter.label;
      button.setAttribute('role', 'tab');
      button.append(
        createUiIcon(filter.icon, {
          className: 'sc-personal-inv-filter-icon',
          size: 18,
          strokeWidth: 1.7,
        }),
      );
      const label = document.createElement('span');
      label.textContent = filter.label;
      button.append(label);
      button.addEventListener('click', () => {
        state.inventoryFilter = filter.id;
        state.selectedItemId = null;
        updateFilterSelection();
        onFilterChange();
      });
      elements.filtersEl.append(button);
    }
    updateFilterSelection();
  }

  function renderCapacity(inventory: InventoryState): void {
    const backpackId = inventory.loadout.backpack;
    const backpack = backpackId
      ? findItemDefinition(inventory.catalog, backpackId)
      : undefined;
    const itemCount = inventory.items.reduce((sum, stack) => sum + stack.quantity, 0);
    if (backpack?.capacityLiters != null && backpack.capacityLiters > 0) {
      const max = backpack.capacityLiters;
      const used = Math.min(itemCount, max);
      elements.capacityFillEl.style.width = `${Math.min(100, (used / max) * 100)}%`;
      elements.capacityLabelEl.textContent = formatCapacity(used, max, 'L');
      return;
    }
    const used = Math.min(itemCount, PERSONAL_SOFT_CAPACITY);
    elements.capacityFillEl.style.width = `${(used / PERSONAL_SOFT_CAPACITY) * 100}%`;
    elements.capacityLabelEl.textContent = formatCapacity(
      used,
      PERSONAL_SOFT_CAPACITY,
      'slots',
    );
  }

  function sortStacks(
    stacks: PlayerItemStack[],
    inventory: InventoryState,
  ): PlayerItemStack[] {
    const collator = new Intl.Collator(undefined, { numeric: true, sensitivity: 'base' });
    return [...stacks].sort((left, right) => {
      const leftDef = findItemDefinition(inventory.catalog, left.itemDefinitionId);
      const rightDef = findItemDefinition(inventory.catalog, right.itemDefinitionId);
      if (!leftDef || !rightDef) return leftDef ? -1 : rightDef ? 1 : 0;
      if (state.inventorySort === 'name') return collator.compare(leftDef.name, rightDef.name);
      if (state.inventorySort === 'quantity') {
        return right.quantity - left.quantity || collator.compare(leftDef.name, rightDef.name);
      }
      if (state.inventorySort === 'rarity') {
        const leftRank = RARITY_ORDER.get(leftDef.rarity.toLowerCase()) ?? RARITY_ORDER.size;
        const rightRank = RARITY_ORDER.get(rightDef.rarity.toLowerCase()) ?? RARITY_ORDER.size;
        return leftRank - rightRank || collator.compare(leftDef.name, rightDef.name);
      }
      return (
        itemTypeIndex(leftDef.itemType) - itemTypeIndex(rightDef.itemType) ||
        collator.compare(leftDef.subType, rightDef.subType) ||
        collator.compare(leftDef.name, rightDef.name)
      );
    });
  }

  function filteredStacks(inventory: InventoryState): PlayerItemStack[] {
    const typeFilter = state.inventoryFilter === 'all' ? null : state.inventoryFilter;
    let stacks = itemsByType(inventory, typeFilter);
    const query = state.searchQuery.trim().toLowerCase();
    if (query) {
      stacks = stacks.filter((stack) => {
        const definition = findItemDefinition(inventory.catalog, stack.itemDefinitionId);
        if (!definition) return false;
        return (
          definition.name.toLowerCase().includes(query) ||
          definition.subType.toLowerCase().includes(query) ||
          definition.itemType.toLowerCase().includes(query)
        );
      });
    }
    return sortStacks(stacks, inventory);
  }

  function equippedSlotForItem(inventory: InventoryState, itemId: string): string | null {
    const definition = findItemDefinition(inventory.catalog, itemId);
    if (definition?.wearableSlotType) {
      return resolveEquippedWearables(inventory).find((entry) => entry.itemId === itemId)
        ?.primarySlotType ?? null;
    }
    const direct = Object.entries(inventory.loadout).find(([, equipped]) => equipped === itemId);
    return direct?.[0] ?? null;
  }

  function clearDropHighlights(): void {
    for (const element of elements.rootEl.querySelectorAll('.is-drop-ok, .is-drop-bad')) {
      element.classList.remove('is-drop-ok', 'is-drop-bad');
    }
  }

  function renderGrid(inventory: InventoryState): void {
    elements.gridEl.replaceChildren();
    const stacks = filteredStacks(inventory);
    state.visibleItemIds = stacks.map((stack) => stack.itemDefinitionId);
    if (stacks.length === 0) {
      const empty = document.createElement('div');
      empty.className = 'sc-personal-inv-empty';
      const title = document.createElement('strong');
      title.textContent = 'No matching items';
      const detail = document.createElement('span');
      detail.textContent = state.searchQuery ? 'Adjust your search or category filter.' : 'This category is empty.';
      empty.append(title, detail);
      elements.gridEl.append(empty);
      return;
    }

    if (!state.selectedItemId || !findItemDefinition(inventory.catalog, state.selectedItemId)) {
      state.selectedItemId = stacks[0]?.itemDefinitionId ?? null;
    }

    for (const stack of stacks) {
      const definition = findItemDefinition(inventory.catalog, stack.itemDefinitionId);
      if (!definition) continue;
      const button = document.createElement('button');
      button.type = 'button';
      button.className = `sc-personal-inv-grid-slot is-rarity-${rarityClass(definition.rarity)}`;
      button.classList.toggle('is-selected', stack.itemDefinitionId === state.selectedItemId);
      button.title = definition.name;
      button.draggable = true;
      button.dataset.itemId = stack.itemDefinitionId;
      button.tabIndex = stack.itemDefinitionId === state.selectedItemId ? 0 : -1;
      button.setAttribute('role', 'gridcell');
      button.setAttribute('aria-label', `${definition.name}, quantity ${stack.quantity}`);

      const icon = document.createElement('span');
      icon.className = 'sc-personal-inv-grid-icon';
      paintItemIcon(icon, definition);

      const qty = document.createElement('span');
      qty.className = 'sc-personal-inv-grid-qty';
      qty.textContent = stack.quantity > 1 ? `${stack.quantity}×` : '';

      if (equippedSlotForItem(inventory, stack.itemDefinitionId)) {
        const badge = document.createElement('span');
        badge.className = 'sc-personal-inv-equipped-badge';
        badge.textContent = 'E';
        badge.title = 'Equipped';
        button.append(badge);
      }

      button.append(icon, qty);
      button.addEventListener('click', () => {
        state.selectedItemId = stack.itemDefinitionId;
        renderGrid(inventory);
        renderDetails(inventory);
      });
      button.addEventListener('dragstart', (event) => {
        state.dragItemId = stack.itemDefinitionId;
        state.dragFromSlotId = null;
        event.dataTransfer?.setData(INVENTORY_DND_TYPE, stack.itemDefinitionId);
        if (event.dataTransfer) event.dataTransfer.effectAllowed = 'move';
        button.classList.add('is-dragging');
      });
      button.addEventListener('dragend', () => {
        state.dragItemId = null;
        state.dragFromSlotId = null;
        button.classList.remove('is-dragging');
        clearDropHighlights();
      });
      elements.gridEl.append(button);
    }
  }

  function compatibleSlots(
    inventory: InventoryState,
    definition: ItemDefinition,
  ): PlayLoadoutSlot[] {
    return ALL_PLAY_LOADOUT_SLOTS.filter((slot) =>
      itemCompatibleWithSlot(definition, slot, inventory.loadout),
    );
  }

  function slotIsOccupied(inventory: InventoryState, slot: PlayLoadoutSlot): boolean {
    return Boolean(slotDefinition(inventory, slot).itemId);
  }

  function selectedAction(inventory: InventoryState): SelectedAction | null {
    if (!state.selectedItemId) return null;
    const equippedSlot = equippedSlotForItem(inventory, state.selectedItemId);
    if (equippedSlot) return { kind: 'unequip', slotId: equippedSlot };
    const definition = findItemDefinition(inventory.catalog, state.selectedItemId);
    if (!definition) return null;
    if (consumableCanBeUsed(definition)) return { kind: 'use' };
    const slots = compatibleSlots(inventory, definition);
    const preferred = slots.find((slot) => !slotIsOccupied(inventory, slot)) ?? slots[0];
    if (!preferred) return null;
    const replacesWearable =
      preferred.kind === 'wearable' &&
      (definition.occupiedSlotTypes ?? [preferred.wearableSlotType]).some((slotType) =>
        Boolean(equippedWearableAtSlot(inventory, slotType)),
      );
    return {
      kind: slotIsOccupied(inventory, preferred) || replacesWearable ? 'replace' : 'equip',
      slotId: preferred.id,
    };
  }

  function renderDetails(inventory: InventoryState): void {
    elements.detailEl.replaceChildren();
    const stack = inventory.items.find((entry) => entry.itemDefinitionId === state.selectedItemId);
    const definition = state.selectedItemId
      ? findItemDefinition(inventory.catalog, state.selectedItemId)
      : undefined;
    if (!stack || !definition) {
      const empty = document.createElement('div');
      empty.className = 'sc-personal-inv-detail-empty';
      empty.textContent = 'Select an item to inspect it.';
      elements.detailEl.append(empty);
      elements.quickEquipBtnEl.disabled = true;
      elements.quickEquipBtnEl.textContent = 'No action';
      return;
    }

    const top = document.createElement('div');
    top.className = 'sc-personal-inv-detail-top';
    const icon = document.createElement('div');
    icon.className = 'sc-personal-inv-detail-icon';
    paintItemIcon(icon, definition);
    const identity = document.createElement('div');
    identity.className = 'sc-personal-inv-detail-identity';
    const rarity = document.createElement('span');
    rarity.className = `sc-personal-inv-detail-rarity is-rarity-${rarityClass(definition.rarity)}`;
    rarity.textContent = definition.rarity;
    const name = document.createElement('h3');
    name.textContent = definition.name;
    const type = document.createElement('span');
    type.className = 'sc-personal-inv-detail-type';
    type.textContent = `${definition.itemType} · ${definition.subType}`;
    identity.append(rarity, name, type);
    top.append(icon, identity);
    elements.detailEl.append(top);

    const stats = document.createElement('div');
    stats.className = 'sc-personal-inv-detail-stats';
    elements.detailEl.append(stats);
    const appendStat = (label: string, value: string) => {
      const stat = document.createElement('span');
      stat.className = 'sc-personal-inv-detail-stat';
      const statLabel = document.createElement('span');
      statLabel.textContent = label;
      const statValue = document.createElement('strong');
      statValue.textContent = value;
      stat.append(statLabel, statValue);
      stats.append(stat);
    };
    appendStat('Quantity', String(stack.quantity));
    if (definition.wearableSlotType) {
      appendStat('Slot', definition.wearableSlotType);
      appendStat('Coverage', (definition.occupiedSlotTypes ?? [definition.wearableSlotType]).join(' + '));
    }
    if (definition.capacityLiters != null) {
      appendStat('Capacity', `${definition.capacityLiters} L`);
    }
    if (definition.emptyMassKg != null) {
      appendStat('Mass', `${definition.emptyMassKg} kg`);
    }
    appendConsumableRestoreStats(appendStat, definition);

    const description = document.createElement('p');
    description.className = 'sc-personal-inv-detail-description';
    description.textContent = definition.description || 'No item description available.';
    elements.detailEl.append(description);

    const action = selectedAction(inventory);
    elements.quickEquipBtnEl.disabled = state.busy || !action;
    elements.quickEquipBtnEl.textContent = action
      ? action.kind === 'unequip'
        ? 'Unequip'
        : action.kind === 'replace'
          ? 'Replace'
          : action.kind === 'use'
            ? 'Use'
            : 'Equip'
      : 'No action';
  }

  function renderLoadout(inventory: InventoryState): void {
    renderPersonalInventoryLoadout({
      elements,
      equipToSlot,
      inventory,
      onSelectItem: (itemId) => {
        state.selectedItemId = itemId;
        renderDetails(inventory);
        renderGrid(inventory);
      },
      state,
    });
  }

  function focusSelectedGridItem(): void {
    const selected = state.selectedItemId
      ? elements.gridEl.querySelector<HTMLButtonElement>(
          `[data-item-id="${CSS.escape(state.selectedItemId)}"]`,
        )
      : null;
    selected?.focus({ preventScroll: true });
  }

  function moveGridSelection(direction: -1 | 1, vertical: boolean, inventory: InventoryState): void {
    if (state.visibleItemIds.length === 0) return;
    const currentIndex = state.selectedItemId ? state.visibleItemIds.indexOf(state.selectedItemId) : -1;
    const columns = Math.max(
      1,
      getComputedStyle(elements.gridEl).gridTemplateColumns.split(' ').filter(Boolean).length,
    );
    const delta = vertical ? direction * columns : direction;
    const nextIndex = Math.max(0, Math.min(state.visibleItemIds.length - 1, currentIndex < 0 ? 0 : currentIndex + delta));
    state.selectedItemId = state.visibleItemIds[nextIndex] ?? null;
    renderGrid(inventory);
    renderDetails(inventory);
    focusSelectedGridItem();
  }

  return {
    ensureFilters,
    focusSelectedGridItem,
    moveGridSelection,
    renderCapacity,
    renderDetails,
    renderGrid,
    renderLoadout,
    selectedAction,
  };
}
