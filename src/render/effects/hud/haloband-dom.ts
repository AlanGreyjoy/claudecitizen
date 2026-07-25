import { createHaloBandDockIcon } from './haloband_icons';
import { createUiIcon, UiIcons } from '../../../ui/icons';

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
  systemMapHostEl: HTMLElement;
  homeContractsEl: HTMLElement;
  homeNotificationsEl: HTMLElement;
  homeVehiclesEl: HTMLElement;
  homeEnvironmentEl: HTMLElement;
  homeVitalsEl: HTMLElement;
  dockEl: HTMLElement;
}

function idFor(prefix: string, suffix: string): string {
  return prefix ? `${prefix}-${suffix}` : suffix;
}

function makeTile(
  title: string,
  body: HTMLElement,
  options: { expand?: boolean } = {},
): HTMLElement {
  const tile = document.createElement('article');
  tile.className = 'sc-haloband-tile';
  const header = document.createElement('header');
  header.className = 'sc-haloband-tile-header';
  const titleEl = document.createElement('h3');
  titleEl.className = 'sc-haloband-tile-title';
  titleEl.textContent = title;
  header.append(titleEl);
  if (options.expand !== false) {
    const expand = document.createElement('span');
    expand.className = 'sc-haloband-tile-expand';
    expand.setAttribute('aria-hidden', 'true');
    expand.append(
      createUiIcon(UiIcons.externalLink, {
        className: 'sc-ui-icon',
        size: 10,
        strokeWidth: 2,
      }),
    );
    header.append(expand);
  }
  const content = document.createElement('div');
  content.className = 'sc-haloband-tile-body';
  content.append(body);
  tile.append(header, content);
  return tile;
}

/**
 * Build HaloBand device markup. Play uses the static tree in `index.html`;
 * Menu Manager uses this factory with an id prefix to avoid collisions.
 */
