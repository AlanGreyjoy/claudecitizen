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
import { deriveEnvironmentStatus } from '../../../player/environment_status';
import { getActiveShip, type WorldState } from '../../../player/world_state';
import {
  findItemDefinition,
  itemsByType,
  type InventoryState,
  type ItemDefinition,
  type ItemType,
} from '../../../player/inventory/types';
import type { GameMode, Planet, PlanetSurfaceSample } from '../../../types';
import { createUiIcon, UiIcons } from '../../../ui/icons';
import { paintItemIcon } from './item_icon';
import { mountHaloBandDockIcons } from './haloband_icons';
import { createSystemMapPanel, type SystemMapPanel } from './system_map_panel';
import type { HaloBandElements } from './haloband_dom';

export type { HaloBandElements } from './haloband_dom';

export interface HaloBandUpdateParams {
  world: WorldState;
  shipSurface: PlanetSurfaceSample;
  focusSurface: PlanetSurfaceSample;
  planet: Planet;
}

export interface HaloBandCallbacks {
  onSendMessage: (text: string) => void;
  playerControls: { setInputSuppressed: (value: boolean) => void };
  /** Returns the player's current ARC balance, or null when offline / unavailable. */
  getArcBalance: () => number | null;
  /** Returns portable inventory state, or null when offline / unavailable. */
  getInventory: () => InventoryState | null;
}

export interface HaloBandOptions {
  /**
   * Editor Menu Manager preview: embedded layout, no F2/Esc listeners,
   * opens immediately on create.
   */
  preview?: boolean;
}

export type HaloBandTab = 'home' | 'comms' | 'missions' | 'map' | 'inventory' | 'ship';

type InventoryFilter = 'all' | ItemType;

interface NotificationLine {
  author: string;
  text: string;
}

const INVENTORY_FILTERS: Array<{ id: InventoryFilter; label: string }> = [
  { id: 'all', label: 'All' },
  { id: 'consumable', label: 'Consumables' },
  { id: 'clothing', label: 'Clothing' },
  { id: 'weapon', label: 'Weapons' },
  { id: 'armor', label: 'Armor' },
  { id: 'material', label: 'Materials' },
];

const MAX_HOME_NOTIFICATIONS = 6;

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

