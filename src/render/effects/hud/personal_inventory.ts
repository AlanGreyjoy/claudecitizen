/**
 * Star Citizen–style personal inventory overlay (I key).
 * Drag / quick-equip onto backpack + weapon loadout slots.
 */

import {
  GAME_SETTINGS_CHANGED_EVENT,
  loadGameSettings,
} from '../../../settings/game_settings';
import { getKeyboardBindingCodes } from '../../../flight/input_settings';
import { equipInventoryItem } from '../../../net/api';
import {
  PLAY_LOADOUT_SLOTS,
  WEAPON_BAR_SLOT_IDS,
} from '../../../player/inventory/loadout_slots';
import {
  findItemDefinition,
  findQuickEquipSlot,
  itemCompatibleWithSlot,
  itemsByType,
  normalizeInventoryState,
  type InventoryState,
  type ItemType,
} from '../../../player/inventory/types';
import type { CharacterEquipmentSlotV1 } from '../../../player/equipment/base_character_equipment';
import { paintItemIcon } from './item_icon';

export const INVENTORY_DND_TYPE = 'application/x-claudecitizen-inventory-item';

const PERSONAL_SOFT_CAPACITY = 48;
const ATTACHMENT_GHOST_COUNT = 4;

type InventoryFilter = 'all' | ItemType;

const INVENTORY_FILTERS: Array<{ id: InventoryFilter; label: string }> = [
  { id: 'all', label: 'All' },
  { id: 'weapon', label: 'Weapons' },
  { id: 'backpack', label: 'Backpacks' },
  { id: 'consumable', label: 'Consumables' },
  { id: 'armor', label: 'Armor' },
  { id: 'clothing', label: 'Clothing' },
  { id: 'material', label: 'Materials' },
  { id: 'misc', label: 'Misc' },
];

export interface PersonalInventoryElements {
  rootEl: HTMLElement;
  searchEl: HTMLInputElement;
  capacityFillEl: HTMLElement;
  capacityLabelEl: HTMLElement;
  filtersEl: HTMLElement;
  gridEl: HTMLElement;
  weaponBarsEl: HTMLElement;
  gearSlotsEl: HTMLElement;
  statusEl: HTMLElement;
  quickEquipBtnEl: HTMLButtonElement;
  closeBtnEl: HTMLButtonElement;
}

