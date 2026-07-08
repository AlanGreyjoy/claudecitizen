import {
  GAME_SETTINGS_CHANGED_EVENT,
  loadGameSettings,
} from '../../../settings/game_settings';
import { getKeyboardBindingCodes } from '../../../flight/input_settings';
import { length } from '../../../math/vec3';
import {
  MODE_ENTERING_SHIP,
  MODE_IN_SHIP,
  MODE_LEAVING_PILOT,
  MODE_ON_SHIP_DECK,
} from '../../../player/modes';
import { getActiveShip, type WorldState } from '../../../player/world_state';
import {
  findItemDefinition,
  itemsByType,
  type InventoryState,
  type ItemDefinition,
  type ItemType,
} from '../../../player/inventory/types';
import type { GameMode, PlanetSurfaceSample } from '../../../types';
import { createHalobandHolo } from './haloband_holo';
import { paintItemIcon } from './item_icon';

export interface HaloBandElements {
  rootEl: HTMLElement;
  chatMessagesEl: HTMLElement;
  chatInputEl: HTMLInputElement;
  sendBtnEl: HTMLButtonElement;
  shipStatusEl: HTMLElement;
  inventoryFiltersEl: HTMLElement;
  inventoryGridEl: HTMLElement;
  inventoryDetailEl: HTMLElement;
  balanceEl: HTMLElement;
  balanceValueEl: HTMLElement;
  holoCanvasEl: HTMLCanvasElement;
}

export interface HaloBandUpdateParams {
  world: WorldState;
  shipSurface: PlanetSurfaceSample;
}

export interface HaloBandCallbacks {
  onSendMessage: (text: string) => void;
  playerControls: { setInputSuppressed: (value: boolean) => void };
  /** Returns the player's current ARC balance, or null when offline / unavailable. */
  getArcBalance: () => number | null;
  /** Returns portable inventory state, or null when offline / unavailable. */
  getInventory: () => InventoryState | null;
}

type HaloBandTab = 'comms' | 'missions' | 'inventory' | 'ship';

type InventoryFilter = 'all' | ItemType;

const INVENTORY_FILTERS: Array<{ id: InventoryFilter; label: string }> = [
  { id: 'all', label: 'All' },
  { id: 'consumable', label: 'Consumables' },
  { id: 'clothing', label: 'Clothing' },
  { id: 'weapon', label: 'Weapons' },
  { id: 'armor', label: 'Armor' },
  { id: 'material', label: 'Materials' },
];

function isTypingTarget(target: EventTarget | null): boolean {
  if (!(target instanceof HTMLElement)) return false;
  return (
    target.tagName === 'INPUT' ||
    target.tagName === 'SELECT' ||
    target.tagName === 'TEXTAREA' ||
    target.isContentEditable
  );
}

function barWidth(current: number, max: number): string {
  if (max <= 0) return '0%';
  return `${Math.min(100, Math.max(0, (current / max) * 100))}%`;
}

function formatPercent(current: number, max: number): string {
  if (max <= 0) return '0%';
  return `${Math.round((current / max) * 100)}%`;
}

function isShipMode(mode: GameMode): boolean {
  return (
    mode === MODE_IN_SHIP ||
    mode === MODE_ON_SHIP_DECK ||
    mode === MODE_ENTERING_SHIP ||
    mode === MODE_LEAVING_PILOT
  );
}

function makeBarStat(
  label: string,
  current: number,
  max: number,
  kind: 'hp' | 'shield',
): HTMLElement {
  const stat = document.createElement('div');
  stat.className = 'sc-haloband-stat';
  const labelEl = document.createElement('span');
  labelEl.className = 'sc-haloband-stat-label';
  labelEl.textContent = label;
  const bar = document.createElement('div');
  bar.className = 'sc-haloband-stat-bar';
  const fill = document.createElement('span');
  fill.className = `sc-haloband-stat-fill sc-haloband-stat-fill-${kind}`;
  fill.style.width = barWidth(current, max);
  bar.appendChild(fill);
  const value = document.createElement('span');
  value.className = 'sc-haloband-stat-value';
  value.textContent = `${Math.round(current)} / ${Math.round(max)} (${formatPercent(current, max)})`;
  stat.append(labelEl, bar, value);
  return stat;
}

