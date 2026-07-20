/**
 * BOTW-inspired personal inventory with Star Citizen presentation.
 * A dedicated Sidekick scene renders the character; DOM owns browsing and loadout interaction.
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
  GAME_SETTINGS_CHANGED_EVENT,
  loadGameSettings,
} from '../../../settings/game_settings';
import { getKeyboardBindingCodes } from '../../../flight/input_settings';
import { equipInventoryItem } from '../../../net/api';
import type { PlayerCharacterAppearanceV1 } from '../../../player/character_creator/player_character_appearance';
import {
  ALL_PLAY_LOADOUT_SLOTS,
  PLAY_LOADOUT_SLOTS,
  WEAPON_BAR_SLOT_IDS,
  WEARABLE_LOADOUT_SLOTS,
  type PlayLoadoutSlot,
} from '../../../player/inventory/loadout_slots';
import {
  findItemDefinition,
  itemCompatibleWithSlot,
  itemsByType,
  normalizeInventoryState,
  type InventoryState,
  type ItemDefinition,
  type ItemType,
  type PlayerItemStack,
} from '../../../player/inventory/types';
import {
  equippedWearableAtSlot,
  resolveEquippedWearables,
} from '../../../player/inventory/wearable_loadout';
import { createUiIcon } from '../../../ui/icons';
import { paintItemIcon } from './item_icon';
import { createInventoryAvatarPreview } from './inventory_avatar_preview';

export const INVENTORY_DND_TYPE = 'application/x-claudecitizen-inventory-item';

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

type InventoryFilter = 'all' | ItemType;
type InventorySort = 'type' | 'name' | 'rarity' | 'quantity';

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

export interface PersonalInventoryElements {
  rootEl: HTMLElement;
  searchEl: HTMLInputElement;
  sortEl: HTMLSelectElement;
  capacityFillEl: HTMLElement;
  capacityLabelEl: HTMLElement;
  filtersEl: HTMLElement;
  gridEl: HTMLElement;
  weaponBarsEl: HTMLElement;
  gearSlotsEl: HTMLElement;
  detailEl: HTMLElement;
  avatarCanvasEl: HTMLCanvasElement;
  statusEl: HTMLElement;
  quickEquipBtnEl: HTMLButtonElement;
  closeBtnEl: HTMLButtonElement;
}

export interface PersonalInventoryCallbacks {
  playerControls: { setInputSuppressed: (value: boolean) => void };
  getInventory: () => InventoryState | null;
  onInventoryResult: (inventory: InventoryState) => void;
  characterAppearance?: PlayerCharacterAppearanceV1 | null;
}

interface SelectedAction {
  kind: 'equip' | 'replace' | 'unequip';
  slotId: string;
}

function isTypingTarget(target: EventTarget | null): boolean {
  if (!(target instanceof HTMLElement)) return false;
  return (
    target.tagName === 'INPUT' ||
    target.tagName === 'SELECT' ||
    target.tagName === 'TEXTAREA' ||
    target.isContentEditable
  );
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

export function createPersonalInventory(
  elements: PersonalInventoryElements,
  callbacks: PersonalInventoryCallbacks,
) {
  let open = false;
  let inventoryCodes: readonly string[] = [];
  let inventoryFilter: InventoryFilter = 'all';
  let inventorySort: InventorySort = 'type';
  let searchQuery = '';
  let selectedItemId: string | null = null;
  let filtersBuilt = false;
  let busy = false;
  let dragItemId: string | null = null;
  let dragFromSlotId: string | null = null;
  let visibleItemIds: string[] = [];
  const avatarPreview = createInventoryAvatarPreview(
    elements.avatarCanvasEl,
    callbacks.characterAppearance,
  );

  function refreshBindingCodes(): void {
    const bindings = loadGameSettings().input.mouseKeyboard.bindings;
    inventoryCodes = getKeyboardBindingCodes(bindings, 'personalInventory');
  }

  function setStatus(message: string, kind: 'info' | 'error' | 'ok' = 'info'): void {
    elements.statusEl.textContent = message;
    elements.statusEl.dataset.kind = kind;
  }

  function inventoryOrNull(): InventoryState | null {
    const raw = callbacks.getInventory();
    return raw ? normalizeInventoryState(raw) : null;
  }

  function updateFilterSelection(): void {
    for (const button of elements.filtersEl.querySelectorAll<HTMLButtonElement>(
      '.sc-personal-inv-filter',
    )) {
      const active = button.dataset.inventoryFilter === inventoryFilter;
      button.classList.toggle('is-active', active);
      button.setAttribute('aria-selected', active ? 'true' : 'false');
    }
  }

  function ensureFilters(): void {
    if (filtersBuilt) return;
    filtersBuilt = true;
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
        inventoryFilter = filter.id;
        selectedItemId = null;
        updateFilterSelection();
        renderAll();
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
      if (inventorySort === 'name') return collator.compare(leftDef.name, rightDef.name);
      if (inventorySort === 'quantity') {
        return right.quantity - left.quantity || collator.compare(leftDef.name, rightDef.name);
      }
      if (inventorySort === 'rarity') {
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
    const typeFilter = inventoryFilter === 'all' ? null : inventoryFilter;
    let stacks = itemsByType(inventory, typeFilter);
    const query = searchQuery.trim().toLowerCase();
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

  function slotDefinition(inventory: InventoryState, slot: PlayLoadoutSlot): {
    definition: ItemDefinition | null;
    itemId: string | null;
    primarySlotId: string;
    reserved: boolean;
  } {
    if (slot.kind === 'wearable') {
      const equipped = equippedWearableAtSlot(inventory, slot.wearableSlotType);
      return equipped
        ? {
            definition: equipped.definition,
            itemId: equipped.itemId,
            primarySlotId: equipped.primarySlotType,
            reserved: equipped.primarySlotType !== slot.wearableSlotType,
          }
        : { definition: null, itemId: null, primarySlotId: slot.id, reserved: false };
    }
    const itemId = inventory.loadout[slot.id] ?? null;
    return {
      definition: itemId ? findItemDefinition(inventory.catalog, itemId) ?? null : null,
      itemId,
      primarySlotId: slot.id,
      reserved: false,
    };
  }

  function bindDropTarget(
    element: HTMLElement,
    slot: PlayLoadoutSlot,
    inventory: InventoryState,
  ): void {
    element.addEventListener('dragover', (event) => {
      if (!dragItemId) return;
      const definition = findItemDefinition(inventory.catalog, dragItemId);
      if (!definition) return;
      const compatible = itemCompatibleWithSlot(definition, slot, inventory.loadout);
      event.preventDefault();
      element.classList.toggle('is-drop-ok', compatible);
      element.classList.toggle('is-drop-bad', !compatible);
      if (compatible && event.dataTransfer) event.dataTransfer.dropEffect = 'move';
    });
    element.addEventListener('dragleave', () => {
      element.classList.remove('is-drop-ok', 'is-drop-bad');
    });
    element.addEventListener('drop', (event) => {
      event.preventDefault();
      element.classList.remove('is-drop-ok', 'is-drop-bad');
      const itemId = event.dataTransfer?.getData(INVENTORY_DND_TYPE) || dragItemId;
      if (!itemId) return;
      void equipToSlot(slot.id, itemId);
    });
  }

  function makeDraggableEquipped(
    element: HTMLElement,
    itemId: string | null,
    primarySlotId: string,
  ): void {
    if (!itemId) return;
    element.draggable = true;
    element.addEventListener('dragstart', (event) => {
      dragItemId = itemId;
      dragFromSlotId = primarySlotId;
      event.dataTransfer?.setData(INVENTORY_DND_TYPE, itemId);
      if (event.dataTransfer) event.dataTransfer.effectAllowed = 'move';
      element.classList.add('is-dragging');
    });
    element.addEventListener('dragend', () => {
      dragItemId = null;
      dragFromSlotId = null;
      element.classList.remove('is-dragging');
      clearDropHighlights();
    });
  }

  function clearDropHighlights(): void {
    for (const element of elements.rootEl.querySelectorAll('.is-drop-ok, .is-drop-bad')) {
      element.classList.remove('is-drop-ok', 'is-drop-bad');
    }
  }

  function renderLoadoutSlot(
    host: HTMLElement,
    inventory: InventoryState,
    slot: PlayLoadoutSlot,
    compact: boolean,
  ): void {
    const equipped = slotDefinition(inventory, slot);
    const card = document.createElement('button');
    card.type = 'button';
    card.className = 'sc-personal-inv-loadout-slot';
    card.classList.toggle('is-compact', compact);
    card.classList.toggle('is-filled', Boolean(equipped.itemId));
    card.classList.toggle('is-reserved', equipped.reserved);
    card.dataset.slotId = slot.id;
    card.title = equipped.definition
      ? `${slot.label}: ${equipped.definition.name}`
      : slot.label;

    const label = document.createElement('span');
    label.className = 'sc-personal-inv-loadout-slot-label';
    label.textContent = slot.label;

    const icon = document.createElement('span');
    icon.className = 'sc-personal-inv-loadout-slot-icon';
    if (equipped.definition) {
      paintItemIcon(icon, equipped.definition);
    } else {
      const ghost = document.createElement('span');
      ghost.className = 'sc-personal-inv-slot-ghost';
      ghost.textContent = 'Empty';
      icon.append(ghost);
    }

    const name = document.createElement('span');
    name.className = 'sc-personal-inv-loadout-slot-name';
    name.textContent = equipped.definition?.name ?? 'Unassigned';

    if (equipped.reserved) {
      const linked = document.createElement('span');
      linked.className = 'sc-personal-inv-loadout-linked';
      linked.textContent = `Linked: ${equipped.primarySlotId}`;
      card.append(label, icon, name, linked);
    } else {
      card.append(label, icon, name);
    }
    card.addEventListener('click', () => {
      if (!equipped.itemId) return;
      selectedItemId = equipped.itemId;
      renderDetails(inventory);
      renderGrid(inventory);
    });
    bindDropTarget(card, slot, inventory);
    makeDraggableEquipped(card, equipped.itemId, equipped.primarySlotId);
    host.append(card);
  }

  function renderLoadout(inventory: InventoryState): void {
    elements.gearSlotsEl.replaceChildren();
    for (const slot of WEARABLE_LOADOUT_SLOTS) {
      renderLoadoutSlot(elements.gearSlotsEl, inventory, slot, false);
    }
    const backpackSlot = PLAY_LOADOUT_SLOTS.find((slot) => slot.id === 'backpack');
    if (backpackSlot) renderLoadoutSlot(elements.gearSlotsEl, inventory, backpackSlot, false);

    elements.weaponBarsEl.replaceChildren();
    for (const slotId of WEAPON_BAR_SLOT_IDS) {
      const slot = PLAY_LOADOUT_SLOTS.find((candidate) => candidate.id === slotId);
      if (slot) renderLoadoutSlot(elements.weaponBarsEl, inventory, slot, true);
    }
  }

  function renderGrid(inventory: InventoryState): void {
    elements.gridEl.replaceChildren();
    const stacks = filteredStacks(inventory);
    visibleItemIds = stacks.map((stack) => stack.itemDefinitionId);
    if (stacks.length === 0) {
      const empty = document.createElement('div');
      empty.className = 'sc-personal-inv-empty';
      const title = document.createElement('strong');
      title.textContent = 'No matching items';
      const detail = document.createElement('span');
      detail.textContent = searchQuery ? 'Adjust your search or category filter.' : 'This category is empty.';
      empty.append(title, detail);
      elements.gridEl.append(empty);
      return;
    }

    if (!selectedItemId || !findItemDefinition(inventory.catalog, selectedItemId)) {
      selectedItemId = stacks[0]?.itemDefinitionId ?? null;
    }

    for (const stack of stacks) {
      const definition = findItemDefinition(inventory.catalog, stack.itemDefinitionId);
      if (!definition) continue;
      const button = document.createElement('button');
      button.type = 'button';
      button.className = `sc-personal-inv-grid-slot is-rarity-${rarityClass(definition.rarity)}`;
      button.classList.toggle('is-selected', stack.itemDefinitionId === selectedItemId);
      button.title = definition.name;
      button.draggable = true;
      button.dataset.itemId = stack.itemDefinitionId;
      button.tabIndex = stack.itemDefinitionId === selectedItemId ? 0 : -1;
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
        selectedItemId = stack.itemDefinitionId;
        renderGrid(inventory);
        renderDetails(inventory);
      });
      button.addEventListener('dragstart', (event) => {
        dragItemId = stack.itemDefinitionId;
        dragFromSlotId = null;
        event.dataTransfer?.setData(INVENTORY_DND_TYPE, stack.itemDefinitionId);
        if (event.dataTransfer) event.dataTransfer.effectAllowed = 'move';
        button.classList.add('is-dragging');
      });
      button.addEventListener('dragend', () => {
        dragItemId = null;
        dragFromSlotId = null;
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
    if (!selectedItemId) return null;
    const equippedSlot = equippedSlotForItem(inventory, selectedItemId);
    if (equippedSlot) return { kind: 'unequip', slotId: equippedSlot };
    const definition = findItemDefinition(inventory.catalog, selectedItemId);
    if (!definition) return null;
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
    const stack = inventory.items.find((entry) => entry.itemDefinitionId === selectedItemId);
    const definition = selectedItemId
      ? findItemDefinition(inventory.catalog, selectedItemId)
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

    const description = document.createElement('p');
    description.className = 'sc-personal-inv-detail-description';
    description.textContent = definition.description || 'No item description available.';
    elements.detailEl.append(description);

    const action = selectedAction(inventory);
    elements.quickEquipBtnEl.disabled = busy || !action;
    elements.quickEquipBtnEl.textContent = action
      ? action.kind === 'unequip'
        ? 'Unequip'
        : action.kind === 'replace'
          ? 'Replace'
          : 'Equip'
      : 'No action';
  }

  function renderAll(): void {
    ensureFilters();
    const inventory = inventoryOrNull();
    if (!inventory) {
      avatarPreview.setInventory(null);
      elements.gridEl.replaceChildren();
      elements.weaponBarsEl.replaceChildren();
      elements.gearSlotsEl.replaceChildren();
      elements.detailEl.replaceChildren();
      elements.capacityFillEl.style.width = '0%';
      elements.capacityLabelEl.textContent = '—';
      setStatus('Inventory unavailable offline.', 'error');
      elements.quickEquipBtnEl.disabled = true;
      return;
    }
    avatarPreview.setInventory(inventory);
    renderCapacity(inventory);
    renderGrid(inventory);
    renderDetails(inventory);
    renderLoadout(inventory);
    if (!busy) setStatus('Select an item, use its action, or drag it to a loadout slot.', 'info');
  }

  async function equipToSlot(slotId: string, itemDefinitionId: string | null): Promise<void> {
    if (busy) return;
    const inventory = inventoryOrNull();
    if (!inventory) {
      setStatus('Sign in to equip items.', 'error');
      return;
    }
    if (itemDefinitionId) {
      const slot = ALL_PLAY_LOADOUT_SLOTS.find((candidate) => candidate.id === slotId);
      const definition = findItemDefinition(inventory.catalog, itemDefinitionId);
      if (!slot || !definition || !itemCompatibleWithSlot(definition, slot, inventory.loadout)) {
        setStatus('That item cannot go in this slot.', 'error');
        return;
      }
    }

    busy = true;
    elements.quickEquipBtnEl.disabled = true;
    setStatus(itemDefinitionId ? 'Updating loadout…' : 'Unequipping…', 'info');
    try {
      const result = await equipInventoryItem(slotId, itemDefinitionId);
      const next = normalizeInventoryState(result.inventory);
      callbacks.onInventoryResult(next);
      renderAll();
      setStatus(itemDefinitionId ? 'Loadout updated.' : 'Unequipped.', 'ok');
    } catch (error) {
      setStatus(error instanceof Error ? error.message : 'Equip failed.', 'error');
    } finally {
      busy = false;
      renderDetails(inventoryOrNull() ?? inventory);
    }
  }

  async function activateSelected(): Promise<void> {
    const inventory = inventoryOrNull();
    if (!inventory) return;
    const action = selectedAction(inventory);
    if (!action) return;
    await equipToSlot(action.slotId, action.kind === 'unequip' ? null : selectedItemId);
  }

  function focusSelectedGridItem(): void {
    const selected = selectedItemId
      ? elements.gridEl.querySelector<HTMLButtonElement>(
          `[data-item-id="${CSS.escape(selectedItemId)}"]`,
        )
      : null;
    selected?.focus({ preventScroll: true });
  }

  function moveGridSelection(direction: -1 | 1, vertical: boolean): void {
    if (visibleItemIds.length === 0) return;
    const currentIndex = selectedItemId ? visibleItemIds.indexOf(selectedItemId) : -1;
    const columns = Math.max(
      1,
      getComputedStyle(elements.gridEl).gridTemplateColumns.split(' ').filter(Boolean).length,
    );
    const delta = vertical ? direction * columns : direction;
    const nextIndex = Math.max(0, Math.min(visibleItemIds.length - 1, currentIndex < 0 ? 0 : currentIndex + delta));
    selectedItemId = visibleItemIds[nextIndex] ?? null;
    const inventory = inventoryOrNull();
    if (!inventory) return;
    renderGrid(inventory);
    renderDetails(inventory);
    focusSelectedGridItem();
  }

  function setOpen(next: boolean): void {
    if (open === next) return;
    open = next;
    elements.rootEl.classList.toggle('is-open', open);
    elements.rootEl.setAttribute('aria-hidden', open ? 'false' : 'true');
    avatarPreview.setActive(open);
    if (open) {
      document.exitPointerLock?.();
      callbacks.playerControls.setInputSuppressed(true);
      refreshBindingCodes();
      renderAll();
      focusSelectedGridItem();
      return;
    }
    callbacks.playerControls.setInputSuppressed(false);
    elements.searchEl.blur();
    busy = false;
    dragItemId = null;
    dragFromSlotId = null;
  }

  elements.closeBtnEl.addEventListener('click', () => setOpen(false));
  elements.quickEquipBtnEl.addEventListener('click', () => void activateSelected());
  elements.searchEl.addEventListener('input', () => {
    searchQuery = elements.searchEl.value;
    selectedItemId = null;
    renderAll();
  });
  elements.sortEl.addEventListener('change', () => {
    inventorySort = elements.sortEl.value as InventorySort;
    renderAll();
  });

  elements.gridEl.addEventListener('keydown', (event) => {
    if (event.key === 'ArrowLeft' || event.key === 'ArrowRight') {
      event.preventDefault();
      moveGridSelection(event.key === 'ArrowLeft' ? -1 : 1, false);
    } else if (event.key === 'ArrowUp' || event.key === 'ArrowDown') {
      event.preventDefault();
      moveGridSelection(event.key === 'ArrowUp' ? -1 : 1, true);
    } else if (event.key === 'Enter') {
      event.preventDefault();
      void activateSelected();
    }
  });

  elements.gridEl.addEventListener('dragover', (event) => {
    if (!dragFromSlotId) return;
    event.preventDefault();
    elements.gridEl.classList.add('is-drop-ok');
  });
  elements.gridEl.addEventListener('dragleave', () => {
    elements.gridEl.classList.remove('is-drop-ok');
  });
  elements.gridEl.addEventListener('drop', (event) => {
    event.preventDefault();
    elements.gridEl.classList.remove('is-drop-ok');
    if (dragFromSlotId) void equipToSlot(dragFromSlotId, null);
  });

  const handleKeyDown = (event: KeyboardEvent) => {
    if (!open) {
      if (!inventoryCodes.includes(event.code)) return;
      event.preventDefault();
      event.stopPropagation();
      setOpen(true);
      return;
    }
    if (event.code === 'Escape') {
      event.preventDefault();
      event.stopPropagation();
      setOpen(false);
      return;
    }
    if (event.key === '/' && !isTypingTarget(event.target)) {
      event.preventDefault();
      elements.searchEl.focus({ preventScroll: true });
      elements.searchEl.select();
      return;
    }
    if (isTypingTarget(event.target)) {
      if (inventoryCodes.includes(event.code)) {
        event.preventDefault();
        event.stopPropagation();
        setOpen(false);
      }
      return;
    }
    if (!inventoryCodes.includes(event.code)) return;
    event.preventDefault();
    event.stopPropagation();
    setOpen(false);
  };

  const onSettingsChanged = () => refreshBindingCodes();
  refreshBindingCodes();
  window.addEventListener('keydown', handleKeyDown, true);
  window.addEventListener(GAME_SETTINGS_CHANGED_EVENT, onSettingsChanged);

  return {
    dispose() {
      window.removeEventListener('keydown', handleKeyDown, true);
      window.removeEventListener(GAME_SETTINGS_CHANGED_EVENT, onSettingsChanged);
      avatarPreview.dispose();
      if (open) {
        callbacks.playerControls.setInputSuppressed(false);
      }
    },
    isOpen: () => open,
    isPaused: () => open,
    open: () => setOpen(true),
    close: () => setOpen(false),
    toggle: () => setOpen(!open),
    refresh() {
      if (open) renderAll();
    },
  };
}

export type PersonalInventoryController = ReturnType<typeof createPersonalInventory>;
