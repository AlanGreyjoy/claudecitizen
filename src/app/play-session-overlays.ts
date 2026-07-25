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
import type { PlaySessionDom } from './play-session-dom';
import type { PlayerVitalsSessionController } from './player-vitals-session';
import {
  connectPlayNetwork,
  createPlayAvmsTerminal,
  createPlayEntertainmentSystem,
  createPlayGameMenu,
  createPlayHaloBand,
  createPlayHud,
  createPlayPersonalInventory,
  createPlayShops,
} from './play-session-overlays-helpers';

export interface PlayOverlayEconomy {
  getArcBalance: () => number | null;
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
  weaponShop: ReturnType<typeof createPlayShops>['weaponShop'];
  outfitters: ReturnType<typeof createPlayShops>['outfitters'];
  foodShop: ReturnType<typeof createPlayShops>['foodShop'];
  personalInventory: ReturnType<typeof createPlayPersonalInventory>;
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

  const hud = createPlayHud(dom, () => networkClient, options.renderer);
  networkClient = await connectPlayNetwork(bootstrap, hud, () => haloBand);
  haloBand = createPlayHaloBand(
    dom,
    controls,
    () => networkClient,
    () => arcBalance,
    () => inventoryState,
  );

  const gameMenu = createPlayGameMenu(dom);
  const avmsTerminal = createPlayAvmsTerminal(dom);
  const entertainmentSystem = createPlayEntertainmentSystem();

  const personalInventory = createPlayPersonalInventory({
    controls,
    getInventory: () => inventoryState,
    setInventory: (inventory) => { inventoryState = inventory; },
    characterAppearance,
    loopRef,
    vitalsSessionRef,
  });

  const onPurchaseResult = (result: { arcBalance: number; inventory: unknown }) => {
    arcBalance = result.arcBalance;
    inventoryState = normalizeInventoryState(result.inventory);
    personalInventory.refresh();
  };

  const { weaponShop, outfitters, foodShop } = createPlayShops({
    getArcBalance: () => arcBalance,
    getInventory: () => inventoryState,
    onPurchaseResult,
  });

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