function makeRowStat(label: string, valueText: string): HTMLElement {
  const row = document.createElement('div');
  row.className = 'sc-haloband-stat-row';
  const labelEl = document.createElement('span');
  labelEl.className = 'sc-haloband-stat-label';
  labelEl.textContent = label;
  const valueEl = document.createElement('span');
  valueEl.className = 'sc-haloband-stat-row-value';
  valueEl.textContent = valueText;
  row.append(labelEl, valueEl);
  return row;
}

export function createHaloBand(elements: HaloBandElements, callbacks: HaloBandCallbacks) {
  // TODO: implement the missions system — data model, persistent store, and
  // backend integration. The Missions tab currently renders a static placeholder.
  let open = false;
  let activeTab: HaloBandTab = 'comms';
  let latestParams: HaloBandUpdateParams | null = null;
  let haloBandCodes: readonly string[] = [];
  let lastRenderedBalance: number | null | undefined;
  let inventoryFilter: InventoryFilter = 'all';
  let selectedItemId: string | null = null;
  let inventoryFiltersBuilt = false;

  const holo = createHalobandHolo(elements.holoCanvasEl);

  const navButtons = Array.from(
    elements.rootEl.querySelectorAll<HTMLButtonElement>('[data-haloband-tab]'),
  );
  const panels = Array.from(
    elements.rootEl.querySelectorAll<HTMLElement>('[data-haloband-panel]'),
  );
  const shipNavBtn = elements.rootEl.querySelector<HTMLButtonElement>(
    '[data-haloband-tab="ship"]',
  );

  function refreshBindings(): void {
    const bindings = loadGameSettings().input.mouseKeyboard.bindings;
    haloBandCodes = getKeyboardBindingCodes(bindings, 'haloBand');
  }

  function isShipTabVisible(): boolean {
    return shipNavBtn !== null && !shipNavBtn.classList.contains('is-hidden');
  }

  function renderBalance(): void {
    const balance = callbacks.getArcBalance();
    if (balance === lastRenderedBalance) return;
    lastRenderedBalance = balance;
    elements.balanceEl.classList.toggle('is-hidden', balance === null);
    if (balance === null) {
      elements.balanceValueEl.textContent = '—';
      return;
    }
    elements.balanceValueEl.textContent = `${balance.toLocaleString()} ARC`;
  }

  function renderShipStatus(): void {
    const host = elements.shipStatusEl;
    host.replaceChildren();
    if (!latestParams) {
      const empty = document.createElement('p');
      empty.className = 'sc-haloband-empty';
      empty.textContent = 'No active ship.';
      host.appendChild(empty);
      return;
    }
    const { world, shipSurface } = latestParams;
    const ship = getActiveShip(world);
    const body = ship.body;
    const speed = length(body.velocity);
    const altitude = shipSurface.altitudeMeters;

    const vitals = document.createElement('div');
    vitals.className = 'sc-haloband-ship-section';
    const vitalsTitle = document.createElement('h4');
    vitalsTitle.className = 'sc-haloband-ship-section-title';
    vitalsTitle.textContent = 'Vitals';
    vitals.append(vitalsTitle);
    vitals.append(makeBarStat('Hull', ship.vitals.hp, ship.spec.maxHp, 'hp'));
    vitals.append(makeBarStat('Shields', ship.vitals.shields, ship.spec.maxShields, 'shield'));
    vitals.append(makeRowStat('Max Speed', `${Math.round(ship.spec.maxSpeedMps)} m/s`));
    vitals.append(makeRowStat('Speed', `${Math.round(speed)} m/s`));
    vitals.append(makeRowStat('Altitude', `${Math.round(altitude).toLocaleString()} m`));
    vitals.append(makeRowStat('Status', body.grounded ? 'Grounded' : 'Airborne'));

    const rig = ship.rig;
    const systems = document.createElement('div');
    systems.className = 'sc-haloband-ship-section';
    const systemsTitle = document.createElement('h4');
    systemsTitle.className = 'sc-haloband-ship-section-title';
    systemsTitle.textContent = 'Systems';
    systems.append(systemsTitle);
    systems.append(makeRowStat('Landing Gear', rig.gearDown ? 'Deployed' : 'Retracted'));
    systems.append(makeRowStat('Boarding Ramp', rig.rampDown ? 'Lowered' : 'Raised'));
    for (const [id, door] of Object.entries(rig.doors)) {
      systems.append(makeRowStat(`${id} Door`, door.isOpen ? 'Open' : 'Closed'));
    }

    host.append(vitals, systems);
  }

  function ensureInventoryFilters(): void {
    if (inventoryFiltersBuilt) return;
    inventoryFiltersBuilt = true;
    elements.inventoryFiltersEl.replaceChildren();
    for (const filter of INVENTORY_FILTERS) {
      const button = document.createElement('button');
      button.type = 'button';
      button.className = 'sc-haloband-inventory-filter';
      button.dataset.inventoryFilter = filter.id;
      button.textContent = filter.label;
      button.classList.toggle('is-active', filter.id === inventoryFilter);
      button.addEventListener('click', () => {
        inventoryFilter = filter.id;
        for (const chip of elements.inventoryFiltersEl.querySelectorAll<HTMLButtonElement>(
          '.sc-haloband-inventory-filter',
        )) {
          chip.classList.toggle('is-active', chip.dataset.inventoryFilter === inventoryFilter);
        }
        renderInventory();
      });
      elements.inventoryFiltersEl.append(button);
    }
  }

  function renderInventoryDetail(definition: ItemDefinition, quantity: number): void {
    const host = elements.inventoryDetailEl;
    host.replaceChildren();

    const icon = document.createElement('div');
    icon.className = 'sc-haloband-inventory-detail-icon';
    paintItemIcon(icon, definition);

    const name = document.createElement('h4');
    name.className = 'sc-haloband-inventory-detail-name';
    name.textContent = definition.name;

    const meta = document.createElement('p');
    meta.className = 'sc-haloband-inventory-detail-meta';
    meta.textContent = `${definition.itemType} · ${definition.subType} · ${definition.rarity}`;

    const qty = document.createElement('p');
    qty.className = 'sc-haloband-inventory-detail-qty';
    qty.textContent = `Quantity: ${quantity.toLocaleString()} / ${definition.stackMax.toLocaleString()}`;

    const description = document.createElement('p');
    description.className = 'sc-haloband-inventory-detail-desc';
    description.textContent = definition.description;

    host.append(icon, name, meta, qty, description);
  }

  function renderInventory(): void {
    ensureInventoryFilters();
    const inventory = callbacks.getInventory();
    const grid = elements.inventoryGridEl;
    grid.replaceChildren();

    if (!inventory) {
      const empty = document.createElement('p');
      empty.className = 'sc-haloband-empty';
      empty.textContent = 'Inventory unavailable offline.';
      grid.append(empty);
      elements.inventoryDetailEl.replaceChildren();
      return;
    }

    const stacks = itemsByType(inventory, inventoryFilter === 'all' ? null : inventoryFilter);
    if (stacks.length === 0) {
      const empty = document.createElement('p');
      empty.className = 'sc-haloband-empty';
      empty.textContent = 'No items in this category.';
      grid.append(empty);
      elements.inventoryDetailEl.replaceChildren();
      selectedItemId = null;
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
      button.className = 'sc-haloband-inventory-slot';
      button.classList.toggle('is-selected', stack.itemDefinitionId === selectedItemId);
      button.title = definition.name;

      const icon = document.createElement('div');
      icon.className = 'sc-haloband-inventory-slot-icon';
      paintItemIcon(icon, definition);

      const qty = document.createElement('span');
      qty.className = 'sc-haloband-inventory-slot-qty';
      qty.textContent = stack.quantity > 1 ? String(stack.quantity) : '';

      button.append(icon, qty);
      button.addEventListener('click', () => {
        selectedItemId = stack.itemDefinitionId;
        renderInventory();
      });
      grid.append(button);
    }

    const selected = selectedItemId
      ? stacks.find((stack) => stack.itemDefinitionId === selectedItemId)
      : null;
    const selectedDefinition = selected
      ? findItemDefinition(inventory.catalog, selected.itemDefinitionId)
      : null;
    if (selected && selectedDefinition) {
      renderInventoryDetail(selectedDefinition, selected.quantity);
    } else {
      elements.inventoryDetailEl.replaceChildren();
    }
  }

  function updateShipTabVisibility(): void {
    const mode = latestParams?.world.mode ?? null;
    const visible = mode ? isShipMode(mode) : false;
    shipNavBtn?.classList.toggle('is-hidden', !visible);
    if (!visible && activeTab === 'ship') {
      setActiveTab('comms');
    }
  }

  function setActiveTab(tab: HaloBandTab): void {
    activeTab = tab;
    for (const button of navButtons) {
      button.classList.toggle('is-active', button.dataset.halobandTab === tab);
    }
    for (const panel of panels) {
      panel.classList.toggle('is-active', panel.dataset.halobandPanel === tab);
    }
    if (tab === 'ship') renderShipStatus();
    if (tab === 'inventory') renderInventory();
  }

  function setOpen(next: boolean): void {
    if (open === next) return;
    open = next;
    elements.rootEl.classList.toggle('is-open', open);
    elements.rootEl.setAttribute('aria-hidden', open ? 'false' : 'true');
    if (open) {
      document.exitPointerLock?.();
      callbacks.playerControls.setInputSuppressed(true);
      updateShipTabVisibility();
      renderBalance();
      holo.start();
      if (activeTab === 'ship' && !isShipTabVisible()) setActiveTab('comms');
      else setActiveTab(activeTab);
      if (activeTab === 'comms') {
        elements.chatInputEl.focus({ preventScroll: true });
      } else {
        navButtons[0]?.focus({ preventScroll: true });
      }
      return;
    }
    holo.stop();
    callbacks.playerControls.setInputSuppressed(false);
    elements.chatInputEl.blur();
  }

  function appendChatMessage(author: string, text: string): void {
    const line = document.createElement('div');
    line.className = 'sc-haloband-chat-line';
    const authorEl = document.createElement('span');
    authorEl.className = 'sc-haloband-chat-author';
    authorEl.textContent = author;
    const textEl = document.createElement('span');
    textEl.className = 'sc-haloband-chat-text';
    textEl.textContent = text;
    line.append(authorEl, textEl);
    elements.chatMessagesEl.appendChild(line);
    elements.chatMessagesEl.scrollTop = elements.chatMessagesEl.scrollHeight;
  }

  function sendMessage(): void {
    const text = elements.chatInputEl.value.trim();
    if (!text) return;
    callbacks.onSendMessage(text);
    elements.chatInputEl.value = '';
  }

  function update(params: HaloBandUpdateParams): void {
    const modeChanged = latestParams?.world.mode !== params.world.mode;
    latestParams = params;
    if (!open) return;
    renderBalance();
    if (modeChanged) updateShipTabVisibility();
    if (activeTab === 'ship' && isShipTabVisible()) renderShipStatus();
    if (activeTab === 'inventory') renderInventory();
  }

  for (const button of navButtons) {
    button.addEventListener('click', () => {
      const tab = button.dataset.halobandTab as HaloBandTab | undefined;
      if (tab) setActiveTab(tab);
    });
  }

  elements.sendBtnEl.addEventListener('click', () => sendMessage());
  elements.chatInputEl.addEventListener('keydown', (event) => {
    if (event.key === 'Enter') {
      event.preventDefault();
      sendMessage();
    }
    event.stopPropagation();
  });
  elements.chatInputEl.addEventListener('keyup', (event) => event.stopPropagation());
  elements.chatInputEl.addEventListener('keypress', (event) => event.stopPropagation());

  refreshBindings();

  const handleSettingsChanged = () => refreshBindings();
  window.addEventListener(GAME_SETTINGS_CHANGED_EVENT, handleSettingsChanged);

  const handleKeyDown = (event: KeyboardEvent) => {
    if (event.key === 'Escape' && open) {
      event.preventDefault();
      event.stopImmediatePropagation();
      setOpen(false);
      return;
    }
    if (!haloBandCodes.includes(event.code)) return;
    if (open) {
      event.preventDefault();
      event.stopPropagation();
      setOpen(false);
      return;
    }
    if (isTypingTarget(event.target)) return;
    event.preventDefault();
    event.stopPropagation();
    setOpen(true);
  };
  window.addEventListener('keydown', handleKeyDown, true);

  appendChatMessage('SYS', 'HaloBand commlink ready.');

  return {
    dispose() {
      window.removeEventListener('keydown', handleKeyDown, true);
      window.removeEventListener(GAME_SETTINGS_CHANGED_EVENT, handleSettingsChanged);
      callbacks.playerControls.setInputSuppressed(false);
      holo.dispose();
    },
    isOpen() {
      return open;
    },
    isPaused() {
      return false;
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
    appendChatMessage,
    update,
  };
}

export type HaloBandController = ReturnType<typeof createHaloBand>;
