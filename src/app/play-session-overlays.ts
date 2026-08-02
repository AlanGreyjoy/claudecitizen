import type { HaloBandController } from '../render/effects/hud/haloband';
import type { WorldClient } from '../net/world-client';
import type { GameBootstrap, AuthSession } from '../net/api';
import {
  normalizeInventoryState,
  type InventoryState,
} from '../player/inventory/types';
import type { createPlayerControls } from '../input/player-controls';
import type { createGameLoop } from '../game/create-game-loop';
import type { SpikeRenderer } from '../render/main';
import type { SceneDocument } from '../world/scenes/schema';
import type { SceneExitTarget } from '../game/station/scene-exit';
import type { PlaySessionDom } from './play-session-dom';
import type { PlayerVitalsSessionController } from './player-vitals-session';
import { isEditorOfflineBootstrap } from './editor-play-bootstrap';
import {
  connectPlayNetwork,
  createPlayAvmsTerminal,
  createPlayEntertainmentSystem,
  createPlayGameMenu,
  createPlayHaloBand,
  createPlayHud,
  createPlayMallCallbacks,
  createPlayInventoryOverlayBundle,
} from './play-session-overlays-helpers';

export interface PlayOverlayEconomy {
  getArcBalance: () => number | null;
  /** AsteronCredits — the Item Mall currency. */
  getCreditBalance: () => number;
  getInventoryState: () => InventoryState | null;
  setArcBalance: (balance: number) => void;
  setInventoryState: (inventory: InventoryState) => void;
}

export interface PlayOverlayStack {
  hud: ReturnType<typeof createPlayHud>;
  haloBand: HaloBandController;
  gameMenu: ReturnType<typeof createPlayGameMenu>;
  avmsTerminal: ReturnType<typeof createPlayAvmsTerminal>;
  entertainmentSystem: ReturnType<typeof createPlayEntertainmentSystem>;
  weaponShop: ReturnType<typeof createPlayInventoryOverlayBundle>['weaponShop'];
  outfitters: ReturnType<typeof createPlayInventoryOverlayBundle>['outfitters'];
  foodShop: ReturnType<typeof createPlayInventoryOverlayBundle>['foodShop'];
  personalInventory: ReturnType<typeof createPlayInventoryOverlayBundle>['personalInventory'];
  chestStorage: ReturnType<typeof createPlayInventoryOverlayBundle>['chestStorage'];
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
  /** Scene being played. Decides which authoritative instance the session joins. */
  scene: SceneDocument | null;
  /** Cell handed over by the scene-exit that caused this swap, if any. */
  networkTarget?: SceneExitTarget | null;
  /** Esc menu "Exit to Title Screen" — scene host reloads the boot scene. */
  onExitToTitle?: () => void;
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
  let creditBalance = bootstrap ? bootstrap.economy.creditBalance : 0;
  let haloBand: HaloBandController | null = null;

  const hud = createPlayHud(dom, () => networkClient, options.renderer);
  networkClient = await connectPlayNetwork(
    bootstrap,
    hud,
    () => haloBand,
    options.scene,
    options.networkTarget ?? null,
  );
  // Offline / editor-preview sessions have no live citizen, so Mall stays hidden.
  let personalInventoryRefresh: (() => void) | null = null;
  const mallCallbacks =
    bootstrap && !isEditorOfflineBootstrap(bootstrap)
      ? createPlayMallCallbacks({
          getCreditBalance: () => creditBalance,
          setCreditBalance: (balance) => { creditBalance = balance; },
          getInventory: () => inventoryState,
          onInventoryChanged: (inventory) => {
            inventoryState = normalizeInventoryState(inventory);
            personalInventoryRefresh?.();
          },
        })
      : undefined;
  haloBand = createPlayHaloBand(
    dom,
    controls,
    () => networkClient,
    () => arcBalance,
    () => inventoryState,
    mallCallbacks,
  );

  const gameMenu = createPlayGameMenu(dom, { onExitToTitle: options.onExitToTitle });
  const avmsTerminal = createPlayAvmsTerminal(dom);
  const entertainmentSystem = createPlayEntertainmentSystem();

  const {
    personalInventory,
    chestStorage,
    weaponShop,
    outfitters,
    foodShop,
  } = createPlayInventoryOverlayBundle({
    controls,
    getInventory: () => inventoryState,
    setInventory: (inventory) => { inventoryState = inventory; },
    getArcBalance: () => arcBalance,
    setArcBalance: (balance) => { arcBalance = balance; },
    characterAppearance,
    loopRef,
    vitalsSessionRef,
  });
  personalInventoryRefresh = () => personalInventory.refresh();

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
    chestStorage,
    networkClient,
    economy: {
      getArcBalance: () => arcBalance,
      getCreditBalance: () => creditBalance,
      getInventoryState: () => inventoryState,
      setArcBalance: (balance) => { arcBalance = balance; },
      setInventoryState: (inventory) => { inventoryState = inventory; },
    },
  };
}
