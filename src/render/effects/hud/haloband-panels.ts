import { length } from '../../../math/vec3';
import {
  MODE_ENTERING_SHIP,
  MODE_IN_SHIP,
  MODE_LEAVING_PILOT,
  MODE_ON_SHIP_DECK,
} from '../../../player/modes';
import { deriveEnvironmentStatus } from '../../../player/environment-status';
import { getActiveShip } from '../../../player/world-state';
import {
  findItemDefinition,
  itemsByType,
  type ItemDefinition,
  type ItemType,
} from '../../../player/inventory/types';
import type { GameMode } from '../../../types';
import { createUiIcon, UiIcons } from '../../../ui/icons';
import { paintItemIcon } from './item-icon';
import type { HaloBandElements } from './haloband-dom';
import type { HaloBandCallbacks, HaloBandUpdateParams } from './haloband-types';

type InventoryFilter = 'all' | ItemType;

export interface HaloBandNotificationLine {
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
  if (
    fill01 !== null &&
    fill01 < 0.25 &&
    (kind === 'hunger' || kind === 'thirst')
  ) {
    row.classList.add('is-warning');
  }
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


export function isShipMode(mode: GameMode): boolean {
  return (
    mode === MODE_IN_SHIP ||
    mode === MODE_ON_SHIP_DECK ||
    mode === MODE_ENTERING_SHIP ||
    mode === MODE_LEAVING_PILOT
  );
}

export interface HaloBandPanelContext {
  elements: HaloBandElements;
  callbacks: HaloBandCallbacks;
  notifications: HaloBandNotificationLine[];
  refs: {
    latestParams: HaloBandUpdateParams | null;
    inventoryFilter: InventoryFilter;
    selectedItemId: string | null;
    inventoryFiltersBuilt: boolean;
  };
}

export function createHaloBandPanels(ctx: HaloBandPanelContext) {
  function renderHomeContracts(): void {
    const host = ctx.elements.homeContractsEl;
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
    const host = ctx.elements.homeNotificationsEl;
    host.replaceChildren();
    if (ctx.notifications.length === 0) {
      const empty = document.createElement('p');
      empty.className = 'sc-haloband-empty';
      empty.textContent = 'No recent alerts.';
      host.append(empty);
      return;
    }
    const list = document.createElement('ul');
    list.className = 'sc-haloband-notify-list';
    for (const line of ctx.notifications.slice(-MAX_HOME_NOTIFICATIONS).reverse()) {
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
    const host = ctx.elements.homeVehiclesEl;
    host.replaceChildren();
    if (!ctx.refs.latestParams || !isShipMode(ctx.refs.latestParams.world.mode)) {
      const empty = document.createElement('p');
      empty.className = 'sc-haloband-empty';
      empty.textContent = 'Ship data: null';
      const hint = document.createElement('p');
      hint.className = 'sc-haloband-tile-note';
      hint.textContent = 'Connect to your ship to stream vehicle status.';
      host.append(empty, hint);
      return;
    }

    const { world, shipSurface } = ctx.refs.latestParams;
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
    const host = ctx.elements.homeEnvironmentEl;
    host.replaceChildren();
    if (!ctx.refs.latestParams) {
      const empty = document.createElement('p');
      empty.className = 'sc-haloband-empty';
      empty.textContent = 'Environment unavailable.';
      host.append(empty);
      return;
    }
    const env = deriveEnvironmentStatus(ctx.refs.latestParams.planet, ctx.refs.latestParams.focusSurface);
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
    const host = ctx.elements.homeVitalsEl;
    host.replaceChildren();
    const vitals = ctx.refs.latestParams?.world.vitals;
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
        'Hunger',
        formatPct01(vitals.hungerReserve01),
        vitals.hungerReserve01,
        'hunger',
      ),
      makeVitalMetric(
        'Thirst',
        formatPct01(vitals.thirstReserve01),
        vitals.thirstReserve01,
        'thirst',
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
    const host = ctx.elements.shipStatusEl;
    host.replaceChildren();
    if (!ctx.refs.latestParams) {
      const empty = document.createElement('p');
      empty.className = 'sc-haloband-empty';
      empty.textContent = 'No active ship.';
      host.appendChild(empty);
      return;
    }
    const { world, shipSurface } = ctx.refs.latestParams;
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
    if (ctx.refs.inventoryFiltersBuilt) return;
    ctx.refs.inventoryFiltersBuilt = true;
    ctx.elements.inventoryFiltersEl.replaceChildren();
    for (const filter of INVENTORY_FILTERS) {
      const button = document.createElement('button');
      button.type = 'button';
      button.className = 'sc-haloband-inventory-filter';
      button.dataset.inventoryFilter = filter.id;
      button.textContent = filter.label;
      button.classList.toggle('is-active', filter.id === ctx.refs.inventoryFilter);
      button.addEventListener('click', () => {
        ctx.refs.inventoryFilter = filter.id;
        for (const chip of ctx.elements.inventoryFiltersEl.querySelectorAll<HTMLButtonElement>(
          '.sc-haloband-inventory-filter',
        )) {
          chip.classList.toggle('is-active', chip.dataset.inventoryFilter === ctx.refs.inventoryFilter);
        }
        renderInventory();
      });
      ctx.elements.inventoryFiltersEl.append(button);
    }
  }

  function renderInventoryDetail(definition: ItemDefinition, quantity: number): void {
    const host = ctx.elements.inventoryDetailEl;
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
    const inventory = ctx.callbacks.getInventory();
    const grid = ctx.elements.inventoryGridEl;
    grid.replaceChildren();

    if (!inventory) {
      const empty = document.createElement('p');
      empty.className = 'sc-haloband-empty';
      empty.textContent = 'Inventory unavailable offline.';
      grid.append(empty);
      ctx.elements.inventoryDetailEl.replaceChildren();
      return;
    }

    const stacks = itemsByType(inventory, ctx.refs.inventoryFilter === 'all' ? null : ctx.refs.inventoryFilter);
    if (stacks.length === 0) {
      const empty = document.createElement('p');
      empty.className = 'sc-haloband-empty';
      empty.textContent = 'No items in this category.';
      grid.append(empty);
      ctx.elements.inventoryDetailEl.replaceChildren();
      ctx.refs.selectedItemId = null;
      return;
    }

    if (!ctx.refs.selectedItemId || !stacks.some((stack) => stack.itemDefinitionId === ctx.refs.selectedItemId)) {
      ctx.refs.selectedItemId = stacks[0]?.itemDefinitionId ?? null;
    }

    for (const stack of stacks) {
      const definition = findItemDefinition(inventory.catalog, stack.itemDefinitionId);
      if (!definition) continue;

      const button = document.createElement('button');
      button.type = 'button';
      button.className = 'sc-haloband-inventory-slot';
      button.classList.toggle('is-selected', stack.itemDefinitionId === ctx.refs.selectedItemId);
      button.title = definition.name;

      const icon = document.createElement('div');
      icon.className = 'sc-haloband-inventory-slot-icon';
      paintItemIcon(icon, definition);

      const qty = document.createElement('span');
      qty.className = 'sc-haloband-inventory-slot-qty';
      qty.textContent = stack.quantity > 1 ? String(stack.quantity) : '';

      button.append(icon, qty);
      button.addEventListener('click', () => {
        ctx.refs.selectedItemId = stack.itemDefinitionId;
        renderInventory();
      });
      grid.append(button);
    }

    const selected = ctx.refs.selectedItemId
      ? stacks.find((stack) => stack.itemDefinitionId === ctx.refs.selectedItemId)
      : null;
    const selectedDefinition = selected
      ? findItemDefinition(inventory.catalog, selected.itemDefinitionId)
      : null;
    if (selected && selectedDefinition) {
      renderInventoryDetail(selectedDefinition, selected.quantity);
    } else {
      ctx.elements.inventoryDetailEl.replaceChildren();
    }
  }


  return {
    renderHome,
    renderHomeNotifications,
    renderShipStatus,
    renderInventory,
  };
}
