/**
 * Menu Manager preview mounting — imperative HUD controllers on a DOM host.
 * Used by the React MenuManagerPanel; preview-only (no save).
 */
import { el } from '../dom';
import { createFlightBody } from '../../flight/flight-body';
import { createShipInstance } from '../../flight/ship-instance';
import { clearShipWorld, registerShipInstance } from '../../flight/ship-world';
import { createQuantumTravelState } from '../../flight/quantum-travel';
import { vec3 } from '../../math/vec3';
import { createCharacterState } from '../../player/character-controller';
import { MODE_IN_SHIP, MODE_IN_STATION } from '../../player/modes';
import { DEFAULT_SHIP_LAYOUT } from '../../player/ship-layout';
import {
  PLAYER_SHIP_INSTANCE_ID,
  type WorldState,
} from '../../player/world-state';
import { createPlayerVitals } from '../../player/vitals';
import { createAvmsTerminal } from '../../render/effects/hud/avms-terminal';
import { createEntertainmentSystem } from '../../render/effects/hud/entertainment-system';
import {
  createGameMenu,
  type GameMenuController,
} from '../../render/effects/hud/game-menu';
import {
  createHaloBand,
  type HaloBandController,
  type HaloBandTab,
} from '../../render/effects/hud/haloband';
import { buildHaloBandDom } from '../../render/effects/hud/haloband-dom';
import { createOutfitters } from '../../render/effects/hud/outfitters';
import { createPersonalInventory } from '../../render/effects/hud/personal-inventory';
import { createWeaponShop } from '../../render/effects/hud/weapon-shop';
import { createFoodShop } from '../../render/effects/hud/food-shop';
import type { PlanetSurfaceSample } from '../../types';
import { DEFAULT_SHIP_PREFAB_ID } from '../../world/ships';
import type { MenuPreviewId } from '../menus/catalog';
import { clonePlayMenuTemplate, requireOrig } from '../menus/clone-template';
import {
  createMockInventory,
  MOCK_ARC_BALANCE,
  MOCK_AVMS_SHIPS,
  MOCK_FOOD_SHOP,
  MOCK_OUTFITTERS,
  MOCK_WEAPON_SHOP,
} from '../menus/mocks';
import type { InventoryState } from '../../player/inventory/types';

export const MOCK_SHIP_SURFACE: PlanetSurfaceSample = {
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

export const HALOBAND_TABS: Array<{ id: HaloBandTab; label: string }> = [
  { id: 'home', label: 'Home' },
  { id: 'comms', label: 'Comms' },
  { id: 'missions', label: 'Missions' },
  { id: 'map', label: 'Map' },
  { id: 'inventory', label: 'Inventory' },
  { id: 'ship', label: 'Ship Status' },
];

export interface MenuPreviewContext {
  getArcBalance: () => number;
  setArcBalance: (balance: number) => void;
  getInventory: () => InventoryState;
  setInventory: (inventory: InventoryState) => void;
}

export interface MountedMenuPreview {
  dispose: () => void;
  haloBand: HaloBandController | null;
}

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
    ladderClimb: null,
    screenFade: 0,
    flightMode: 'traverse',
    quantum: createQuantumTravelState(),
    systemId: 'default',
    activeStationInstanceId: null,
    vitals: createPlayerVitals(),
    vitalsSyncLocked: false,
  };
}

export function pushHaloBandWorld(
  haloBand: HaloBandController,
  shipMode: boolean,
): void {
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

function mountHaloBand(
  previewHost: HTMLElement,
  ctx: MenuPreviewContext,
  shipMode: boolean,
): MountedMenuPreview {
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
      getArcBalance: () => ctx.getArcBalance(),
      getInventory: () => ctx.getInventory(),
    },
    { preview: true },
  );
  pushHaloBandWorld(controller, shipMode);
  controller.setActiveTab('home');
  return {
    haloBand: controller,
    dispose() {
      controller.dispose();
    },
  };
}

function mountGameMenu(previewHost: HTMLElement): MountedMenuPreview {
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
  return { haloBand: null, dispose: () => controller.dispose() };
}

