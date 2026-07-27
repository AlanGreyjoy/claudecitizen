import { createHud, createHaloBand } from '../render/effects';
import { createGameMenu } from '../render/effects/hud/game-menu';
import { createAvmsTerminal } from '../render/effects/hud/avms-terminal';
import { createEntertainmentSystem } from '../render/effects/hud/entertainment-system';
import { createWeaponShop } from '../render/effects/hud/weapon-shop';
import { createOutfitters } from '../render/effects/hud/outfitters';
import { createFoodShop } from '../render/effects/hud/food-shop';
import { createPersonalInventory } from '../render/effects/hud/personal-inventory';
import { collectHaloBandElements } from '../render/effects/hud/haloband-dom';
import { createWorldClient, type WorldClient } from '../net/world-client';
import type { GameBootstrap } from '../net/api';
import {
  createCheckoutSession,
  fetchCreditPacks,
  fetchCreditPurchases,
  fetchMall,
  purchaseMallItem,
} from '../net/api';
import {
  normalizeInventoryState,
  type InventoryState,
} from '../player/inventory/types';
import {
  normalizeCreditPack,
  normalizeMallState,
  type CreditPack,
} from '../player/mall/types';
import { openExternalUrl } from '../platform/editor-desktop';
import type {
  HaloBandController,
  HaloBandMallCallbacks,
  HaloBandMallSnapshot,
} from '../render/effects/hud/haloband';
import type { createPlayerControls } from '../input/player-controls';
import type { createGameLoop } from '../game/create-game-loop';
import type { SpikeRenderer } from '../render/main';
import type { PlaySessionDom } from './play-session-dom';
import type { PlayerVitalsSessionController } from './player-vitals-session';
import { stopPlaySession } from './play-session';

export function requireElement<T extends HTMLElement>(id: string): T {
  const element = document.getElementById(id);
  if (!element) throw new Error(`Missing required element #${id}`);
  return element as T;
}

export function createPlayHud(
  dom: PlaySessionDom,
  getNetworkClient: () => WorldClient | null,
  renderer: SpikeRenderer | null,
): ReturnType<typeof createHud> {
  return createHud(
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
      onChatSend: (text) => getNetworkClient()?.sendChat(text),
      onTimeOverrideChange: (mode) => renderer?.setTimeOverride(mode),
      onSsaoSettingsChange: (settings) => renderer?.setSsaoSettings(settings),
      onVegetationLayersChange: (layers) => renderer?.setVegetationLayers(layers),
    },
  );
}

export async function connectPlayNetwork(
  bootstrap: GameBootstrap | null,
  hud: ReturnType<typeof createHud>,
  getHaloBand: () => HaloBandController | null,
): Promise<WorldClient | null> {
  if (!bootstrap) {
    hud.appendChatMessage('SYS', 'Offline dev session.');
    return null;
  }
  const networkClient = createWorldClient({
    bootstrap,
    onChatMessage: (message) => {
      hud.appendChatMessage(message.author, message.text);
      getHaloBand()?.appendChatMessage(message.author, message.text);
    },
    onStatus: (status) => hud.appendChatMessage('NET', status),
  });
  try {
    await networkClient.connect();
    return networkClient;
  } catch (error) {
    console.warn('ClaudeCitizen world socket failed to connect.', error);
    hud.appendChatMessage('NET', 'Relay unavailable. Continuing local simulation.');
    return null;
  }
}

export function createPlayHaloBand(
  dom: PlaySessionDom,
  controls: ReturnType<typeof createPlayerControls>,
  getNetworkClient: () => WorldClient | null,
  getArcBalance: () => number | null,
  getInventory: () => InventoryState | null,
  mall?: HaloBandMallCallbacks,
): HaloBandController {
  return createHaloBand(
    collectHaloBandElements(dom.halobandEl),
    {
      onSendMessage: (text) => getNetworkClient()?.sendChat(text),
      playerControls: controls,
      getArcBalance,
      getInventory,
      mall,
    },
  );
}

/**
 * Wires the HaloBand Mall tab to the backend.
 *
 * Credits are granted server-side by the Stripe webhook, so `startCheckout` only hands the
 * player off to the browser — it never adjusts the balance itself.
 */
