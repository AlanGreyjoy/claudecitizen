import { createHud, createHaloBand } from '../render/effects';
import { createGameMenu } from '../render/effects/hud/game_menu';
import { createAvmsTerminal } from '../render/effects/hud/avms_terminal';
import { createEntertainmentSystem } from '../render/effects/hud/entertainment_system';
import { createWeaponShop } from '../render/effects/hud/weapon_shop';
import { createOutfitters } from '../render/effects/hud/outfitters';
import { createFoodShop } from '../render/effects/hud/food_shop';
import { createPersonalInventory } from '../render/effects/hud/personal_inventory';
import { collectHaloBandElements } from '../render/effects/hud/haloband_dom';
import type { HaloBandController } from '../render/effects/hud/haloband';
import { createWorldClient, type WorldClient } from '../net/world_client';
import type { GameBootstrap, AuthSession } from '../net/api';
import {
  normalizeInventoryState,
  type InventoryState,
} from '../player/inventory/types';
import type { createPlayerControls } from '../input/player_controls';
import type { createGameLoop } from '../game/create_game_loop';
import type { SpikeRenderer } from '../render/main';
import type { PlaySessionDom } from './play_session_dom';
import type { PlayerVitalsSessionController } from './player_vitals_session';
import { stopPlaySession } from './play_session';

export interface PlayOverlayEconomy {
  getArcBalance: () => number | null;
  getInventoryState: () => InventoryState | null;
  setArcBalance: (balance: number) => void;
  setInventoryState: (inventory: InventoryState) => void;
}

export interface PlayOverlayStack {
  hud: ReturnType<typeof createHud>;
  haloBand: HaloBandController;
  gameMenu: ReturnType<typeof createGameMenu>;
  avmsTerminal: ReturnType<typeof createAvmsTerminal>;
  entertainmentSystem: ReturnType<typeof createEntertainmentSystem>;
  weaponShop: ReturnType<typeof createWeaponShop>;
  outfitters: ReturnType<typeof createOutfitters>;
  foodShop: ReturnType<typeof createFoodShop>;
  personalInventory: ReturnType<typeof createPersonalInventory>;
  networkClient: WorldClient | null;
  economy: PlayOverlayEconomy;
}

