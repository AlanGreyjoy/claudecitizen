/**
 * Menu Manager — live preview of play HUD menus with mock online data.
 * File → Open Menus switches which overlay is mounted. Preview-only (no save).
 */
import { clearChildren, el } from '../dom';
import { createFlightBody } from '../../flight/flight_body';
import { createShipInstance } from '../../flight/ship_instance';
import { clearShipWorld, registerShipInstance } from '../../flight/ship_world';
import { createQuantumTravelState } from '../../flight/quantum_travel';
import { vec3 } from '../../math/vec3';
import { createCharacterState } from '../../player/character_controller';
import { MODE_IN_SHIP, MODE_IN_STATION } from '../../player/modes';
import { DEFAULT_SHIP_LAYOUT } from '../../player/ship_layout';
import {
  PLAYER_SHIP_INSTANCE_ID,
  type WorldState,
} from '../../player/world_state';
import { createPlayerVitals } from '../../player/vitals';
import { createAvmsTerminal } from '../../render/effects/hud/avms_terminal';
import { createEntertainmentSystem } from '../../render/effects/hud/entertainment_system';
import {
  createGameMenu,
  type GameMenuController,
} from '../../render/effects/hud/game_menu';
import {
  createHaloBand,
  type HaloBandController,
  type HaloBandTab,
} from '../../render/effects/hud/haloband';
import { buildHaloBandDom } from '../../render/effects/hud/haloband_dom';
import { createOutfitters } from '../../render/effects/hud/outfitters';
import { createPersonalInventory } from '../../render/effects/hud/personal_inventory';
import { createWeaponShop } from '../../render/effects/hud/weapon_shop';
import { createFoodShop } from '../../render/effects/hud/food_shop';
import type { PlanetSurfaceSample } from '../../types';
import { DEFAULT_SHIP_PREFAB_ID } from '../../world/ships';
import {
  findMenuCatalogEntry,
  MENU_CATALOG,
  type MenuPreviewId,
} from '../menus/catalog';
import { clonePlayMenuTemplate, requireOrig } from '../menus/clone_template';
import {
  createMockInventory,
  MOCK_ARC_BALANCE,
  MOCK_AVMS_SHIPS,
  MOCK_FOOD_SHOP,
  MOCK_OUTFITTERS,
  MOCK_WEAPON_SHOP,
} from '../menus/mocks';

export interface MenuManagerEditor {
  activate: () => void;
  deactivate: () => void;
  canLeave: () => boolean;
  isDirty: () => boolean;
  save: () => Promise<boolean>;
  openMenu: (id: string) => boolean;
  getActiveMenuId: () => MenuPreviewId;
  /** Menu list chrome — dock into Scene hierarchy panel (full height). */
  getLeftPanel: () => HTMLElement;
}

const MOCK_SHIP_SURFACE: PlanetSurfaceSample = {
  altitudeMeters: 12_500,
  biome: 'plains',
  fertility: 0.4,
  grassDensity: 0.2,
  heightMeters: 120,
  lakeDepth: 0,
  lakeStrength: 0,
  lakeWaterLevelMeters: null,
  moisture: 0.35,
  mountainRegion: 0,
  normalizedHeight: 0.2,
  riverWaterLevelMeters: null,
  surfaceRadiusMeters: 6_371_120,
  temperature: 0.55,
  treeDensity: 0.1,
  waterBody: null,
  waterLevelMeters: null,
};

const HALOBAND_TABS: Array<{ id: HaloBandTab; label: string }> = [
  { id: 'home', label: 'Home' },
  { id: 'comms', label: 'Comms' },
  { id: 'missions', label: 'Missions' },
  { id: 'map', label: 'Map' },
  { id: 'inventory', label: 'Inventory' },
  { id: 'ship', label: 'Ship Status' },
];

type DisposablePreview = { dispose: () => void };

function createMockWorld(shipMode: boolean): WorldState {
  clearShipWorld();
  const body = createFlightBody(vec3(6_371_000 + 12_500, 0, 0));
  body.grounded = false;
  body.velocity = vec3(80, 0, 20);
  const instance = createShipInstance({
    id: PLAYER_SHIP_INSTANCE_ID,
    prefabId: DEFAULT_SHIP_PREFAB_ID,
    layout: DEFAULT_SHIP_LAYOUT,
    body,
    instanceId: 'editor:menu-manager',
    rig: { gearDown: false, rampDown: false },
    vitals: { hp: 820, shields: 640 },
  });
  registerShipInstance(instance);
  return {
    cameraOrbit: { pitchRadians: -0.12, yawRadians: 0, zoomDistance: 5.2 },
    shipCameraView: 'cockpit',
    shipCameraZoom: 1,
    character: createCharacterState(vec3(6_371_000, 0, 0)),
    mode: shipMode ? MODE_IN_SHIP : MODE_IN_STATION,
    shipExteriorWalk: false,
    prompt: '',
    activeShipId: PLAYER_SHIP_INSTANCE_ID,
    activeBedId: null,
    transition: null,
    assignedHangar: null,
    stationElevator: null,
    screenFade: 0,
    flightMode: 'traverse',
    quantum: createQuantumTravelState(),
    systemId: 'default',
    activeStationInstanceId: null,
    vitals: createPlayerVitals(),
    vitalsSyncLocked: false,
  };
}