function formatPct01(value: number): string {
  return `${Math.round(Math.min(1, Math.max(0, value)) * 100)}%`;
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

function makeVitalMetric(
  label: string,
  valueText: string,
  fill01: number | null,
  kind: string,
): HTMLElement {
  const row = document.createElement('div');
  row.className = 'sc-haloband-vital';
  const top = document.createElement('div');
  top.className = 'sc-haloband-vital-top';
  const labelEl = document.createElement('span');
  labelEl.className = 'sc-haloband-vital-label';
  labelEl.textContent = label;
  const valueEl = document.createElement('span');
  valueEl.className = 'sc-haloband-vital-value';
  valueEl.textContent = valueText;
  top.append(labelEl, valueEl);
  row.append(top);
  if (fill01 !== null) {
    const bar = document.createElement('div');
    bar.className = 'sc-haloband-vital-bar';
    const fill = document.createElement('span');
    fill.className = `sc-haloband-vital-fill sc-haloband-vital-fill-${kind}`;
    fill.style.width = `${Math.round(Math.min(1, Math.max(0, fill01)) * 100)}%`;
    bar.append(fill);
    row.append(bar);
  }
  return row;
}

function makeEnvGauge(label: string, valueText: string, fill01: number): HTMLElement {
  const gauge = document.createElement('div');
  gauge.className = 'sc-haloband-env-gauge';
  const ring = document.createElement('div');
  ring.className = 'sc-haloband-env-ring';
  const clamped = Math.min(1, Math.max(0, fill01));
  ring.style.setProperty('--fill', String(clamped));
  const value = document.createElement('span');
  value.className = 'sc-haloband-env-value';
  value.textContent = valueText;
  ring.append(value);
  const caption = document.createElement('span');
  caption.className = 'sc-haloband-env-label';
  caption.textContent = label;
  gauge.append(ring, caption);
  return gauge;
}

export function createHaloBand(
  elements: HaloBandElements,
  callbacks: HaloBandCallbacks,
  options: HaloBandOptions = {},
) {
  // TODO: implement the missions system — data model, persistent store, and
  // backend integration. The Missions tab currently renders a static placeholder.
  const preview = options.preview === true;
  let open = false;
  let activeTab: HaloBandTab = 'home';
  let latestParams: HaloBandUpdateParams | null = null;
  let haloBandCodes: readonly string[] = [];
  let lastRenderedBalance: number | null | undefined;
  let inventoryFilter: InventoryFilter = 'all';
  let selectedItemId: string | null = null;
  let inventoryFiltersBuilt = false;
  const notifications: NotificationLine[] = [];
  let lastHomeRenderMs = 0;

  if (preview) {
    elements.rootEl.classList.add('is-embedded');
  }

  mountHaloBandDockIcons(elements.rootEl);

  let systemMapPanel: SystemMapPanel | null = null;

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
    elements.balanceValueEl.textContent = balance.toLocaleString();
  }

  function renderHomeContracts(): void {
    const host = elements.homeContractsEl;
    host.replaceChildren();
    const empty = document.createElement('p');
    empty.className = 'sc-haloband-empty';
    empty.textContent = 'No mission tracked';
    const hint = document.createElement('p');
    hint.className = 'sc-haloband-tile-note';
    hint.textContent = 'Track objectives from the Contracts app.';
    host.append(empty, hint);
  }

  function renderHomeNotifications(): void {
    const host = elements.homeNotificationsEl;
    host.replaceChildren();
    if (notifications.length === 0) {
      const empty = document.createElement('p');
      empty.className = 'sc-haloband-empty';
      empty.textContent = 'No recent alerts.';
      host.append(empty);
      return;
    }
    const list = document.createElement('ul');
    list.className = 'sc-haloband-notify-list';
    for (const line of notifications.slice(-MAX_HOME_NOTIFICATIONS).reverse()) {
      const item = document.createElement('li');
      item.className = 'sc-haloband-notify-item';
      const author = document.createElement('span');
      author.className = 'sc-haloband-notify-author';
      author.textContent = line.author;
      const text = document.createElement('span');
      text.className = 'sc-haloband-notify-text';
      text.textContent = line.text;
      item.append(author, text);
      list.append(item);
    }
    host.append(list);
  }

  function renderHomeVehicles(): void {
    const host = elements.homeVehiclesEl;
    host.replaceChildren();
    if (!latestParams || !isShipMode(latestParams.world.mode)) {
      const empty = document.createElement('p');
      empty.className = 'sc-haloband-empty';
      empty.textContent = 'Ship data: null';
      const hint = document.createElement('p');
      hint.className = 'sc-haloband-tile-note';
      hint.textContent = 'Connect to your ship to stream vehicle status.';
      host.append(empty, hint);
      return;
    }

    const { world, shipSurface } = latestParams;
    const ship = getActiveShip(world);
    const speed = length(ship.body.velocity);
    host.append(makeBarStat('Hull', ship.vitals.hp, ship.spec.maxHp, 'hp'));
    host.append(makeBarStat('Shields', ship.vitals.shields, ship.spec.maxShields, 'shield'));
    host.append(makeRowStat('Speed', `${Math.round(speed)} m/s`));
    host.append(
      makeRowStat('Altitude', `${Math.round(shipSurface.altitudeMeters).toLocaleString()} m`),
    );
    host.append(makeRowStat('Status', ship.body.grounded ? 'Grounded' : 'Airborne'));
  }

  function renderHomeEnvironment(): void {
    const host = elements.homeEnvironmentEl;
    host.replaceChildren();
    if (!latestParams) {
      const empty = document.createElement('p');
      empty.className = 'sc-haloband-empty';
      empty.textContent = 'Environment unavailable.';
      host.append(empty);
      return;
    }
    const env = deriveEnvironmentStatus(latestParams.planet, latestParams.focusSurface);
    const grid = document.createElement('div');
    grid.className = 'sc-haloband-env-grid';
    grid.append(
      makeEnvGauge('Gravity', `${env.gravityG.toFixed(2)} G`, Math.min(1, env.gravityG / 1.5)),
      makeEnvGauge('Atmosphere', env.atmosphereLabel, env.atmosphere01),
      makeEnvGauge('Pressure', `${Math.round(env.pressureHpa)} hPa`, env.atmosphere01),
      makeEnvGauge(
        'Temp',
        `${env.temperatureC >= 0 ? '' : '−'}${Math.abs(Math.round(env.temperatureC))}°C`,
        Math.min(1, Math.max(0, (env.temperatureC + 40) / 80)),
      ),
      makeEnvGauge('Radiation', `${env.radiationRemS.toFixed(2)} Rem/s`, 0.05),
    );
    host.append(grid);
  }

  function renderHomeVitals(): void {
    const host = elements.homeVitalsEl;
    host.replaceChildren();
    const vitals = latestParams?.world.vitals;
    if (!vitals) {
      const empty = document.createElement('p');
      empty.className = 'sc-haloband-empty';
      empty.textContent = 'Status offline.';
      host.append(empty);
      return;
    }

    const figure = document.createElement('div');
    figure.className = 'sc-haloband-vitals-figure';
    figure.setAttribute('aria-hidden', 'true');
    figure.append(
      createUiIcon(UiIcons.personStanding, {
        className: 'sc-haloband-vitals-silhouette sc-ui-icon',
        size: 72,
        strokeWidth: 1.4,
      }),
    );

    const metrics = document.createElement('div');
    metrics.className = 'sc-haloband-vitals-metrics';
    metrics.append(
      makeVitalMetric('Health', formatPct01(vitals.health01), vitals.health01, 'health'),
      makeVitalMetric('Body Temp', `${vitals.bodyTempC.toFixed(1)}°C`, null, 'temp'),
      makeVitalMetric(
        'Heart Rate',
        `${Math.round(vitals.heartRateBpm)} bpm`,
        Math.min(1, vitals.heartRateBpm / 160),
        'heart',
      ),
      makeVitalMetric(
        'Nourishment',
        formatPct01(vitals.nourishment01),
        vitals.nourishment01,
        'fuel',
      ),
      makeVitalMetric('Oxygen', formatPct01(vitals.oxygen01), vitals.oxygen01, 'oxygen'),
    );

    const layout = document.createElement('div');
    layout.className = 'sc-haloband-vitals-layout';
    layout.append(figure, metrics);
    host.append(layout);
  }

  function renderHome(): void {
    renderHomeContracts();
    renderHomeNotifications();
    renderHomeVehicles();
    renderHomeEnvironment();
    renderHomeVitals();
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
      setActiveTab('home');
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
    if (tab === 'home') renderHome();
    if (tab === 'ship') renderShipStatus();
    if (tab === 'inventory') renderInventory();
    if (tab === 'map') {
      systemMapPanel ??= createSystemMapPanel(elements.systemMapHostEl);
      systemMapPanel.refresh();
    }
  }

  function setOpen(next: boolean): void {
    if (open === next) return;
    open = next;
    elements.rootEl.classList.toggle('is-open', open);
    elements.rootEl.setAttribute('aria-hidden', open ? 'false' : 'true');
    if (open) {
      if (!preview) {
        document.exitPointerLock?.();
        callbacks.playerControls.setInputSuppressed(true);
      }
      updateShipTabVisibility();
      renderBalance();
      if (activeTab === 'ship' && !isShipTabVisible()) setActiveTab('home');
      else setActiveTab(activeTab);
      if (!preview) {
        if (activeTab === 'comms') {
          elements.chatInputEl.focus({ preventScroll: true });
        } else {
          navButtons.find((btn) => btn.dataset.halobandTab === 'home')?.focus({
            preventScroll: true,
          });
        }
      }
      return;
    }
    if (!preview) {
      callbacks.playerControls.setInputSuppressed(false);
    }
    elements.chatInputEl.blur();
  }

  function appendChatMessage(author: string, text: string): void {
    notifications.push({ author, text });
    if (notifications.length > 40) notifications.splice(0, notifications.length - 40);

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

    if (open && activeTab === 'home') {
      renderHomeNotifications();
    }
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
    if (activeTab === 'home') {
      const now = performance.now();
      if (modeChanged || now - lastHomeRenderMs >= 200) {
        lastHomeRenderMs = now;
        renderHome();
      }
    }
    if (activeTab === 'ship' && isShipTabVisible() && modeChanged) {
      renderShipStatus();
    } else if (activeTab === 'ship' && isShipTabVisible()) {
      const now = performance.now();
      if (now - lastHomeRenderMs >= 200) {
        lastHomeRenderMs = now;
        renderShipStatus();
      }
    }
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
  if (!preview) {
    window.addEventListener('keydown', handleKeyDown, true);
  }

  appendChatMessage('SYS', 'HaloBand online.');
  appendChatMessage('SYS', 'Commlink ready.');

  if (preview) {
    setOpen(true);
  }

  return {
    dispose() {
      if (!preview) {
        window.removeEventListener('keydown', handleKeyDown, true);
      }
      window.removeEventListener(GAME_SETTINGS_CHANGED_EVENT, handleSettingsChanged);
      if (!preview) {
        callbacks.playerControls.setInputSuppressed(false);
      }
      systemMapPanel?.dispose();
      systemMapPanel = null;
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
    setActiveTab,
    appendChatMessage,
    update,
  };
}

export type HaloBandController = ReturnType<typeof createHaloBand>;