function mountPersonalInventory(
  previewHost: HTMLElement,
  ctx: MenuPreviewContext,
): MountedMenuPreview {
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
      getInventory: () => ctx.getInventory(),
      onInventoryResult: (inventory) => {
        ctx.setInventory(inventory);
      },
    },
  );
  controller.open();
  return { haloBand: null, dispose: () => controller.dispose() };
}

function mountWeaponShop(
  previewHost: HTMLElement,
  ctx: MenuPreviewContext,
): MountedMenuPreview {
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
      getArcBalance: () => ctx.getArcBalance(),
      getInventory: () => ctx.getInventory(),
      onPurchaseResult: (result) => {
        ctx.setArcBalance(result.arcBalance);
        ctx.setInventory(result.inventory);
      },
    },
  );
  controller.open({ shop: MOCK_WEAPON_SHOP });
  return { haloBand: null, dispose: () => controller.dispose() };
}

function mountFoodShop(
  previewHost: HTMLElement,
  ctx: MenuPreviewContext,
): MountedMenuPreview {
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
      getArcBalance: () => ctx.getArcBalance(),
      getInventory: () => ctx.getInventory(),
      onPurchaseResult: (result) => {
        ctx.setArcBalance(result.arcBalance);
        ctx.setInventory(result.inventory);
      },
    },
  );
  controller.open({ shop: MOCK_FOOD_SHOP });
  return { haloBand: null, dispose: () => controller.dispose() };
}

function mountOutfitters(
  previewHost: HTMLElement,
  ctx: MenuPreviewContext,
): MountedMenuPreview {
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
      getArcBalance: () => ctx.getArcBalance(),
      getInventory: () => ctx.getInventory(),
      onPurchaseResult: (result) => {
        ctx.setArcBalance(result.arcBalance);
        ctx.setInventory(result.inventory);
      },
    },
  );
  controller.open({ shop: MOCK_OUTFITTERS });
  return { haloBand: null, dispose: () => controller.dispose() };
}

function mountAvms(previewHost: HTMLElement): MountedMenuPreview {
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
  return { haloBand: null, dispose: () => controller.dispose() };
}

function mountBuildTerminal(previewHost: HTMLElement): MountedMenuPreview {
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
  return { haloBand: null, dispose: () => undefined };
}

function mountEntertainment(previewHost: HTMLElement): MountedMenuPreview {
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
  return { haloBand: null, dispose: () => controller.dispose() };
}

export function createFreshMenuPreviewContext(): MenuPreviewContext {
  let mockInventory = createMockInventory();
  let mockBalance = MOCK_ARC_BALANCE;
  return {
    getArcBalance: () => mockBalance,
    setArcBalance: (balance) => {
      mockBalance = balance;
    },
    getInventory: () => mockInventory,
    setInventory: (inventory) => {
      mockInventory = inventory;
    },
  };
}

export function mountMenuPreview(
  previewHost: HTMLElement,
  menuId: MenuPreviewId,
  ctx: MenuPreviewContext,
  shipMode: boolean,
): MountedMenuPreview {
  previewHost.replaceChildren();
  switch (menuId) {
    case 'haloband':
      return mountHaloBand(previewHost, ctx, shipMode);
    case 'game-menu':
      return mountGameMenu(previewHost);
    case 'personal-inventory':
      return mountPersonalInventory(previewHost, ctx);
    case 'weapon-shop':
      return mountWeaponShop(previewHost, ctx);
    case 'food-shop':
      return mountFoodShop(previewHost, ctx);
    case 'outfitters':
      return mountOutfitters(previewHost, ctx);
    case 'avms':
      return mountAvms(previewHost);
    case 'build-terminal':
      return mountBuildTerminal(previewHost);
    case 'entertainment':
      return mountEntertainment(previewHost);
    default:
      return mountHaloBand(previewHost, ctx, shipMode);
  }
}

export function disposeMenuPreviewHost(previewHost: HTMLElement): void {
  previewHost.replaceChildren();
  clearShipWorld();
}