export interface PersonalInventoryCallbacks {
  playerControls: { setInputSuppressed: (value: boolean) => void };
  getInventory: () => InventoryState | null;
  onInventoryResult: (inventory: InventoryState) => void;
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

function slotById(slotId: string): CharacterEquipmentSlotV1 | undefined {
  return PLAY_LOADOUT_SLOTS.find((slot) => slot.id === slotId);
}

function formatCapacity(used: number, max: number, unit: string): string {
  const pct = max > 0 ? Math.round((used / max) * 100) : 0;
  return `${used}/${max} ${unit} · ${pct}%`;
}

export function createPersonalInventory(
  elements: PersonalInventoryElements,
  callbacks: PersonalInventoryCallbacks,
) {
  let open = false;
  let inventoryCodes: readonly string[] = [];
  let inventoryFilter: InventoryFilter = 'all';
  let searchQuery = '';
  let selectedItemId: string | null = null;
  let filtersBuilt = false;
  let busy = false;
  let dragItemId: string | null = null;
  let dragFromSlotId: string | null = null;

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

  function ensureFilters(): void {
    if (filtersBuilt) return;
    filtersBuilt = true;
    elements.filtersEl.replaceChildren();
    for (const filter of INVENTORY_FILTERS) {
      const button = document.createElement('button');
      button.type = 'button';
      button.className = 'sc-personal-inv-filter';
      button.dataset.inventoryFilter = filter.id;
      button.textContent = filter.label;
      button.classList.toggle('is-active', filter.id === inventoryFilter);
      button.addEventListener('click', () => {
        inventoryFilter = filter.id;
        for (const chip of elements.filtersEl.querySelectorAll<HTMLButtonElement>(
          '.sc-personal-inv-filter',
        )) {
          chip.classList.toggle('is-active', chip.dataset.inventoryFilter === inventoryFilter);
        }
        renderAll();
      });
      elements.filtersEl.append(button);
    }
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

  function filteredStacks(inventory: InventoryState) {
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
    return stacks;
  }

  function paintSlotContents(
    host: HTMLElement,
    inventory: InventoryState,
    slot: CharacterEquipmentSlotV1,
    emptyLabel = slot.label,
  ): void {
    host.replaceChildren();
    const itemId = inventory.loadout[slot.id];
    if (!itemId) {
      const ghost = document.createElement('span');
      ghost.className = 'sc-personal-inv-slot-ghost';
      ghost.textContent = emptyLabel;
      host.append(ghost);
      return;
    }
    const definition = findItemDefinition(inventory.catalog, itemId);
    if (!definition) {
      const ghost = document.createElement('span');
      ghost.className = 'sc-personal-inv-slot-ghost';
      ghost.textContent = '?';
      host.append(ghost);
      return;
    }
    const icon = document.createElement('div');
    icon.className = 'sc-personal-inv-slot-icon';
    paintItemIcon(icon, definition);
    host.append(icon);
  }

  function bindDropTarget(
    el: HTMLElement,
    slot: CharacterEquipmentSlotV1,
    inventory: InventoryState,
  ): void {
    el.addEventListener('dragover', (event) => {
      if (!dragItemId) return;
      const definition = findItemDefinition(inventory.catalog, dragItemId);
      if (!definition) return;
      const ok = itemCompatibleWithSlot(definition, slot, inventory.loadout);
      event.preventDefault();
      el.classList.toggle('is-drop-ok', ok);
      el.classList.toggle('is-drop-bad', !ok);
      if (ok) event.dataTransfer!.dropEffect = 'move';
    });
    el.addEventListener('dragleave', () => {
      el.classList.remove('is-drop-ok', 'is-drop-bad');
    });
    el.addEventListener('drop', (event) => {
      event.preventDefault();
      el.classList.remove('is-drop-ok', 'is-drop-bad');
      const itemId =
        event.dataTransfer?.getData(INVENTORY_DND_TYPE) || dragItemId;
      if (!itemId) return;
      void equipToSlot(slot.id, itemId);
    });
  }

  function makeDraggableEquipped(
    el: HTMLElement,
    inventory: InventoryState,
    slotId: string,
  ): void {
    const itemId = inventory.loadout[slotId];
    if (!itemId) {
      el.removeAttribute('draggable');
      return;
    }
    el.draggable = true;
    el.addEventListener('dragstart', (event) => {
      dragItemId = itemId;
      dragFromSlotId = slotId;
      event.dataTransfer?.setData(INVENTORY_DND_TYPE, itemId);
      event.dataTransfer!.effectAllowed = 'move';
      el.classList.add('is-dragging');
    });
    el.addEventListener('dragend', () => {
      dragItemId = null;
      dragFromSlotId = null;
      el.classList.remove('is-dragging');
      clearDropHighlights();
    });
  }

  function clearDropHighlights(): void {
    for (const el of elements.rootEl.querySelectorAll('.is-drop-ok, .is-drop-bad')) {
      el.classList.remove('is-drop-ok', 'is-drop-bad');
    }
  }

  function renderWeaponBars(inventory: InventoryState): void {
    elements.weaponBarsEl.replaceChildren();

    const heading = document.createElement('div');
    heading.className = 'sc-personal-inv-loadout-heading';

    const headingLabel = document.createElement('span');
    headingLabel.textContent = 'Weapon loadout';

    const headingHint = document.createElement('span');
    headingHint.className = 'sc-personal-inv-loadout-hint';
    headingHint.textContent = 'Drag to equip · Double-click to unequip';

    heading.append(headingLabel, headingHint);
    elements.weaponBarsEl.append(heading);

    for (const slotId of WEAPON_BAR_SLOT_IDS) {
      const slot = slotById(slotId);
      if (!slot) continue;
      const itemId = inventory.loadout[slot.id];
      const definition = itemId
        ? findItemDefinition(inventory.catalog, itemId)
        : undefined;
      const row = document.createElement('div');
      row.className = 'sc-personal-inv-weapon-bar';
      row.dataset.slotId = slot.id;
      row.title = itemId ? `${slot.label}: ${definition?.name ?? itemId}` : slot.label;
      if (itemId) row.classList.add('is-filled');

      const main = document.createElement('div');
      main.className = 'sc-personal-inv-weapon-main';
      paintSlotContents(main, inventory, slot, 'Empty');

      bindDropTarget(row, slot, inventory);
      makeDraggableEquipped(row, inventory, slot.id);
      row.addEventListener('dblclick', () => {
        if (itemId) void equipToSlot(slot.id, null);
      });

      const attachments = document.createElement('div');
      attachments.className = 'sc-personal-inv-attachments';
      for (let i = 0; i < ATTACHMENT_GHOST_COUNT; i += 1) {
        const chip = document.createElement('div');
        chip.className = 'sc-personal-inv-attachment-ghost';
        chip.title = 'Attachment slot (coming soon)';
        attachments.append(chip);
      }

      const label = document.createElement('span');
      label.className = 'sc-personal-inv-weapon-label';
      label.textContent = slot.label;

      const itemName = document.createElement('span');
      itemName.className = 'sc-personal-inv-weapon-name';
      itemName.textContent = definition?.name ?? (itemId ? 'Unknown item' : 'Empty slot');

      row.append(label, main, itemName, attachments);
      elements.weaponBarsEl.append(row);
    }
  }

  function renderGearSlots(inventory: InventoryState): void {
    elements.gearSlotsEl.replaceChildren();
    for (const slot of PLAY_LOADOUT_SLOTS) {
      const button = document.createElement('button');
      button.type = 'button';
      button.className = `sc-personal-inv-gear-slot sc-personal-inv-gear-${slot.id}`;
      button.dataset.slotId = slot.id;
      button.title = slot.label;
      if (inventory.loadout[slot.id]) button.classList.add('is-filled');
      paintSlotContents(button, inventory, slot);
      bindDropTarget(button, slot, inventory);
      makeDraggableEquipped(button, inventory, slot.id);
      button.addEventListener('dblclick', () => {
        if (inventory.loadout[slot.id]) void equipToSlot(slot.id, null);
      });
      elements.gearSlotsEl.append(button);
    }
  }

  function renderGrid(inventory: InventoryState): void {
    elements.gridEl.replaceChildren();
    const stacks = filteredStacks(inventory);
    if (stacks.length === 0) {
      const empty = document.createElement('p');
      empty.className = 'sc-personal-inv-empty';
      empty.textContent = 'No items in this category.';
      elements.gridEl.append(empty);
      return;
    }

    if (!selectedItemId || !stacks.some((stack) => stack.itemDefinitionId === selectedItemId)) {
      selectedItemId = stacks[0]?.itemDefinitionId ?? null;
    }

    for (const stack of stacks) {
      const definition = findItemDefinition(inventory.catalog, stack.itemDefinitionId);
      if (!definition) continue;

      const button = document.createElement('button');
      button.type = 'button';
      button.className = 'sc-personal-inv-grid-slot';
      button.classList.toggle('is-selected', stack.itemDefinitionId === selectedItemId);
      button.title = definition.name;
      button.draggable = true;

      const icon = document.createElement('div');
      icon.className = 'sc-personal-inv-grid-icon';
      paintItemIcon(icon, definition);

      const qty = document.createElement('span');
      qty.className = 'sc-personal-inv-grid-qty';
      qty.textContent = stack.quantity > 1 ? `${stack.quantity}x` : '';

      const equippedSlot = Object.entries(inventory.loadout).find(
        ([, id]) => id === stack.itemDefinitionId,
      )?.[0];
      if (equippedSlot) {
        const badge = document.createElement('span');
        badge.className = 'sc-personal-inv-equipped-badge';
        badge.textContent = 'E';
        badge.title = `Equipped: ${equippedSlot}`;
        button.append(badge);
      }

      button.append(icon, qty);
      button.addEventListener('click', () => {
        selectedItemId = stack.itemDefinitionId;
        renderAll();
      });
      button.addEventListener('dblclick', () => {
        selectedItemId = stack.itemDefinitionId;
        void quickEquipSelected();
      });
      button.addEventListener('dragstart', (event) => {
        dragItemId = stack.itemDefinitionId;
        dragFromSlotId = null;
        event.dataTransfer?.setData(INVENTORY_DND_TYPE, stack.itemDefinitionId);
        event.dataTransfer!.effectAllowed = 'move';
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

  function renderAll(): void {
    ensureFilters();
    const inventory = inventoryOrNull();
    if (!inventory) {
      elements.gridEl.replaceChildren();
      elements.weaponBarsEl.replaceChildren();
      elements.gearSlotsEl.replaceChildren();
      elements.capacityFillEl.style.width = '0%';
      elements.capacityLabelEl.textContent = '—';
      setStatus('Inventory unavailable offline.', 'error');
      elements.quickEquipBtnEl.disabled = true;
      return;
    }
    renderCapacity(inventory);
    renderGrid(inventory);
    renderWeaponBars(inventory);
    renderGearSlots(inventory);
    elements.quickEquipBtnEl.disabled = !selectedItemId || busy;
    if (!busy) setStatus('Drag items onto a slot, or Quick Equip.', 'info');
  }

  async function equipToSlot(slotId: string, itemDefinitionId: string | null): Promise<void> {
    if (busy) return;
    const inventory = inventoryOrNull();
    if (!inventory) {
      setStatus('Sign in to equip items.', 'error');
      return;
    }

    if (itemDefinitionId) {
      const slot = slotById(slotId);
      const definition = findItemDefinition(inventory.catalog, itemDefinitionId);
      if (!slot || !definition || !itemCompatibleWithSlot(definition, slot, inventory.loadout)) {
        setStatus('That item cannot go in this slot.', 'error');
        return;
      }
    }

    busy = true;
    elements.quickEquipBtnEl.disabled = true;
    setStatus(itemDefinitionId ? 'Equipping…' : 'Unequipping…', 'info');
    try {
      const result = await equipInventoryItem(slotId, itemDefinitionId);
      const next = normalizeInventoryState(result.inventory);
      callbacks.onInventoryResult(next);
      setStatus(itemDefinitionId ? 'Equipped.' : 'Unequipped.', 'ok');
      renderAll();
    } catch (error) {
      const message = error instanceof Error ? error.message : 'Equip failed.';
      setStatus(message, 'error');
    } finally {
      busy = false;
      elements.quickEquipBtnEl.disabled = !selectedItemId;
    }
  }

  async function quickEquipSelected(): Promise<void> {
    const inventory = inventoryOrNull();
    if (!inventory || !selectedItemId) return;
    const slotId = findQuickEquipSlot(inventory, selectedItemId, PLAY_LOADOUT_SLOTS);
    if (!slotId) {
      setStatus('No empty compatible slot.', 'error');
      return;
    }
    await equipToSlot(slotId, selectedItemId);
  }

  function setOpen(next: boolean): void {
    if (open === next) return;
    open = next;
    elements.rootEl.classList.toggle('is-open', open);
    elements.rootEl.setAttribute('aria-hidden', open ? 'false' : 'true');
    if (open) {
      document.exitPointerLock?.();
      callbacks.playerControls.setInputSuppressed(true);
      refreshBindingCodes();
      renderAll();
      elements.searchEl.focus({ preventScroll: true });
      return;
    }
    callbacks.playerControls.setInputSuppressed(false);
    elements.searchEl.blur();
    busy = false;
    dragItemId = null;
    dragFromSlotId = null;
  }

  elements.closeBtnEl.addEventListener('click', () => setOpen(false));
  elements.quickEquipBtnEl.addEventListener('click', () => {
    void quickEquipSelected();
  });
  elements.searchEl.addEventListener('input', () => {
    searchQuery = elements.searchEl.value;
    renderAll();
  });

  // Unequip when dropping an equipped item onto the grid area.
  elements.gridEl.addEventListener('dragover', (event) => {
    if (dragFromSlotId) {
      event.preventDefault();
      elements.gridEl.classList.add('is-drop-ok');
    }
  });
  elements.gridEl.addEventListener('dragleave', () => {
    elements.gridEl.classList.remove('is-drop-ok');
  });
  elements.gridEl.addEventListener('drop', (event) => {
    event.preventDefault();
    elements.gridEl.classList.remove('is-drop-ok');
    if (dragFromSlotId) {
      void equipToSlot(dragFromSlotId, null);
    }
  });

  const handleKeyDown = (event: KeyboardEvent) => {
    if (isTypingTarget(event.target) && event.code !== 'Escape') {
      if (open && inventoryCodes.includes(event.code)) {
        // allow I to close even from search
      } else if (open && event.code !== 'Escape') {
        return;
      } else if (!open) {
        return;
      }
    }
    if (event.code === 'Escape' && open) {
      event.preventDefault();
      event.stopPropagation();
      setOpen(false);
      return;
    }
    if (!inventoryCodes.includes(event.code)) return;
    event.preventDefault();
    event.stopPropagation();
    setOpen(!open);
  };

  const onSettingsChanged = () => refreshBindingCodes();
  refreshBindingCodes();
  window.addEventListener('keydown', handleKeyDown, true);
  window.addEventListener(GAME_SETTINGS_CHANGED_EVENT, onSettingsChanged);

  return {
    dispose() {
      window.removeEventListener('keydown', handleKeyDown, true);
      window.removeEventListener(GAME_SETTINGS_CHANGED_EVENT, onSettingsChanged);
      if (open) callbacks.playerControls.setInputSuppressed(false);
    },
    isOpen() {
      return open;
    },
    isPaused() {
      return open;
    },
    open() {
      setOpen(true);
    },
    close() {
      setOpen(false);
    },
    toggle() {
      setOpen(!open);
    },
    refresh() {
      if (open) renderAll();
    },
  };
}

export type PersonalInventoryController = ReturnType<typeof createPersonalInventory>;