export function createMenuManagerEditor(host: HTMLElement): MenuManagerEditor {
  clearChildren(host);

  let activeMenuId: MenuPreviewId = 'haloband';
  let shipMode = false;
  let active = false;
  let preview: DisposablePreview | null = null;
  let haloBand: HaloBandController | null = null;
  let mockInventory = createMockInventory();
  let mockBalance = MOCK_ARC_BALANCE;

  // Preview fills the Scene center body; sidebar docks into hierarchy chrome.
  const sidebar = el('div', { className: 'ed-menu-manager-sidebar' });
  const previewHost = el('div', { className: 'ed-menu-manager-preview' });

  const statusEl = el('div', { className: 'ed-menu-manager-status' });
  const descEl = el('p', { className: 'ed-menu-manager-note' });
  const balanceNote = el('p', {
    className: 'ed-menu-manager-note',
    text: `Mock balance: ${MOCK_ARC_BALANCE.toLocaleString()} ARC`,
  });

  const menuSection = el('div', { className: 'ed-menu-manager-section' }, [
    el('div', { className: 'ed-menu-manager-section-title', text: 'Menus' }),
  ]);
  const menuButtons = new Map<string, HTMLButtonElement>();
  for (const entry of MENU_CATALOG) {
    const button = el('button', {
      className: 'ed-menu-manager-tab-btn',
      text: entry.name,
      attrs: { type: 'button', title: entry.description },
      on: {
        click: () => {
          openMenu(entry.id);
        },
      },
    }) as HTMLButtonElement;
    menuButtons.set(entry.id, button);
    menuSection.append(button);
  }

  const halobandExtras = el('div', {
    className: 'ed-menu-manager-section ed-menu-manager-haloband-extras is-hidden',
  });
  halobandExtras.append(
    el('div', { className: 'ed-menu-manager-section-title', text: 'HaloBand tabs' }),
  );
  const tabButtons: HTMLButtonElement[] = [];
  for (const tab of HALOBAND_TABS) {
    const button = el('button', {
      className: 'ed-menu-manager-tab-btn',
      text: tab.label,
      attrs: { type: 'button', 'data-tab': tab.id },
      on: {
        click: () => {
          if (tab.id === 'ship' && !shipMode) {
            shipMode = true;
            shipModeToggle.checked = true;
            pushHaloBandWorld();
          }
          haloBand?.setActiveTab(tab.id);
          syncHaloBandTabButtons(tab.id);
        },
      },
    }) as HTMLButtonElement;
    tabButtons.push(button);
    halobandExtras.append(button);
  }

  const shipModeToggle = document.createElement('input');
  shipModeToggle.type = 'checkbox';
  shipModeToggle.id = 'ed-menu-manager-ship-mode';
  const shipModeLabel = el('label', {
    className: 'ed-menu-manager-check',
    attrs: { for: 'ed-menu-manager-ship-mode' },
  });
  shipModeLabel.append(shipModeToggle, document.createTextNode(' Ship mode'));
  shipModeToggle.addEventListener('change', () => {
    shipMode = shipModeToggle.checked;
    pushHaloBandWorld();
    if (shipMode) {
      haloBand?.setActiveTab('ship');
      syncHaloBandTabButtons('ship');
    }
  });
  halobandExtras.append(shipModeLabel);

  sidebar.append(statusEl, descEl, balanceNote, menuSection, halobandExtras);
  host.replaceChildren(previewHost);

  function syncMenuButtons(): void {
    for (const [id, button] of menuButtons) {
      button.classList.toggle('is-active', id === activeMenuId);
    }
    halobandExtras.classList.toggle('is-hidden', activeMenuId !== 'haloband');
  }

  function syncHaloBandTabButtons(activeTab: HaloBandTab): void {
    for (const button of tabButtons) {
      button.classList.toggle('is-active', button.dataset.tab === activeTab);
    }
  }

  function updateChrome(): void {
    const entry = findMenuCatalogEntry(activeMenuId);
    statusEl.textContent = entry ? `${entry.name} preview` : 'Menu preview';
    descEl.textContent = entry?.description ?? '';
    syncMenuButtons();
  }

  function pushHaloBandWorld(): void {
    if (!haloBand) return;
    haloBand.update({
      world: createMockWorld(shipMode),
      shipSurface: MOCK_SHIP_SURFACE,
      focusSurface: MOCK_SHIP_SURFACE,
      planet: {
        radiusMeters: 6_371_000,
        atmosphereHeightMeters: 110_000,
        terrainAmplitudeMeters: 8_000,
        gravityMetersPerSecond2: 9.8,
      },
    });
  }

  function disposePreview(): void {
    preview?.dispose();
    preview = null;
    haloBand = null;
    clearChildren(previewHost);
    clearShipWorld();
  }

  function mountHaloBand(): DisposablePreview {
    const elements = buildHaloBandDom('ed-haloband');
    previewHost.append(elements.rootEl);
    const controller = createHaloBand(
      elements,
      {
        onSendMessage: (text) => {
          controller.appendChatMessage('YOU', text);
          controller.appendChatMessage('SYS', 'Mock relay acknowledged.');
        },
        playerControls: { setInputSuppressed: () => undefined },
        getArcBalance: () => mockBalance,
        getInventory: () => mockInventory,
      },
      { preview: true },
    );
    haloBand = controller;
    pushHaloBandWorld();
    syncHaloBandTabButtons('home');
    return {
      dispose() {
        controller.dispose();
        haloBand = null;
      },
    };
  }

  function mountGameMenu(): DisposablePreview {
    const rootEl = clonePlayMenuTemplate('game-menu');
    previewHost.append(rootEl);
    const dummyChat = document.createElement('input');
    const controller: GameMenuController = createGameMenu(
      {
        rootEl,
        resumeBtnEl: requireOrig(rootEl, 'game-menu-resume-btn'),
        exitBtnEl: requireOrig(rootEl, 'game-menu-exit-btn'),
        chatInputEl: dummyChat,
        masterVolumeEl: requireOrig(rootEl, 'game-menu-master-volume'),
        sfxVolumeEl: requireOrig(rootEl, 'game-menu-sfx-volume'),
        musicVolumeEl: requireOrig(rootEl, 'game-menu-music-volume'),
        masterValueEl: requireOrig(rootEl, 'game-menu-master-value'),
        sfxValueEl: requireOrig(rootEl, 'game-menu-sfx-value'),
        musicValueEl: requireOrig(rootEl, 'game-menu-music-value'),
      },
      { onExitGame: () => undefined },
    );
    controller.open();
    return { dispose: () => controller.dispose() };
  }

  function mountPersonalInventory(): DisposablePreview {
    const rootEl = clonePlayMenuTemplate('personal-inventory');
    previewHost.append(rootEl);
    const controller = createPersonalInventory(
      {
        rootEl,
        searchEl: requireOrig(rootEl, 'personal-inventory-search'),
        sortEl: requireOrig(rootEl, 'personal-inventory-sort'),
        capacityFillEl: requireOrig(rootEl, 'personal-inventory-capacity-fill'),
        capacityLabelEl: requireOrig(rootEl, 'personal-inventory-capacity-label'),
        filtersEl: requireOrig(rootEl, 'personal-inventory-filters'),
        gridEl: requireOrig(rootEl, 'personal-inventory-grid'),
        weaponBarsEl: requireOrig(rootEl, 'personal-inventory-weapon-bars'),
        gearSlotsEl: requireOrig(rootEl, 'personal-inventory-gear-slots'),
        detailEl: requireOrig(rootEl, 'personal-inventory-detail'),
        avatarCanvasEl: requireOrig(rootEl, 'personal-inventory-avatar-canvas'),
        statusEl: requireOrig(rootEl, 'personal-inventory-status'),
        quickEquipBtnEl: requireOrig(rootEl, 'personal-inventory-quick-equip'),
        closeBtnEl: requireOrig(rootEl, 'personal-inventory-close'),
      },
      {
        playerControls: { setInputSuppressed: () => undefined },
        getInventory: () => mockInventory,
        onInventoryResult: (inventory) => {
          mockInventory = inventory;
        },
      },
    );
    controller.open();
    return { dispose: () => controller.dispose() };
  }

  function mountWeaponShop(): DisposablePreview {
    const rootEl = clonePlayMenuTemplate('weapon-shop');
    requireOrig(rootEl, 'weapon-shop-bezel').classList.add('is-flat-interactive', 'is-powered');
    previewHost.append(rootEl);
    const controller = createWeaponShop(
      {
        rootEl,
        bezelEl: requireOrig(rootEl, 'weapon-shop-bezel'),
        listEl: requireOrig(rootEl, 'weapon-shop-list'),
        statusEl: requireOrig(rootEl, 'weapon-shop-status'),
        balanceEl: requireOrig(rootEl, 'weapon-shop-balance'),
        closeBtnEl: requireOrig(rootEl, 'weapon-shop-close-btn'),
        powerBtnEl: requireOrig(rootEl, 'weapon-shop-power-btn'),
      },
      {
        getArcBalance: () => mockBalance,
        getInventory: () => mockInventory,
        onPurchaseResult: (result) => {
          mockBalance = result.arcBalance;
          mockInventory = result.inventory;
        },
      },
    );
    controller.open({ shop: MOCK_WEAPON_SHOP });
    return { dispose: () => controller.dispose() };
  }

  function mountFoodShop(): DisposablePreview {
    const rootEl = clonePlayMenuTemplate('food-shop');
    requireOrig(rootEl, 'food-shop-bezel').classList.add('is-flat-interactive', 'is-powered');
    previewHost.append(rootEl);
    const controller = createFoodShop(
      {
        rootEl,
        bezelEl: requireOrig(rootEl, 'food-shop-bezel'),
        titleEl: requireOrig(rootEl, 'food-shop-title'),
        kickerEl: requireOrig(rootEl, 'food-shop-kicker'),
        listEl: requireOrig(rootEl, 'food-shop-list'),
        statusEl: requireOrig(rootEl, 'food-shop-status'),
        balanceEl: requireOrig(rootEl, 'food-shop-balance'),
        closeBtnEl: requireOrig(rootEl, 'food-shop-close-btn'),
        powerBtnEl: requireOrig(rootEl, 'food-shop-power-btn'),
      },
      {
        getArcBalance: () => mockBalance,
        getInventory: () => mockInventory,
        onPurchaseResult: (result) => {
          mockBalance = result.arcBalance;
          mockInventory = result.inventory;
        },
      },
    );
    controller.open({ shop: MOCK_FOOD_SHOP });
    return { dispose: () => controller.dispose() };
  }

  function mountOutfitters(): DisposablePreview {
    const rootEl = clonePlayMenuTemplate('outfitters');
    requireOrig(rootEl, 'outfitters-bezel').classList.add('is-flat-interactive', 'is-powered');
    previewHost.append(rootEl);
    const controller = createOutfitters(
      {
        rootEl,
        bezelEl: requireOrig(rootEl, 'outfitters-bezel'),
        tabsEl: requireOrig(rootEl, 'outfitters-tabs'),
        listEl: requireOrig(rootEl, 'outfitters-list'),
        statusEl: requireOrig(rootEl, 'outfitters-status'),
        balanceEl: requireOrig(rootEl, 'outfitters-balance'),
        closeBtnEl: requireOrig(rootEl, 'outfitters-close-btn'),
        powerBtnEl: requireOrig(rootEl, 'outfitters-power-btn'),
      },
      {
        getArcBalance: () => mockBalance,
        getInventory: () => mockInventory,
        onPurchaseResult: (result) => {
          mockBalance = result.arcBalance;
          mockInventory = result.inventory;
        },
      },
    );
    controller.open({ shop: MOCK_OUTFITTERS });
    return { dispose: () => controller.dispose() };
  }

  function mountAvms(): DisposablePreview {
    const rootEl = clonePlayMenuTemplate('avms-terminal');
    previewHost.append(rootEl);
    const controller = createAvmsTerminal({
      rootEl,
      shipListEl: requireOrig(rootEl, 'avms-ship-list'),
      detailNameEl: requireOrig(rootEl, 'avms-detail-name'),
      detailPrefabEl: requireOrig(rootEl, 'avms-detail-prefab'),
      detailHpBarEl: requireOrig(rootEl, 'avms-detail-hp-bar'),
      detailShieldBarEl: requireOrig(rootEl, 'avms-detail-shield-bar'),
      detailHpValueEl: requireOrig(rootEl, 'avms-detail-hp-value'),
      detailShieldValueEl: requireOrig(rootEl, 'avms-detail-shield-value'),
      statusEl: requireOrig(rootEl, 'avms-status'),
      deliverBtnEl: requireOrig(rootEl, 'avms-deliver-btn'),
      storeBtnEl: requireOrig(rootEl, 'avms-store-btn'),
      closeBtnEl: requireOrig<HTMLButtonElement>(rootEl, 'avms-close-btn'),
      powerBtnEl: requireOrig<HTMLButtonElement>(rootEl, 'avms-power-btn'),
    });
    controller.open({
      ships: MOCK_AVMS_SHIPS,
      canStore: true,
      onDeliver: async () => undefined,
      onStore: async () => undefined,
    });
    return { dispose: () => controller.dispose() };
  }

  function mountBuildTerminal(): DisposablePreview {
    const rootEl = clonePlayMenuTemplate('build-terminal');
    rootEl.classList.add('is-open');
    rootEl.setAttribute('aria-hidden', 'false');
    requireOrig(rootEl, 'build-status').textContent =
      'Preview only — hangar build controller not mounted.';
    requireOrig(rootEl, 'build-prop-list').replaceChildren(
      el('p', {
        className: 'sc-avms-empty',
        text: 'Mock: open Build Mode in play to place props.',
      }),
    );
    previewHost.append(rootEl);
    return { dispose: () => undefined };
  }

  function mountEntertainment(): DisposablePreview {
    const rootEl = clonePlayMenuTemplate('entertainment-system');
    requireOrig(rootEl, 'es-bezel').classList.add('is-flat-interactive', 'is-powered');
    previewHost.append(rootEl);
    const controller = createEntertainmentSystem({
      rootEl,
      homeEl: requireOrig(rootEl, 'es-home'),
      docsEl: requireOrig(rootEl, 'es-docs'),
      youtubeEl: requireOrig(rootEl, 'es-youtube'),
      nasaEl: requireOrig(rootEl, 'es-nasa'),
      localnowEl: requireOrig(rootEl, 'es-localnow'),
      docsFrameEl: requireOrig(rootEl, 'es-docs-frame'),
      youtubeFrameEl: requireOrig(rootEl, 'es-youtube-frame'),
      nasaFrameEl: requireOrig(rootEl, 'es-nasa-frame'),
      youtubeUrlInputEl: requireOrig(rootEl, 'es-youtube-url'),
      youtubeGridEl: requireOrig(rootEl, 'es-youtube-grid'),
      powerBtnEl: requireOrig(rootEl, 'es-power-btn'),
      backBtnEl: requireOrig(rootEl, 'es-back-btn'),
      closeBtnEl: requireOrig(rootEl, 'es-close-btn'),
      docsTileEl: requireOrig(rootEl, 'es-docs-tile'),
      youtubeTileEl: requireOrig(rootEl, 'es-youtube-tile'),
      nasaTileEl: requireOrig(rootEl, 'es-nasa-tile'),
      localnowTileEl: requireOrig(rootEl, 'es-localnow-tile'),
      localnowOpenBtnEl: requireOrig(rootEl, 'es-localnow-open-btn'),
      youtubeLoadBtnEl: requireOrig(rootEl, 'es-youtube-load-btn'),
    });
    controller.open();
    return { dispose: () => controller.dispose() };
  }

  function mountActiveMenu(): void {
    disposePreview();
    mockInventory = createMockInventory();
    mockBalance = MOCK_ARC_BALANCE;
    switch (activeMenuId) {
      case 'haloband':
        preview = mountHaloBand();
        break;
      case 'game-menu':
        preview = mountGameMenu();
        break;
      case 'personal-inventory':
        preview = mountPersonalInventory();
        break;
      case 'weapon-shop':
        preview = mountWeaponShop();
        break;
      case 'food-shop':
        preview = mountFoodShop();
        break;
      case 'outfitters':
        preview = mountOutfitters();
        break;
      case 'avms':
        preview = mountAvms();
        break;
      case 'build-terminal':
        preview = mountBuildTerminal();
        break;
      case 'entertainment':
        preview = mountEntertainment();
        break;
      default:
        preview = mountHaloBand();
        break;
    }
    updateChrome();
  }

  function openMenu(id: string): boolean {
    const entry = findMenuCatalogEntry(id);
    if (!entry) return false;
    activeMenuId = entry.id as MenuPreviewId;
    if (active) mountActiveMenu();
    else updateChrome();
    return true;
  }

  return {
    activate() {
      if (active) return;
      active = true;
      mountActiveMenu();
    },
    deactivate() {
      if (!active) return;
      active = false;
      disposePreview();
    },
    canLeave() {
      return true;
    },
    isDirty() {
      return false;
    },
    async save() {
      return true;
    },
    openMenu,
    getActiveMenuId() {
      return activeMenuId;
    },
    getLeftPanel: () => sidebar,
  };
}
