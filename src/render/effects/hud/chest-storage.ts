/**
 * Dual-pane personal stash transfer UI opened from a station `chest-storage` marker.
 */

import {
  depositChestItem,
  fetchChestContents,
  withdrawChestItem,
} from '../../../net/api';
import {
  findItemDefinition,
  normalizeInventoryState,
  type InventoryState,
  type PlayerItemStack,
} from '../../../player/inventory/types';
import { paintItemIcon } from './item-icon';

export interface ChestStorageElements {
  rootEl: HTMLElement;
  titleEl: HTMLElement;
  inventoryListEl: HTMLElement;
  chestListEl: HTMLElement;
  capacityEl: HTMLElement;
  statusEl: HTMLElement;
  closeBtnEl: HTMLButtonElement;
}

export interface ChestStorageOpenOptions {
  chestId: string;
  label: string;
  slotCount: number;
}

export interface ChestStorageCallbacks {
  playerControls: { setInputSuppressed: (suppressed: boolean) => void };
  getInventory: () => InventoryState | null;
  onInventoryResult: (inventory: InventoryState) => void;
  /** Close sibling overlays (personal inventory / shops) before opening. */
  onWillOpen?: () => void;
}

export type ChestStorageController = ReturnType<typeof createChestStorage>;

export function createChestStorage(
  elements: ChestStorageElements,
  callbacks: ChestStorageCallbacks,
) {
  let open = false;
  let busy = false;
  let current: ChestStorageOpenOptions | null = null;
  let chestItems: PlayerItemStack[] = [];

  function setStatus(message: string, kind: 'info' | 'error' | 'ok' = 'info'): void {
    elements.statusEl.textContent = message;
    elements.statusEl.dataset.kind = kind;
  }

  function inventoryOrNull(): InventoryState | null {
    const raw = callbacks.getInventory();
    return raw ? normalizeInventoryState(raw) : null;
  }

  function stackCount(): number {
    return chestItems.filter((stack) => stack.quantity > 0).length;
  }

  function renderCapacity(): void {
    const slots = current?.slotCount ?? 20;
    const used = stackCount();
    elements.capacityEl.textContent = `${used} / ${slots} slots`;
  }

  function makeRow(
    inventory: InventoryState,
    stack: PlayerItemStack,
    direction: 'deposit' | 'withdraw',
  ): HTMLElement {
    const definition = findItemDefinition(inventory.catalog, stack.itemDefinitionId);
    const row = document.createElement('button');
    row.type = 'button';
    row.className = 'sc-chest-storage-row';
    row.disabled = busy || stack.quantity <= 0;

    const icon = document.createElement('div');
    icon.className = 'sc-chest-storage-icon';
    if (definition) paintItemIcon(icon, definition);

    const meta = document.createElement('div');
    meta.className = 'sc-chest-storage-meta';
    const name = document.createElement('div');
    name.className = 'sc-chest-storage-name';
    name.textContent = definition?.name ?? stack.itemDefinitionId;
    const detail = document.createElement('div');
    detail.className = 'sc-chest-storage-detail';
    detail.textContent = `×${stack.quantity}`;
    meta.append(name, detail);

    const action = document.createElement('span');
    action.className = 'sc-chest-storage-action';
    action.textContent = direction === 'deposit' ? 'Store' : 'Take';

    row.append(icon, meta, action);
    row.addEventListener('click', (event) => {
      const wholeStack = event.shiftKey;
      void transfer(direction, stack.itemDefinitionId, wholeStack ? stack.quantity : 1);
    });
    return row;
  }

  function renderLists(): void {
    const inventory = inventoryOrNull();
    elements.inventoryListEl.replaceChildren();
    elements.chestListEl.replaceChildren();
    renderCapacity();
    if (!inventory || !current) {
      setStatus('Sign in to use chest storage.', 'error');
      return;
    }

    const owned = inventory.items.filter((stack) => stack.quantity > 0);
    if (owned.length === 0) {
      const empty = document.createElement('p');
      empty.className = 'sc-chest-storage-empty';
      empty.textContent = 'Inventory empty.';
      elements.inventoryListEl.append(empty);
    } else {
      for (const stack of owned) {
        elements.inventoryListEl.append(makeRow(inventory, stack, 'deposit'));
      }
    }

    if (chestItems.length === 0) {
      const empty = document.createElement('p');
      empty.className = 'sc-chest-storage-empty';
      empty.textContent = 'Chest empty.';
      elements.chestListEl.append(empty);
    } else {
      for (const stack of chestItems) {
        elements.chestListEl.append(makeRow(inventory, stack, 'withdraw'));
      }
    }
  }

  async function transfer(
    direction: 'deposit' | 'withdraw',
    itemDefinitionId: string,
    quantity: number,
  ): Promise<void> {
    if (busy || !current || quantity < 1) return;
    const inventory = inventoryOrNull();
    if (!inventory) {
      setStatus('Sign in to use chest storage.', 'error');
      return;
    }

    if (direction === 'deposit') {
      const existing = chestItems.find((stack) => stack.itemDefinitionId === itemDefinitionId);
      if (!existing && stackCount() >= current.slotCount) {
        setStatus('Chest is full.', 'error');
        return;
      }
    }

    busy = true;
    renderLists();
    const definition = findItemDefinition(inventory.catalog, itemDefinitionId);
    const label = definition?.name ?? itemDefinitionId;
    setStatus(
      direction === 'deposit' ? `Storing ${label}…` : `Taking ${label}…`,
      'info',
    );
    try {
      const result =
        direction === 'deposit'
          ? await depositChestItem(current.chestId, itemDefinitionId, quantity)
          : await withdrawChestItem(current.chestId, itemDefinitionId, quantity);
      const next = normalizeInventoryState(result.inventory);
      chestItems = result.chestItems.filter((stack) => stack.quantity > 0);
      callbacks.onInventoryResult(next);
      setStatus(
        direction === 'deposit' ? `Stored ${label}.` : `Took ${label}.`,
        'ok',
      );
    } catch (error) {
      setStatus(error instanceof Error ? error.message : 'Transfer failed.', 'error');
    } finally {
      busy = false;
      renderLists();
    }
  }

  async function loadContents(): Promise<void> {
    if (!current) return;
    busy = true;
    setStatus('Loading chest…', 'info');
    try {
      const result = await fetchChestContents(current.chestId);
      chestItems = result.items.filter((stack) => stack.quantity > 0);
      callbacks.onInventoryResult(normalizeInventoryState(result.inventory));
      setStatus('Click an item to move 1. Shift-click moves the whole stack.', 'info');
    } catch (error) {
      chestItems = [];
      setStatus(error instanceof Error ? error.message : 'Failed to load chest.', 'error');
    } finally {
      busy = false;
      renderLists();
    }
  }

  function setOpen(next: boolean): void {
    if (open === next) return;
    open = next;
    elements.rootEl.classList.toggle('is-open', open);
    elements.rootEl.setAttribute('aria-hidden', open ? 'false' : 'true');
    if (open) {
      document.exitPointerLock?.();
      callbacks.onWillOpen?.();
      callbacks.playerControls.setInputSuppressed(true);
      elements.titleEl.textContent = current?.label ?? 'Chest';
      void loadContents();
      return;
    }
    callbacks.playerControls.setInputSuppressed(false);
    busy = false;
    current = null;
    chestItems = [];
    elements.inventoryListEl.replaceChildren();
    elements.chestListEl.replaceChildren();
    elements.capacityEl.textContent = '—';
    elements.statusEl.textContent = '';
  }

  elements.closeBtnEl.addEventListener('click', () => setOpen(false));

  const handleKeyDown = (event: KeyboardEvent): void => {
    if (!open) return;
    if (event.code === 'Escape') {
      event.preventDefault();
      event.stopPropagation();
      setOpen(false);
    }
  };
  window.addEventListener('keydown', handleKeyDown, true);

  return {
    dispose() {
      window.removeEventListener('keydown', handleKeyDown, true);
      setOpen(false);
    },
    isOpen() {
      return open;
    },
    isPaused() {
      return open;
    },
    close() {
      setOpen(false);
    },
    open(options: ChestStorageOpenOptions) {
      current = {
        chestId: options.chestId.trim(),
        label: options.label.trim() || 'Open chest',
        slotCount: Math.max(1, Math.min(64, Math.round(options.slotCount))),
      };
      if (!current.chestId) return;
      if (open) {
        elements.titleEl.textContent = current.label;
        void loadContents();
        return;
      }
      setOpen(true);
    },
    refresh() {
      if (open) renderLists();
    },
  };
}