export async function createPlayOverlayStack(options: {
  dom: PlaySessionDom;
  bootstrap: GameBootstrap | null;
  session: AuthSession | null;
  controls: ReturnType<typeof createPlayerControls>;
  renderer: SpikeRenderer | null;
  loopRef: { loop?: ReturnType<typeof createGameLoop> };
  vitalsSessionRef: { current: PlayerVitalsSessionController | null };
  characterAppearance: GameBootstrap['player']['characterAppearance'] | null;
}): Promise<PlayOverlayStack> {
  const {
    dom,
    bootstrap,
    controls,
    loopRef,
    vitalsSessionRef,
    characterAppearance,
  } = options;

  let networkClient: WorldClient | null = null;
  let arcBalance: number | null = bootstrap ? bootstrap.economy.arcBalance : null;
  let inventoryState: InventoryState | null = bootstrap
    ? normalizeInventoryState(bootstrap.inventory)
    : null;
  let haloBand: HaloBandController | null = null;

  const hud = createHud(
    {
      fpsEl: dom.fpsEl,
      chatMessagesEl: dom.chatMessagesEl,
      chatInputEl: dom.chatInputEl,
      debugBtnEl: dom.debugBtnEl,
      debugMenuEl: dom.debugMenuEl,
      statsPanelEl: dom.statsPanelEl,
      tutorialBannerEl: dom.tutorialBannerEl,
      promptEl: dom.promptEl,
      readoutsEl: dom.readoutsEl,
      statusEl: dom.statusEl,
      controlsEl: dom.controlsEl,
      interactPromptEl: dom.interactPromptEl,
      flightReticleEl: dom.flightReticleEl,
      weaponCrosshairEl: dom.weaponCrosshairEl,
      combatAmmoEl: dom.combatAmmoEl,
      cockpitGazeEl: dom.cockpitGazeEl,
      cockpitSpeedEl: dom.cockpitSpeedEl,
      survivalVitalsEl: dom.survivalVitalsEl,
      vitalsSyncWarningEl: dom.vitalsSyncWarningEl,
      screenFadeEl: dom.screenFadeEl,
    },
    {
      onChatSend: (text) => networkClient?.sendChat(text),
      onTimeOverrideChange: (mode) => options.renderer?.setTimeOverride(mode),
      onSsaoSettingsChange: (settings) => options.renderer?.setSsaoSettings(settings),
      onVegetationLayersChange: (layers) => options.renderer?.setVegetationLayers(layers),
    },
  );

  if (bootstrap) {
    networkClient = createWorldClient({
      bootstrap,
      onChatMessage: (message) => {
        hud.appendChatMessage(message.author, message.text);
        haloBand?.appendChatMessage(message.author, message.text);
      },
      onStatus: (status) => hud.appendChatMessage('NET', status),
    });
    try {
      await networkClient.connect();
    } catch (error) {
      console.warn('ClaudeCitizen world socket failed to connect.', error);
      hud.appendChatMessage('NET', 'Relay unavailable. Continuing local simulation.');
      networkClient = null;
    }
  } else {
    hud.appendChatMessage('SYS', 'Offline dev session.');
  }

  haloBand = createHaloBand(
    collectHaloBandElements(dom.halobandEl),
    {
      onSendMessage: (text) => networkClient?.sendChat(text),
      playerControls: controls,
      getArcBalance: () => arcBalance,
      getInventory: () => inventoryState,
    },
  );

  const gameMenu = createGameMenu(
    {
      rootEl: dom.gameMenuEl,
      resumeBtnEl: dom.gameMenuResumeBtn,
      exitBtnEl: dom.gameMenuExitBtn,
      chatInputEl: dom.chatInputEl,
      masterVolumeEl: dom.gameMenuMasterVolume,
      sfxVolumeEl: dom.gameMenuSfxVolume,
      musicVolumeEl: dom.gameMenuMusicVolume,
      masterValueEl: dom.gameMenuMasterValue,
      sfxValueEl: dom.gameMenuSfxValue,
      musicValueEl: dom.gameMenuMusicValue,
    },
    { onExitGame: () => stopPlaySession() },
  );

  const avmsTerminal = createAvmsTerminal({
    rootEl: dom.avmsTerminalEl,
    shipListEl: dom.avmsShipListEl,
    detailNameEl: dom.avmsDetailNameEl,
    detailPrefabEl: dom.avmsDetailPrefabEl,
    detailHpBarEl: dom.avmsDetailHpBarEl,
    detailShieldBarEl: dom.avmsDetailShieldBarEl,
    detailHpValueEl: dom.avmsDetailHpValueEl,
    detailShieldValueEl: dom.avmsDetailShieldValueEl,
    statusEl: dom.avmsStatusEl,
    deliverBtnEl: dom.avmsDeliverBtn,
    storeBtnEl: dom.avmsStoreBtn,
    closeBtnEl: dom.avmsCloseBtn,
    powerBtnEl: dom.avmsPowerBtn,
  });

  const entertainmentSystem = createEntertainmentSystem({
    rootEl: requireElement('entertainment-system'),
    homeEl: requireElement('es-home'),
    docsEl: requireElement('es-docs'),
    youtubeEl: requireElement('es-youtube'),
    nasaEl: requireElement('es-nasa'),
    localnowEl: requireElement('es-localnow'),
    docsFrameEl: requireElement<HTMLIFrameElement>('es-docs-frame'),
    youtubeFrameEl: requireElement<HTMLIFrameElement>('es-youtube-frame'),
    nasaFrameEl: requireElement<HTMLIFrameElement>('es-nasa-frame'),
    youtubeUrlInputEl: requireElement<HTMLInputElement>('es-youtube-url'),
    youtubeGridEl: requireElement('es-youtube-grid'),
    powerBtnEl: requireElement<HTMLButtonElement>('es-power-btn'),
    backBtnEl: requireElement<HTMLButtonElement>('es-back-btn'),
    closeBtnEl: requireElement<HTMLButtonElement>('es-close-btn'),
    docsTileEl: requireElement<HTMLButtonElement>('es-docs-tile'),
    youtubeTileEl: requireElement<HTMLButtonElement>('es-youtube-tile'),
    nasaTileEl: requireElement<HTMLButtonElement>('es-nasa-tile'),
    localnowTileEl: requireElement<HTMLButtonElement>('es-localnow-tile'),
    localnowOpenBtnEl: requireElement<HTMLButtonElement>('es-localnow-open-btn'),
    youtubeLoadBtnEl: requireElement<HTMLButtonElement>('es-youtube-load-btn'),
  });

  const onPurchaseResult = (result: { arcBalance: number; inventory: unknown }) => {
    arcBalance = result.arcBalance;
    inventoryState = normalizeInventoryState(result.inventory);
    personalInventory.refresh();
  };

  const personalInventory = createPersonalInventory(
    {
      rootEl: requireElement('personal-inventory'),
      searchEl: requireElement<HTMLInputElement>('personal-inventory-search'),
      sortEl: requireElement<HTMLSelectElement>('personal-inventory-sort'),
      capacityFillEl: requireElement('personal-inventory-capacity-fill'),
      capacityLabelEl: requireElement('personal-inventory-capacity-label'),
      filtersEl: requireElement('personal-inventory-filters'),
      gridEl: requireElement('personal-inventory-grid'),
      weaponBarsEl: requireElement('personal-inventory-weapon-bars'),
      gearSlotsEl: requireElement('personal-inventory-gear-slots'),
      detailEl: requireElement('personal-inventory-detail'),
      avatarCanvasEl: requireElement<HTMLCanvasElement>('personal-inventory-avatar-canvas'),
      statusEl: requireElement('personal-inventory-status'),
      quickEquipBtnEl: requireElement<HTMLButtonElement>('personal-inventory-quick-equip'),
      closeBtnEl: requireElement<HTMLButtonElement>('personal-inventory-close'),
    },
    {
      playerControls: controls,
      getInventory: () => inventoryState,
      characterAppearance,
      onInventoryResult: (inventory) => {
        inventoryState = normalizeInventoryState(inventory);
        personalInventory.refresh();
        loopRef.loop?.setEquippedLoadout(inventoryState.loadout);
      },
      onConsumeResult: (result) => {
        inventoryState = normalizeInventoryState(result.inventory);
        personalInventory.refresh();
        vitalsSessionRef.current?.applyAuthoritativeVitals(result.vitals);
      },
    },
  );

  const weaponShop = createWeaponShop(
    {
      rootEl: requireElement('weapon-shop'),
      bezelEl: requireElement('weapon-shop-bezel'),
      listEl: requireElement('weapon-shop-list'),
      statusEl: requireElement('weapon-shop-status'),
      balanceEl: requireElement('weapon-shop-balance'),
      closeBtnEl: requireElement<HTMLButtonElement>('weapon-shop-close-btn'),
      powerBtnEl: requireElement<HTMLButtonElement>('weapon-shop-power-btn'),
    },
    { getArcBalance: () => arcBalance, getInventory: () => inventoryState, onPurchaseResult },
  );

  const outfitters = createOutfitters(
    {
      rootEl: requireElement('outfitters'),
      bezelEl: requireElement('outfitters-bezel'),
      tabsEl: requireElement('outfitters-tabs'),
      listEl: requireElement('outfitters-list'),
      statusEl: requireElement('outfitters-status'),
      balanceEl: requireElement('outfitters-balance'),
      closeBtnEl: requireElement<HTMLButtonElement>('outfitters-close-btn'),
      powerBtnEl: requireElement<HTMLButtonElement>('outfitters-power-btn'),
    },
    { getArcBalance: () => arcBalance, getInventory: () => inventoryState, onPurchaseResult },
  );

  const foodShop = createFoodShop(
    {
      rootEl: requireElement('food-shop'),
      bezelEl: requireElement('food-shop-bezel'),
      titleEl: requireElement('food-shop-title'),
      kickerEl: requireElement('food-shop-kicker'),
      listEl: requireElement('food-shop-list'),
      statusEl: requireElement('food-shop-status'),
      balanceEl: requireElement('food-shop-balance'),
      closeBtnEl: requireElement<HTMLButtonElement>('food-shop-close-btn'),
      powerBtnEl: requireElement<HTMLButtonElement>('food-shop-power-btn'),
    },
    { getArcBalance: () => arcBalance, getInventory: () => inventoryState, onPurchaseResult },
  );

  return {
    hud,
    haloBand,
    gameMenu,
    avmsTerminal,
    entertainmentSystem,
    weaponShop,
    outfitters,
    foodShop,
    personalInventory,
    networkClient,
    economy: {
      getArcBalance: () => arcBalance,
      getInventoryState: () => inventoryState,
      setArcBalance: (balance) => { arcBalance = balance; },
      setInventoryState: (inventory) => { inventoryState = inventory; },
    },
  };
}

function requireElement<T extends HTMLElement>(id: string): T {
  const element = document.getElementById(id);
  if (!element) throw new Error(`Missing required element #${id}`);
  return element as T;
}
