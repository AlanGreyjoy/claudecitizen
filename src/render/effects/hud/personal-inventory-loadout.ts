import {
  PLAY_LOADOUT_SLOTS,
  WEAPON_BAR_SLOT_IDS,
  WEARABLE_LOADOUT_SLOTS,
  type PlayLoadoutSlot,
} from '../../../player/inventory/loadout-slots';
import {
  findItemDefinition,
  itemCompatibleWithSlot,
  type InventoryState,
  type ItemDefinition,
} from '../../../player/inventory/types';
import { equippedWearableAtSlot } from '../../../player/inventory/wearable-loadout';
import { paintItemIcon } from './item-icon';
import { INVENTORY_DND_TYPE, type PersonalInventoryUiState } from './personal-inventory-types';
import type { PersonalInventoryElements } from './personal-inventory';

export function slotDefinition(inventory: InventoryState, slot: PlayLoadoutSlot): {
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

export function renderPersonalInventoryLoadout(args: {
  elements: PersonalInventoryElements;
  equipToSlot: (slotId: string, itemDefinitionId: string | null) => Promise<void>;
  inventory: InventoryState;
  onSelectItem: (itemId: string) => void;
  state: PersonalInventoryUiState;
}): void {
  const { elements, equipToSlot, inventory, onSelectItem, state } = args;

  function clearDropHighlights(): void {
    for (const element of elements.rootEl.querySelectorAll('.is-drop-ok, .is-drop-bad')) {
      element.classList.remove('is-drop-ok', 'is-drop-bad');
    }
  }

  function bindDropTarget(element: HTMLElement, slot: PlayLoadoutSlot): void {
    element.addEventListener('dragover', (event) => {
      if (!state.dragItemId) return;
      const definition = findItemDefinition(inventory.catalog, state.dragItemId);
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
      const itemId = event.dataTransfer?.getData(INVENTORY_DND_TYPE) || state.dragItemId;
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
      state.dragItemId = itemId;
      state.dragFromSlotId = primarySlotId;
      event.dataTransfer?.setData(INVENTORY_DND_TYPE, itemId);
      if (event.dataTransfer) event.dataTransfer.effectAllowed = 'move';
      element.classList.add('is-dragging');
    });
    element.addEventListener('dragend', () => {
      state.dragItemId = null;
      state.dragFromSlotId = null;
      element.classList.remove('is-dragging');
      clearDropHighlights();
    });
  }

  function renderLoadoutSlot(host: HTMLElement, slot: PlayLoadoutSlot, compact: boolean): void {
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
      onSelectItem(equipped.itemId);
    });
    bindDropTarget(card, slot);
    makeDraggableEquipped(card, equipped.itemId, equipped.primarySlotId);
    host.append(card);
  }

  elements.gearSlotsEl.replaceChildren();
  for (const slot of WEARABLE_LOADOUT_SLOTS) {
    renderLoadoutSlot(elements.gearSlotsEl, slot, false);
  }
  const backpackSlot = PLAY_LOADOUT_SLOTS.find((slot) => slot.id === 'backpack');
  if (backpackSlot) renderLoadoutSlot(elements.gearSlotsEl, backpackSlot, false);

  elements.weaponBarsEl.replaceChildren();
  for (const slotId of WEAPON_BAR_SLOT_IDS) {
    const slot = PLAY_LOADOUT_SLOTS.find((candidate) => candidate.id === slotId);
    if (slot) renderLoadoutSlot(elements.weaponBarsEl, slot, true);
  }
}