export function buildHaloBandDom(idPrefix = ''): HaloBandElements {
  const rootId = idFor(idPrefix, 'haloband');
  const titleId = idFor(idPrefix, 'haloband-title');
  const rootEl = document.createElement('div');
  rootEl.className = 'sc-haloband';
  rootEl.id = rootId;
  rootEl.setAttribute('aria-hidden', 'true');
  rootEl.setAttribute('role', 'dialog');
  rootEl.setAttribute('aria-labelledby', titleId);
  rootEl.setAttribute('aria-modal', 'true');

  const backdrop = document.createElement('div');
  backdrop.className = 'sc-haloband-backdrop';

  const bezel = document.createElement('div');
  bezel.className = 'sc-haloband-bezel';

  const screen = document.createElement('div');
  screen.className = 'sc-haloband-screen';

  const holoCanvasEl = document.createElement('canvas');
  holoCanvasEl.className = 'sc-haloband-holo';
  holoCanvasEl.id = idFor(idPrefix, 'haloband-holo');
  holoCanvasEl.setAttribute('aria-hidden', 'true');

  const title = document.createElement('h2');
  title.className = 'sc-haloband-sr-title';
  title.id = titleId;
  title.textContent = 'HaloBand';

  const shell = document.createElement('div');
  shell.className = 'sc-haloband-shell';

  const main = document.createElement('div');
  main.className = 'sc-haloband-main';

  // —— Home ——
  const panelHome = document.createElement('section');
  panelHome.className = 'sc-haloband-panel is-active';
  panelHome.id = idFor(idPrefix, 'haloband-panel-home');
  panelHome.dataset.halobandPanel = 'home';

  const homeGrid = document.createElement('div');
  homeGrid.className = 'sc-haloband-home';

  const homeContractsEl = document.createElement('div');
  homeContractsEl.className = 'sc-haloband-home-contracts';
  homeContractsEl.id = idFor(idPrefix, 'haloband-home-contracts');

  const homeNotificationsEl = document.createElement('div');
  homeNotificationsEl.className = 'sc-haloband-home-notifications';
  homeNotificationsEl.id = idFor(idPrefix, 'haloband-home-notifications');

  const homeVehiclesEl = document.createElement('div');
  homeVehiclesEl.className = 'sc-haloband-home-vehicles';
  homeVehiclesEl.id = idFor(idPrefix, 'haloband-home-vehicles');

  const homeEnvironmentEl = document.createElement('div');
  homeEnvironmentEl.className = 'sc-haloband-home-environment';
  homeEnvironmentEl.id = idFor(idPrefix, 'haloband-home-environment');

  const homeVitalsEl = document.createElement('div');
  homeVitalsEl.className = 'sc-haloband-home-vitals';
  homeVitalsEl.id = idFor(idPrefix, 'haloband-home-vitals');

  const colLeft = document.createElement('div');
  colLeft.className = 'sc-haloband-home-col sc-haloband-home-col-left';
  colLeft.append(
    makeTile('Contracts', homeContractsEl),
    makeTile('Notifications', homeNotificationsEl),
  );

  const colCenter = document.createElement('div');
  colCenter.className = 'sc-haloband-home-col sc-haloband-home-col-center';
  colCenter.append(
    makeTile('Vehicles', homeVehiclesEl),
    makeTile('Environment', homeEnvironmentEl),
  );

  const colRight = document.createElement('div');
  colRight.className = 'sc-haloband-home-col sc-haloband-home-col-right';
  colRight.append(makeTile('Status', homeVitalsEl));

  homeGrid.append(colLeft, colCenter, colRight);
  panelHome.append(homeGrid);

  // —— Comms ——
  const panelComms = document.createElement('section');
  panelComms.className = 'sc-haloband-panel';
  panelComms.id = idFor(idPrefix, 'haloband-panel-comms');
  panelComms.dataset.halobandPanel = 'comms';
  const commsTitle = document.createElement('h3');
  commsTitle.className = 'sc-haloband-panel-title';
  commsTitle.textContent = 'Commlink';
  const chatMessagesEl = document.createElement('div');
  chatMessagesEl.className = 'sc-haloband-chat';
  chatMessagesEl.id = idFor(idPrefix, 'haloband-chat-messages');
  const chatRow = document.createElement('div');
  chatRow.className = 'sc-haloband-chat-input-row';
  const chatInputEl = document.createElement('input');
  chatInputEl.className = 'sc-haloband-chat-input';
  chatInputEl.id = idFor(idPrefix, 'haloband-chat-input');
  chatInputEl.type = 'text';
  chatInputEl.placeholder = 'Send a message...';
  chatInputEl.autocomplete = 'off';
  chatInputEl.maxLength = 240;
  const sendBtnEl = document.createElement('button');
  sendBtnEl.className = 'sc-title-btn sc-title-btn-secondary';
  sendBtnEl.type = 'button';
  sendBtnEl.id = idFor(idPrefix, 'haloband-chat-send');
  sendBtnEl.textContent = 'Send';
  chatRow.append(chatInputEl, sendBtnEl);
  panelComms.append(commsTitle, chatMessagesEl, chatRow);

  // —— Missions ——
  const panelMissions = document.createElement('section');
  panelMissions.className = 'sc-haloband-panel';
  panelMissions.id = idFor(idPrefix, 'haloband-panel-missions');
  panelMissions.dataset.halobandPanel = 'missions';
  const missionsTitle = document.createElement('h3');
  missionsTitle.className = 'sc-haloband-panel-title';
  missionsTitle.textContent = 'Contracts';
  const missionsEmpty = document.createElement('p');
  missionsEmpty.className = 'sc-haloband-empty';
  missionsEmpty.id = idFor(idPrefix, 'haloband-missions-empty');
  missionsEmpty.textContent = 'No active contracts.';
  panelMissions.append(missionsTitle, missionsEmpty);

  // —— Map ——
  const panelMap = document.createElement('section');
  panelMap.className = 'sc-haloband-panel';
  panelMap.id = idFor(idPrefix, 'haloband-panel-map');
  panelMap.dataset.halobandPanel = 'map';
  const mapTitle = document.createElement('h3');
  mapTitle.className = 'sc-haloband-panel-title';
  mapTitle.textContent = 'System Map';
  const systemMapHostEl = document.createElement('div');
  systemMapHostEl.className = 'sc-haloband-system-map-host';
  systemMapHostEl.id = idFor(idPrefix, 'haloband-system-map');
  panelMap.append(mapTitle, systemMapHostEl);

  // —— Inventory ——
  const panelInventory = document.createElement('section');
  panelInventory.className = 'sc-haloband-panel';
  panelInventory.id = idFor(idPrefix, 'haloband-panel-inventory');
  panelInventory.dataset.halobandPanel = 'inventory';
  const inventoryTitle = document.createElement('h3');
  inventoryTitle.className = 'sc-haloband-panel-title';
  inventoryTitle.textContent = 'Inventory';
  const inventoryFiltersEl = document.createElement('div');
  inventoryFiltersEl.className = 'sc-haloband-inventory-filters';
  inventoryFiltersEl.id = idFor(idPrefix, 'haloband-inventory-filters');
  const inventoryBody = document.createElement('div');
  inventoryBody.className = 'sc-haloband-inventory-body';
  const inventoryGridEl = document.createElement('div');
  inventoryGridEl.className = 'sc-haloband-inventory-grid';
  inventoryGridEl.id = idFor(idPrefix, 'haloband-inventory-grid');
  const inventoryDetailEl = document.createElement('div');
  inventoryDetailEl.className = 'sc-haloband-inventory-detail';
  inventoryDetailEl.id = idFor(idPrefix, 'haloband-inventory-detail');
  inventoryBody.append(inventoryGridEl, inventoryDetailEl);
  panelInventory.append(inventoryTitle, inventoryFiltersEl, inventoryBody);

  // —— Ship ——
  const panelShip = document.createElement('section');
  panelShip.className = 'sc-haloband-panel';
  panelShip.id = idFor(idPrefix, 'haloband-panel-ship');
  panelShip.dataset.halobandPanel = 'ship';
  const shipTitle = document.createElement('h3');
  shipTitle.className = 'sc-haloband-panel-title';
  shipTitle.textContent = 'Vehicle Status';
  const shipStatusEl = document.createElement('div');
  shipStatusEl.className = 'sc-haloband-ship';
  shipStatusEl.id = idFor(idPrefix, 'haloband-ship-status');
  panelShip.append(shipTitle, shipStatusEl);

  main.append(
    panelHome,
    panelComms,
    panelMissions,
    panelMap,
    panelInventory,
    panelShip,
  );
  shell.append(main);

  // —— Dock ——
  const dockEl = document.createElement('footer');
  dockEl.className = 'sc-haloband-dock';
  dockEl.id = idFor(idPrefix, 'haloband-dock');

  const balanceEl = document.createElement('div');
  balanceEl.className = 'sc-haloband-balance';
  balanceEl.id = idFor(idPrefix, 'haloband-balance');
  const balanceLabel = document.createElement('span');
  balanceLabel.className = 'sc-haloband-balance-label';
  balanceLabel.textContent = 'ARC';
  const balanceValueEl = document.createElement('span');
  balanceValueEl.className = 'sc-haloband-balance-value';
  balanceValueEl.id = idFor(idPrefix, 'haloband-balance-value');
  balanceValueEl.textContent = '—';
  balanceEl.append(balanceLabel, balanceValueEl);

  const nav = document.createElement('nav');
  nav.className = 'sc-haloband-dock-nav';
  nav.setAttribute('aria-label', 'HaloBand apps');

  const tabs: Array<{ id: string; label: string; shipOnly?: boolean }> = [
    { id: 'home', label: 'Home' },
    { id: 'comms', label: 'Comms' },
    { id: 'missions', label: 'Missions' },
    { id: 'map', label: 'Map' },
    { id: 'inventory', label: 'Inventory' },
    { id: 'ship', label: 'Ship', shipOnly: true },
  ];

  for (const [index, tab] of tabs.entries()) {
    const button = document.createElement('button');
    button.className = 'sc-haloband-dock-btn';
    if (index === 0) button.classList.add('is-active');
    if (tab.shipOnly) button.classList.add('sc-haloband-ship-only', 'is-hidden');
    button.type = 'button';
    button.dataset.halobandTab = tab.id;
    button.setAttribute('aria-controls', idFor(idPrefix, `haloband-panel-${tab.id}`));
    button.setAttribute('aria-label', tab.label);
    button.title = tab.label;
    const icon = createHaloBandDockIcon(tab.id);
    if (icon) button.append(icon);
    const label = document.createElement('span');
    label.className = 'sc-haloband-dock-label';
    label.textContent = tab.label;
    button.append(label);
    nav.append(button);
  }

  const hint = document.createElement('span');
  hint.className = 'sc-haloband-hint';
  hint.textContent = idPrefix ? 'Editor preview' : 'F2 close';

  dockEl.append(balanceEl, nav, hint);

  const brand = document.createElement('div');
  brand.className = 'sc-haloband-chrome-brand';
  brand.setAttribute('aria-hidden', 'true');
  brand.textContent = 'HaloBand';

  screen.append(holoCanvasEl, title, brand, shell, dockEl);
  bezel.append(screen);
  rootEl.append(backdrop, bezel);

  return {
    rootEl,
    chatMessagesEl,
    chatInputEl,
    sendBtnEl,
    shipStatusEl,
    inventoryFiltersEl,
    inventoryGridEl,
    inventoryDetailEl,
    balanceEl,
    balanceValueEl,
    holoCanvasEl,
    systemMapHostEl,
    homeContractsEl,
    homeNotificationsEl,
    homeVehiclesEl,
    homeEnvironmentEl,
    homeVitalsEl,
    dockEl,
  };
}

