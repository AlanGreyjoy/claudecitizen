/**
 * BOTW-inspired personal inventory with Star Citizen presentation.
 * A dedicated Sidekick scene renders the character; DOM owns browsing and loadout interaction.
 */

import {
  GAME_SETTINGS_CHANGED_EVENT,
  loadGameSettings,
} from '../../../settings/game-settings';
import { getKeyboardBindingCodes } from '../../../flight/input-settings';
import { consumeInventoryItem, equipInventoryItem } from '../../../net/api';
import type { PlayerCharacterAppearanceV1 } from '../../../player/character_creator/player-character-appearance';
import { ALL_PLAY_LOADOUT_SLOTS } from '../../../player/inventory/loadout-slots';
import {
  findItemDefinition,
  itemCompatibleWithSlot,
  itemQuantity,
  normalizeInventoryState,
  type InventoryState,
} from '../../../player/inventory/types';
import type { PlayerSurvivalVitals } from '../../../player/vitals';
import { createInventoryAvatarPreview } from './inventory-avatar-preview';
import {
  createPersonalInventoryRender,
  INVENTORY_DND_TYPE,
  type InventorySort,
  type PersonalInventoryUiState,
} from './personal-inventory-render';

export { INVENTORY_DND_TYPE };

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
  /** Called after a successful consumable Use that restored vitals. */
  onConsumeResult?: (result: {
    inventory: InventoryState;
    vitals: PlayerSurvivalVitals;
  }) => void;
  characterAppearance?: PlayerCharacterAppearanceV1 | null;
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

export function createPersonalInventory(
  elements: PersonalInventoryElements,
  callbacks: PersonalInventoryCallbacks,
) {
  let open = false;
  let inventoryCodes: readonly string[] = [];
  const uiState: PersonalInventoryUiState = {
    busy: false,
    dragFromSlotId: null,
    dragItemId: null,
    filtersBuilt: false,
    inventoryFilter: 'all',
    inventorySort: 'type',
    searchQuery: '',
    selectedItemId: null,
    visibleItemIds: [],
  };
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

  async function equipToSlot(slotId: string, itemDefinitionId: string | null): Promise<void> {
    if (uiState.busy) return;
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

    uiState.busy = true;
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
      uiState.busy = false;
      renderDetails(inventoryOrNull() ?? inventory);
    }
  }

  const {
    ensureFilters,
    focusSelectedGridItem,
    moveGridSelection,
    renderCapacity,
    renderDetails,
    renderGrid,
    renderLoadout,
    selectedAction,
  } = createPersonalInventoryRender({
    elements,
    equipToSlot,
    onFilterChange: () => renderAll(),
    state: uiState,
  });

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
    if (!uiState.busy) setStatus('Select an item, use its action, or drag it to a loadout slot.', 'info');
  }

  async function useSelected(): Promise<void> {
    if (uiState.busy || !uiState.selectedItemId) return;
    const inventory = inventoryOrNull();
    if (!inventory) {
      setStatus('Sign in to use consumables.', 'error');
      return;
    }
    const definition = findItemDefinition(inventory.catalog, uiState.selectedItemId);
    const canUse =
      definition?.itemType === 'consumable' &&
      ((definition.hungerRestore01 ?? 0) > 0 ||
        (definition.thirstRestore01 ?? 0) > 0 ||
        (definition.healthRestore01 ?? 0) > 0);
    if (!definition || !canUse) {
      setStatus('That item cannot be used.', 'error');
      return;
    }

    uiState.busy = true;
    elements.quickEquipBtnEl.disabled = true;
    setStatus(`Using ${definition.name}…`, 'info');
    try {
      const result = await consumeInventoryItem(uiState.selectedItemId);
      const next = normalizeInventoryState(result.inventory);
      callbacks.onInventoryResult(next);
      callbacks.onConsumeResult?.({ inventory: next, vitals: result.vitals });
      if (itemQuantity(next, uiState.selectedItemId) <= 0) {
        uiState.selectedItemId = null;
      }
      renderAll();
      setStatus(`Used ${definition.name}.`, 'ok');
    } catch (error) {
      setStatus(error instanceof Error ? error.message : 'Use failed.', 'error');
    } finally {
      uiState.busy = false;
      renderDetails(inventoryOrNull() ?? inventory);
    }
  }

  async function activateSelected(): Promise<void> {
    const inventory = inventoryOrNull();
    if (!inventory) return;
    const action = selectedAction(inventory);
    if (!action) return;
    if (action.kind === 'use') {
      await useSelected();
      return;
    }
    await equipToSlot(action.slotId, action.kind === 'unequip' ? null : uiState.selectedItemId);
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
    uiState.busy = false;
    uiState.dragItemId = null;
    uiState.dragFromSlotId = null;
  }

  elements.closeBtnEl.addEventListener('click', () => setOpen(false));
  elements.quickEquipBtnEl.addEventListener('click', () => void activateSelected());
  elements.searchEl.addEventListener('input', () => {
    uiState.searchQuery = elements.searchEl.value;
    uiState.selectedItemId = null;
    renderAll();
  });
  elements.sortEl.addEventListener('change', () => {
    uiState.inventorySort = elements.sortEl.value as InventorySort;
    renderAll();
  });

  elements.gridEl.addEventListener('keydown', (event) => {
    const inventory = inventoryOrNull();
    if (!inventory) return;
    if (event.key === 'ArrowLeft' || event.key === 'ArrowRight') {
      event.preventDefault();
      moveGridSelection(event.key === 'ArrowLeft' ? -1 : 1, false, inventory);
    } else if (event.key === 'ArrowUp' || event.key === 'ArrowDown') {
      event.preventDefault();
      moveGridSelection(event.key === 'ArrowUp' ? -1 : 1, true, inventory);
    } else if (event.key === 'Enter') {
      event.preventDefault();
      void activateSelected();
    }
  });

  elements.gridEl.addEventListener('dragover', (event) => {
    if (!uiState.dragFromSlotId) return;
    event.preventDefault();
    elements.gridEl.classList.add('is-drop-ok');
  });
  elements.gridEl.addEventListener('dragleave', () => {
    elements.gridEl.classList.remove('is-drop-ok');
  });
  elements.gridEl.addEventListener('drop', (event) => {
    event.preventDefault();
    elements.gridEl.classList.remove('is-drop-ok');
    if (uiState.dragFromSlotId) void equipToSlot(uiState.dragFromSlotId, null);
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
