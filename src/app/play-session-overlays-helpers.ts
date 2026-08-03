import { createHud, createHaloBand } from '../render/effects';
import { createGameMenu } from '../render/effects/hud/game-menu';
import { createAvmsTerminal } from '../render/effects/hud/avms-terminal';
import { createEntertainmentSystem } from '../render/effects/hud/entertainment-system';
import { createWeaponShop } from '../render/effects/hud/weapon-shop';
import { createOutfitters } from '../render/effects/hud/outfitters';
import { createFoodShop } from '../render/effects/hud/food-shop';
import { createPersonalInventory } from '../render/effects/hud/personal-inventory';
import { createChestStorage } from '../render/effects/hud/chest-storage';
import { collectHaloBandElements } from '../render/effects/hud/haloband-dom';
import { createWorldClient, type WorldClient } from '../net/world-client';
import type { SceneDocument } from '../world/scenes/schema';
import { resolveScenePlayConfig } from '../world/scenes/scene-runtime';
import type { GameBootstrap } from '../net/api';
import {
  createCheckoutSession,
  fetchCreditPacks,
  fetchCreditPurchases,
  fetchMall,
  purchaseMallItem,
} from '../net/api';
import { isEditorOfflineBootstrap } from './editor-play-bootstrap';
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
import type { SceneExitTarget } from '../game/station/scene-exit';

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
      readoutsCopyBtn: dom.readoutsCopyBtn,
      statusEl: dom.statusEl,
      controlsEl: dom.controlsEl,
      interactPromptEl: dom.interactPromptEl,
      flightReticleEl: dom.flightReticleEl,
      navMarkersEl: dom.navMarkersEl,
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
      onVegetationLayersChange: (layers) => {
        renderer?.setVegetationLayers(layers);
        // Pipelines are warmed once at spawn, over what was visible then.
        // Switching a layer back on introduces material variants that were
        // never in view for that sweep, so without this the driver compiles
        // them synchronously the first time each direction is looked at.
        void renderer?.warmRenderPipelines();
      },
    },
  );
}

/**
 * The cell a *fresh session* lands in, when no `scene-exit` handed one over.
 *
 * This is the game-manager's call — where a player begins after logging in —
 * and it is the only place other than a `scene-exit` that may choose a cell.
 * Once in world, movement between places is `scene-exit` and nothing else; two
 * mechanisms racing to pick a cell is how a player ends up rendering one place
 * while being simulated in another.
 *
 * Scope comes from `instanced-scene`. A missing scope on `kind: "instance"`
 * keeps the historical shared behaviour so older shared interiors still meet.
 */
export function loginInstanceForScene(
  scene: SceneDocument | null,
  bootstrap: GameBootstrap | null,
): SceneExitTarget | null {
  if (!scene || scene.kind !== 'instance') return null;
  const scope = resolveScenePlayConfig(scene).instanceScope;
  if (scope === 'party') return null;
  // A per-player scene is the player's own hab: the ticket usually already
  // says so, but a player who logged out elsewhere would otherwise resume in
  // the cell they left rather than the one this scene depicts.
  if (scope === 'player') {
    if (isEditorOfflineBootstrap(bootstrap)) return null;
    const apartment = bootstrap?.spawn.apartmentInstanceId;
    return apartment
      ? { sceneId: scene.id, instanceId: apartment, roomId: 'hab-room', arrival: 'default' }
      : null;
  }
  return { sceneId: scene.id, instanceId: `scene:${scene.id}`, roomId: '', arrival: 'default' };
}