/** Collect HaloBand element refs from a static `index.html` tree. */
export function collectHaloBandElements(
  rootEl: HTMLElement,
  idPrefix = '',
): HaloBandElements {
  const req = <T extends HTMLElement>(suffix: string): T => {
    const id = idFor(idPrefix, suffix);
    const el = rootEl.id === id ? rootEl : rootEl.querySelector(`#${CSS.escape(id)}`);
    if (!el) throw new Error(`Missing HaloBand element #${id}`);
    return el as T;
  };

  return {
    rootEl,
    chatMessagesEl: req('haloband-chat-messages'),
    chatInputEl: req<HTMLInputElement>('haloband-chat-input'),
    sendBtnEl: req<HTMLButtonElement>('haloband-chat-send'),
    shipStatusEl: req('haloband-ship-status'),
    inventoryFiltersEl: req('haloband-inventory-filters'),
    inventoryGridEl: req('haloband-inventory-grid'),
    inventoryDetailEl: req('haloband-inventory-detail'),
    balanceEl: req('haloband-balance'),
    balanceValueEl: req('haloband-balance-value'),
    holoCanvasEl: req<HTMLCanvasElement>('haloband-holo'),
    systemMapHostEl: req('haloband-system-map'),
    homeContractsEl: req('haloband-home-contracts'),
    homeNotificationsEl: req('haloband-home-notifications'),
    homeVehiclesEl: req('haloband-home-vehicles'),
    homeEnvironmentEl: req('haloband-home-environment'),
    homeVitalsEl: req('haloband-home-vitals'),
    dockEl: req('haloband-dock'),
  };
}