export function createPlayMallCallbacks(options: {
  getCreditBalance: () => number;
  setCreditBalance: (balance: number) => void;
  getInventory: () => InventoryState | null;
  onInventoryChanged: (inventory: unknown) => void;
}): HaloBandMallCallbacks {
  return {
    fetchMall: async (): Promise<HaloBandMallSnapshot> => {
      const [mall, packsResponse] = await Promise.all([fetchMall(), fetchCreditPacks()]);
      const state = normalizeMallState(mall);
      options.setCreditBalance(state.creditBalance);
      const packs = packsResponse.packs
        .map(normalizeCreditPack)
        .filter((pack): pack is CreditPack => pack !== null);
      return {
        listings: state.listings,
        packs,
        creditBalance: state.creditBalance,
        checkoutEnabled: packsResponse.checkoutEnabled,
      };
    },
    purchaseListing: async (listingId, quantity) => {
      const result = await purchaseMallItem(listingId, quantity);
      options.setCreditBalance(result.creditBalance);
      options.onInventoryChanged(result.inventory);
      return result.creditBalance;
    },
    startCheckout: async (packId) => {
      const session = await createCheckoutSession(packId);
      return openExternalUrl(session.url);
    },
    fetchPurchases: async () => {
      const result = await fetchCreditPurchases();
      options.setCreditBalance(result.creditBalance);
      return { creditBalance: result.creditBalance };
    },
    getOwnedQuantity: (itemDefinitionId) => {
      const inventory = options.getInventory();
      if (!inventory) return 0;
      const stack = inventory.items.find((item) => item.itemDefinitionId === itemDefinitionId);
      return stack?.quantity ?? 0;
    },
  };
}

export function createPlayGameMenu(dom: PlaySessionDom): ReturnType<typeof createGameMenu> {
  return createGameMenu(
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
}

export function createPlayAvmsTerminal(dom: PlaySessionDom): ReturnType<typeof createAvmsTerminal> {
  return createAvmsTerminal({
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
}

export function createPlayEntertainmentSystem(): ReturnType<typeof createEntertainmentSystem> {
  return createEntertainmentSystem({
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
}

export function createPlayPersonalInventory(options: {
  controls: ReturnType<typeof createPlayerControls>;
  getInventory: () => InventoryState | null;
  setInventory: (inventory: InventoryState) => void;
  characterAppearance: GameBootstrap['player']['characterAppearance'] | null;
  loopRef: { loop?: ReturnType<typeof createGameLoop> };
  vitalsSessionRef: { current: PlayerVitalsSessionController | null };
}): ReturnType<typeof createPersonalInventory> {
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
      playerControls: options.controls,
      getInventory: options.getInventory,
      characterAppearance: options.characterAppearance,
      onInventoryResult: (inventory) => {
        const next = normalizeInventoryState(inventory);
        options.setInventory(next);
        personalInventory.refresh();
        options.loopRef.loop?.setEquippedLoadout(next.loadout);
      },
      onConsumeResult: (result) => {
        options.setInventory(normalizeInventoryState(result.inventory));
        personalInventory.refresh();
        options.vitalsSessionRef.current?.applyAuthoritativeVitals(result.vitals);
      },
    },
  );
  return personalInventory;
}

export function createPlayShops(options: {
  getArcBalance: () => number | null;
  getInventory: () => InventoryState | null;
  onPurchaseResult: (result: { arcBalance: number; inventory: unknown }) => void;
}): {
  weaponShop: ReturnType<typeof createWeaponShop>;
  outfitters: ReturnType<typeof createOutfitters>;
  foodShop: ReturnType<typeof createFoodShop>;
} {
  const shopEconomy = {
    getArcBalance: options.getArcBalance,
    getInventory: options.getInventory,
    onPurchaseResult: options.onPurchaseResult,
  };
  return {
    weaponShop: createWeaponShop(
      {
        rootEl: requireElement('weapon-shop'),
        bezelEl: requireElement('weapon-shop-bezel'),
        listEl: requireElement('weapon-shop-list'),
        statusEl: requireElement('weapon-shop-status'),
        balanceEl: requireElement('weapon-shop-balance'),
        closeBtnEl: requireElement<HTMLButtonElement>('weapon-shop-close-btn'),
        powerBtnEl: requireElement<HTMLButtonElement>('weapon-shop-power-btn'),
      },
      shopEconomy,
    ),
    outfitters: createOutfitters(
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
      shopEconomy,
    ),
    foodShop: createFoodShop(
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
      shopEconomy,
    ),
  };
}