export async function connectPlayNetwork(
  bootstrap: GameBootstrap | null,
  hud: ReturnType<typeof createHud>,
  getHaloBand: () => HaloBandController | null,
  scene: SceneDocument | null = null,
  networkTarget: SceneExitTarget | null = null,
): Promise<WorldClient | null> {
  // Editor offline bootstrap exists only to wire Build Mode — not to join cells.
  if (!bootstrap || isEditorOfflineBootstrap(bootstrap)) {
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
    // An explicit scene-exit target always wins: it is what the player just
    // walked or flew through. The scene's own scope only decides a fresh login.
    const target = networkTarget ?? loginInstanceForScene(scene, bootstrap);
    if (target?.instanceId) networkClient.transition(target.instanceId, target.roomId);
    return networkClient;
  } catch (error) {
    // Spelled into the message rather than passed as an argument: a debug
    // window forwards console output as text, where an Error argument collapses
    // to `[object WebTransportError]`.
    console.warn(
      `ClaudeCitizen world socket failed to connect. ${
        error instanceof Error ? `${error.name}: ${error.message}` : String(error)
      }`,
    );
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

export function createPlayGameMenu(
  dom: PlaySessionDom,
  options: { onExitToTitle?: () => void } = {},
): ReturnType<typeof createGameMenu> {
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
    {
      // Prefer scene-host boot reload. Bare stopPlaySession() only unhides the
      // static #title-screen HTML (Play button) and never remounts the title scene.
      onExitGame: () => {
        if (options.onExitToTitle) {
          options.onExitToTitle();
          return;
        }
        stopPlaySession();
      },
    },
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
    hangarBtnEl: dom.avmsHangarBtn,
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
  onWillOpen?: () => void;
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
      onWillOpen: options.onWillOpen,
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

export function createPlayChestStorage(options: {
  controls: ReturnType<typeof createPlayerControls>;
  getInventory: () => InventoryState | null;
  setInventory: (inventory: InventoryState) => void;
  loopRef: { loop?: ReturnType<typeof createGameLoop> };
  onWillOpen?: () => void;
}): ReturnType<typeof createChestStorage> {
  const chestStorage = createChestStorage(
    {
      rootEl: requireElement('chest-storage'),
      titleEl: requireElement('chest-storage-title'),
      inventoryListEl: requireElement('chest-storage-inventory-list'),
      chestListEl: requireElement('chest-storage-chest-list'),
      capacityEl: requireElement('chest-storage-capacity'),
      statusEl: requireElement('chest-storage-status'),
      closeBtnEl: requireElement<HTMLButtonElement>('chest-storage-close'),
    },
    {
      playerControls: options.controls,
      getInventory: options.getInventory,
      onWillOpen: options.onWillOpen,
      onInventoryResult: (inventory) => {
        const next = normalizeInventoryState(inventory);
        options.setInventory(next);
        chestStorage.refresh();
        options.loopRef.loop?.setEquippedLoadout(next.loadout);
      },
    },
  );
  return chestStorage;
}

/** Personal inventory + shops + chest, with mutual-close wiring. */
export function createPlayInventoryOverlayBundle(options: {
  controls: ReturnType<typeof createPlayerControls>;
  getInventory: () => InventoryState | null;
  setInventory: (inventory: InventoryState) => void;
  getArcBalance: () => number | null;
  setArcBalance: (balance: number) => void;
  characterAppearance: GameBootstrap['player']['characterAppearance'] | null;
  loopRef: { loop?: ReturnType<typeof createGameLoop> };
  vitalsSessionRef: { current: PlayerVitalsSessionController | null };
}): {
  personalInventory: ReturnType<typeof createPlayPersonalInventory>;
  chestStorage: ReturnType<typeof createPlayChestStorage>;
  weaponShop: ReturnType<typeof createPlayShops>['weaponShop'];
  outfitters: ReturnType<typeof createPlayShops>['outfitters'];
  foodShop: ReturnType<typeof createPlayShops>['foodShop'];
} {
  const closers = {
    weaponShop: null as ReturnType<typeof createPlayShops>['weaponShop'] | null,
    outfitters: null as ReturnType<typeof createPlayShops>['outfitters'] | null,
    foodShop: null as ReturnType<typeof createPlayShops>['foodShop'] | null,
    chestStorage: null as ReturnType<typeof createPlayChestStorage> | null,
  };
  const personalInventory = createPlayPersonalInventory({
    controls: options.controls,
    getInventory: options.getInventory,
    setInventory: options.setInventory,
    characterAppearance: options.characterAppearance,
    loopRef: options.loopRef,
    vitalsSessionRef: options.vitalsSessionRef,
    onWillOpen: () => {
      closers.chestStorage?.close();
      closers.weaponShop?.close();
      closers.outfitters?.close();
      closers.foodShop?.close();
    },
  });
  const { weaponShop, outfitters, foodShop } = createPlayShops({
    getArcBalance: options.getArcBalance,
    getInventory: options.getInventory,
    onPurchaseResult: (result) => {
      options.setArcBalance(result.arcBalance);
      options.setInventory(normalizeInventoryState(result.inventory));
      personalInventory.refresh();
      closers.chestStorage?.refresh();
    },
  });
  closers.weaponShop = weaponShop;
  closers.outfitters = outfitters;
  closers.foodShop = foodShop;
  const chestStorage = createPlayChestStorage({
    controls: options.controls,
    getInventory: options.getInventory,
    setInventory: options.setInventory,
    loopRef: options.loopRef,
    onWillOpen: () => {
      personalInventory.close();
      weaponShop.close();
      outfitters.close();
      foodShop.close();
    },
  });
  closers.chestStorage = chestStorage;
  return { personalInventory, chestStorage, weaponShop, outfitters, foodShop };
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
