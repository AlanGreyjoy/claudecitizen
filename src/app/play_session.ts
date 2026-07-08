import { createPlayerControls } from './player_controls';
import { createGameLoop, type BuildAreaRuntime } from './game_loop';
import type { LoadingScreenHandle } from './loading_screen';
import { restoreTitleScreen } from './title_screen';
import { createHud, createHaloBand } from '../render/effects';
import { createGameMenu } from '../render/effects/hud/game_menu';
import { createAvmsTerminal } from '../render/effects/hud/avms_terminal';
import { createBuildTerminal } from '../render/effects/hud/build_terminal';
import { createHangarBuildController } from '../player/hangar_build/build_controller';
import {
  createBuildPropColliderRuntime,
  type BuildPropColliderRuntime,
} from '../player/hangar_build/prop_colliders';
import { createHangarPropRenderer, pickStationFloorPoint } from '../render/hangar/prop_instances';
import { createSpikeRenderer, type SpikeRenderer } from '../render/main';
import { createVegetationControls } from '../render/vegetation';
import { CLAUDECITIZEN_PLANET } from '../world/planet';
import { buildRoomForArea } from '../player/hangar_build/validation';
import { loadPrefabDocument } from '../world/prefabs/loader';
import { buildStationLayoutFromPrefab } from '../world/prefabs/station_runtime';
import { applyDefaultShipPrefab, syncBootstrapShips } from '../world/ships';
import {
  getStationColliders,
  getStationFrame,
  getStationSpawn,
  setStationLayoutOverride,
  stationLocalToWorld,
} from '../world/station';
import { createStationPhysics, type StationPhysics } from '../physics/station_physics';
import type { PrefabDocument } from '../world/prefabs/schema';
import type { InventoryState } from '../player/inventory/types';
import {
  fetchGameBootstrap,
  getSession,
  type AuthSession,
  type BuildArea,
  type GameBootstrap,
} from '../net/api';
import { createWorldClient, type WorldClient } from '../net/world_client';
import type { GameMenuController } from '../render/effects/hud/game_menu';
import type { AvmsTerminalController } from '../render/effects/hud/avms_terminal';
import type { BuildTerminalController } from '../render/effects/hud/build_terminal';
import type { HaloBandController } from '../render/effects/hud/haloband';
import type { HangarPropRenderer } from '../render/hangar/prop_instances';

function requireElement<T extends HTMLElement>(id: string): T {
  const element = document.getElementById(id);
  if (!element) {
    throw new Error(`Missing required element #${id}`);
  }
  return element as T;
}

const DEFAULT_STATION_PREFAB_ID = 'demo-station';

/**
 * Loads the station prefab that drives the in-game station layout and
 * renderer. The default is demo-station; in dev mode, ?stationPrefab=<id>
 * overrides it for ad-hoc editor previews. Falls back to the procedural
 * station if the prefab can't be loaded or walked.
 */
async function resolveStationPrefab(): Promise<PrefabDocument | null> {
  const params = new URLSearchParams(window.location.search);
  const id = import.meta.env.DEV
    ? params.get('stationPrefab') ?? DEFAULT_STATION_PREFAB_ID
    : DEFAULT_STATION_PREFAB_ID;

  const doc = await loadPrefabDocument(id);
  if (!doc) {
    console.warn(`Station prefab "${id}" not found; using the procedural station.`);
    return null;
  }
  const layout = await buildStationLayoutFromPrefab(doc);
  if (!layout) {
    console.warn(`Station prefab "${id}" is not walkable; using the procedural station.`);
    return null;
  }
  setStationLayoutOverride(layout);
  console.info(`Station prefab active: "${id}".`);
  return doc;
}

/** Dev preview affordance: banner + button that jumps back into the editor with the prefab open. */
function mountEditorReturnButton(prefabId: string): HTMLButtonElement {
  const button = document.createElement('button');
  button.type = 'button';
  button.textContent = `◂ Back to Editor (${prefabId})`;
  button.title = 'Return to the editor with this prefab loaded (press Esc first to unlock the mouse)';
  Object.assign(button.style, {
    position: 'fixed',
    top: '18px',
    left: '50%',
    transform: 'translateX(-50%)',
    zIndex: '250',
    padding: '9px 18px',
    border: '1px solid rgba(255, 206, 111, 0.5)',
    background: 'rgba(6, 12, 26, 0.88)',
    color: 'var(--accent-2, #ffce6f)',
    font: "600 13px/1 'Rajdhani', sans-serif",
    letterSpacing: '0.14em',
    textTransform: 'uppercase',
    cursor: 'pointer',
  } satisfies Partial<CSSStyleDeclaration>);
  button.addEventListener('click', () => {
    window.location.href = `/?boot=editor&prefab=${encodeURIComponent(prefabId)}`;
  });
  document.body.appendChild(button);
  return button;
}

let started = false;

interface PlaySessionCleanup {
  gameLoop: ReturnType<typeof createGameLoop>;
  controls: ReturnType<typeof createPlayerControls>;
  renderer: SpikeRenderer | null;
  networkClient: WorldClient | null;
  vegetationControls: ReturnType<typeof createVegetationControls>;
  gameMenu: GameMenuController;
  avmsTerminal: AvmsTerminalController;
  buildTerminal: BuildTerminalController | null;
  haloBand: HaloBandController | null;
  buildPropRenderers: HangarPropRenderer[];
  buildPropColliders: BuildPropColliderRuntime[];
  physics: StationPhysics | null;
  resize: () => void;
  session: AuthSession | null;
  editorReturnButton: HTMLButtonElement | null;
}

let activeCleanup: PlaySessionCleanup | null = null;

export function stopPlaySession(): void {
  const cleanup = activeCleanup;
  if (!cleanup) return;
  activeCleanup = null;

  cleanup.gameMenu.dispose();
  cleanup.avmsTerminal.dispose();
  cleanup.buildTerminal?.dispose();
  cleanup.haloBand?.dispose();
  for (const renderer of cleanup.buildPropRenderers) renderer.dispose();
  for (const colliders of cleanup.buildPropColliders) colliders.dispose();
  cleanup.physics?.dispose();
  cleanup.gameLoop.stop();
  cleanup.gameLoop.cleanupForTitleReturn();
  cleanup.controls.dispose();
  cleanup.renderer?.dispose();
  cleanup.networkClient?.leave();
  cleanup.networkClient?.close();
  cleanup.vegetationControls.dispose();
  window.removeEventListener('resize', cleanup.resize);
  cleanup.editorReturnButton?.remove();
  started = false;
  restoreTitleScreen(cleanup.session);
}

export interface StartPlaySessionOptions {
  requireAuth?: boolean;
  session?: AuthSession | null;
}

export async function startPlaySession(
  loading?: LoadingScreenHandle,
  options: StartPlaySessionOptions = {},
): Promise<void> {
  if (started) return;

  const requireAuth = options.requireAuth ?? true;
  let session: AuthSession | null = options.session ?? null;
  let bootstrap: GameBootstrap | null = null;

  if (requireAuth) {
    loading?.setStatus('Checking credentials...');
    session = session ?? (await getSession());
    if (!session) throw new Error('Login required.');
    loading?.setStatus('Loading citizen record...');
    bootstrap = await fetchGameBootstrap();
  }

  started = true;

  // The ship layout must be active before the renderer (hull, doors) and the
  // world state (rig doors) are created.
  await applyDefaultShipPrefab();
  const stationPrefab = await resolveStationPrefab();
  loading?.setProgress(0.15);

  document.getElementById('title-screen')?.classList.add('is-hidden');
  let editorReturnButton: HTMLButtonElement | null = null;
  if (stationPrefab && import.meta.env.DEV) {
    const previewId = new URLSearchParams(window.location.search).get('stationPrefab');
    if (previewId) {
      editorReturnButton = mountEditorReturnButton(stationPrefab.id);
    }
  }

  const canvas = requireElement<HTMLCanvasElement>('view');
  const fpsEl = requireElement<HTMLElement>('hud-fps-value');
  const minimapCanvas = requireElement<HTMLCanvasElement>('hud-minimap-canvas');
  const chatMessagesEl = requireElement<HTMLElement>('hud-chat-messages');
  const chatInputEl = requireElement<HTMLInputElement>('hud-chat-input');
  const debugBtnEl = requireElement<HTMLButtonElement>('hud-debug-btn');
  const debugMenuEl = requireElement<HTMLElement>('hud-debug-menu');
  const statsPanelEl = requireElement<HTMLElement>('hud-stats');
  const vegetationMenuEl = requireElement<HTMLElement>('vegetation-menu');
  const vegetationResetEl = requireElement<HTMLElement>('vegetation-reset');
  const tutorialBannerEl = document.getElementById('hud-tutorial-banner');
  const promptEl = requireElement<HTMLElement>('prompt');
  const readoutsEl = requireElement<HTMLElement>('readouts');
  const statusEl = requireElement<HTMLElement>('status');
  const controlsEl = requireElement<HTMLElement>('hud-controls');
  const interactPromptEl = requireElement<HTMLElement>('interact-prompt');
  const flightReticleEl = requireElement<HTMLElement>('flight-reticle');
  const screenFadeEl = requireElement<HTMLElement>('screen-fade');
  const gameMenuEl = requireElement<HTMLElement>('game-menu');
  const gameMenuResumeBtn = requireElement<HTMLButtonElement>('game-menu-resume-btn');
  const gameMenuExitBtn = requireElement<HTMLButtonElement>('game-menu-exit-btn');
  const gameMenuMasterVolume = requireElement<HTMLInputElement>('game-menu-master-volume');
  const gameMenuSfxVolume = requireElement<HTMLInputElement>('game-menu-sfx-volume');
  const gameMenuMusicVolume = requireElement<HTMLInputElement>('game-menu-music-volume');
  const gameMenuMasterValue = requireElement<HTMLElement>('game-menu-master-value');
  const gameMenuSfxValue = requireElement<HTMLElement>('game-menu-sfx-value');
  const gameMenuMusicValue = requireElement<HTMLElement>('game-menu-music-value');
  const avmsTerminalEl = requireElement<HTMLElement>('avms-terminal');
  const avmsShipListEl = requireElement<HTMLElement>('avms-ship-list');
  const avmsDetailNameEl = requireElement<HTMLElement>('avms-detail-name');
  const avmsDetailPrefabEl = requireElement<HTMLElement>('avms-detail-prefab');
  const avmsDetailHpBarEl = requireElement<HTMLElement>('avms-detail-hp-bar');
  const avmsDetailShieldBarEl = requireElement<HTMLElement>('avms-detail-shield-bar');
  const avmsDetailHpValueEl = requireElement<HTMLElement>('avms-detail-hp-value');
  const avmsDetailShieldValueEl = requireElement<HTMLElement>('avms-detail-shield-value');
  const avmsStatusEl = requireElement<HTMLElement>('avms-status');
  const avmsDeliverBtn = requireElement<HTMLButtonElement>('avms-deliver-btn');
  const avmsStoreBtn = requireElement<HTMLButtonElement>('avms-store-btn');
  const avmsCloseBtn = requireElement<HTMLButtonElement>('avms-close-btn');
  const buildTerminalEl = requireElement<HTMLElement>('build-terminal');
  const buildKickerEl = requireElement<HTMLElement>('build-kicker');
  const buildVersionEl = requireElement<HTMLElement>('build-version');
  const buildPropListEl = requireElement<HTMLElement>('build-prop-list');
  const buildDetailNameEl = requireElement<HTMLElement>('build-detail-name');
  const buildDetailMetaEl = requireElement<HTMLElement>('build-detail-meta');
  const buildDetailDescEl = requireElement<HTMLElement>('build-detail-desc');
  const buildDetailQtyEl = requireElement<HTMLElement>('build-detail-qty');
  const buildDetailCostEl = requireElement<HTMLElement>('build-detail-cost');
  const buildStatusEl = requireElement<HTMLElement>('build-status');
  const buildNoteEl = requireElement<HTMLElement>('build-note');
  const buildPurchaseBtn = requireElement<HTMLButtonElement>('build-purchase-btn');
  const buildPlaceBtn = requireElement<HTMLButtonElement>('build-place-btn');
  const buildMoveBtn = requireElement<HTMLButtonElement>('build-move-btn');
  const buildDeleteBtn = requireElement<HTMLButtonElement>('build-delete-btn');
  const buildCloseBtn = requireElement<HTMLButtonElement>('build-close-btn');
  const halobandEl = requireElement<HTMLElement>('haloband');
  const halobandChatMessagesEl = requireElement<HTMLElement>('haloband-chat-messages');
  const halobandChatInputEl = requireElement<HTMLInputElement>('haloband-chat-input');
  const halobandChatSendBtn = requireElement<HTMLButtonElement>('haloband-chat-send');
  const halobandShipStatusEl = requireElement<HTMLElement>('haloband-ship-status');
  const halobandInventoryFiltersEl = requireElement<HTMLElement>('haloband-inventory-filters');
  const halobandInventoryGridEl = requireElement<HTMLElement>('haloband-inventory-grid');
  const halobandInventoryDetailEl = requireElement<HTMLElement>('haloband-inventory-detail');
  const halobandBalanceEl = requireElement<HTMLElement>('haloband-balance');
  const halobandBalanceValueEl = requireElement<HTMLElement>('haloband-balance-value');
  const halobandHoloCanvasEl = requireElement<HTMLCanvasElement>('haloband-holo');

  const seed = 20061;
  const planet = CLAUDECITIZEN_PLANET;

  let renderer: SpikeRenderer | null = null;
  let rendererError: unknown = null;
  try {
    renderer = createSpikeRenderer(canvas, planet, seed, { stationPrefab });
  } catch (error) {
    rendererError = error;
    console.error('ClaudeCitizen renderer init failed.', error);
  }
  loading?.setProgress(0.45);

  const vegetationControls = createVegetationControls(vegetationMenuEl, vegetationResetEl, renderer);

  let networkClient: WorldClient | null = null;
  let haloBand: HaloBandController | null = null;

  const hud = createHud(
    {
      fpsEl,
      minimapCanvas,
      chatMessagesEl,
      chatInputEl,
      debugBtnEl,
      debugMenuEl,
      statsPanelEl,
      vegetationMenuEl,
      tutorialBannerEl,
      promptEl,
      readoutsEl,
      statusEl,
      controlsEl,
      interactPromptEl,
      flightReticleEl,
      screenFadeEl,
    },
    planet,
    seed,
    {
      onChatSend: (text) => networkClient?.sendChat(text),
      onTimeOverrideChange: (mode) => renderer?.setTimeOverride(mode),
      onSsaoSettingsChange: (settings) => renderer?.setSsaoSettings(settings),
    },
  );

  if (bootstrap) {
    loading?.setStatus('Opening relay link...');
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

  const loopRef: { loop?: ReturnType<typeof createGameLoop> } = {};

  const controls = createPlayerControls(canvas, {
    onReset: () => loopRef.loop?.resetWorld(),
  });

  // Must be created before the game menu so HaloBand's capture key listener
  // registers first and can claim Esc before the menu opens.
  let arcBalance: number | null = bootstrap ? bootstrap.economy.arcBalance : null;
  let inventoryState: InventoryState | null = bootstrap
    ? (bootstrap.inventory as InventoryState)
    : null;
  haloBand = createHaloBand(
    {
      rootEl: halobandEl,
      chatMessagesEl: halobandChatMessagesEl,
      chatInputEl: halobandChatInputEl,
      sendBtnEl: halobandChatSendBtn,
      shipStatusEl: halobandShipStatusEl,
      inventoryFiltersEl: halobandInventoryFiltersEl,
      inventoryGridEl: halobandInventoryGridEl,
      inventoryDetailEl: halobandInventoryDetailEl,
      balanceEl: halobandBalanceEl,
      balanceValueEl: halobandBalanceValueEl,
      holoCanvasEl: halobandHoloCanvasEl,
    },
    {
      onSendMessage: (text) => networkClient?.sendChat(text),
      playerControls: controls,
      getArcBalance: () => arcBalance,
      getInventory: () => inventoryState,
    },
  );

  const gameMenu = createGameMenu(
    {
      rootEl: gameMenuEl,
      resumeBtnEl: gameMenuResumeBtn,
      exitBtnEl: gameMenuExitBtn,
      chatInputEl,
      masterVolumeEl: gameMenuMasterVolume,
      sfxVolumeEl: gameMenuSfxVolume,
      musicVolumeEl: gameMenuMusicVolume,
      masterValueEl: gameMenuMasterValue,
      sfxValueEl: gameMenuSfxValue,
      musicValueEl: gameMenuMusicValue,
    },
    {
      onExitGame: () => stopPlaySession(),
    },
  );

  const avmsTerminal = createAvmsTerminal({
    rootEl: avmsTerminalEl,
    shipListEl: avmsShipListEl,
    detailNameEl: avmsDetailNameEl,
    detailPrefabEl: avmsDetailPrefabEl,
    detailHpBarEl: avmsDetailHpBarEl,
    detailShieldBarEl: avmsDetailShieldBarEl,
    detailHpValueEl: avmsDetailHpValueEl,
    detailShieldValueEl: avmsDetailShieldValueEl,
    statusEl: avmsStatusEl,
    deliverBtnEl: avmsDeliverBtn,
    storeBtnEl: avmsStoreBtn,
    closeBtnEl: avmsCloseBtn,
  });

  const buildAreas: Partial<Record<BuildArea, BuildAreaRuntime>> = {};
  const buildPropRenderers: HangarPropRenderer[] = [];
  const buildPropColliders: BuildPropColliderRuntime[] = [];
  let buildTerminal: BuildTerminalController | null = null;

  if (bootstrap && renderer) {
    const createBuildRuntime = (
      area: BuildArea,
      rootName: string,
      initialState: GameBootstrap['hangar'],
    ): BuildAreaRuntime => {
      let propRenderer: HangarPropRenderer | null = null;
      const propColliders = createBuildPropColliderRuntime();
      const controller = createHangarBuildController({
        initialState,
        arcBalance: bootstrap.economy.arcBalance,
        onPlacementsChange: (state) => {
          void propRenderer?.setPlacements(state.placements);
          void propColliders.setPlacements(state.placements);
        },
        onStateChange: (ctx) => {
          arcBalance = ctx.arcBalance;
        },
      });
      propRenderer = createHangarPropRenderer({
        rootName,
        stationRoot: renderer.getStationRoot(),
      });
      const runtime = { controller, propRenderer, propColliders };
      buildAreas[area] = runtime;
      buildPropRenderers.push(propRenderer);
      buildPropColliders.push(propColliders);
      void propRenderer.setPlacements(initialState.placements);
      void propColliders.setPlacements(initialState.placements);
      return runtime;
    };

    const hangarBuild = createBuildRuntime('hangar', 'hangar-props', bootstrap.hangar);
    createBuildRuntime('apartment', 'apartment-props', bootstrap.apartment);

    buildTerminal = createBuildTerminal(
      {
        rootEl: buildTerminalEl,
        kickerEl: buildKickerEl,
        versionEl: buildVersionEl,
        propListEl: buildPropListEl,
        detailNameEl: buildDetailNameEl,
        detailMetaEl: buildDetailMetaEl,
        detailDescEl: buildDetailDescEl,
        detailQtyEl: buildDetailQtyEl,
        detailCostEl: buildDetailCostEl,
        statusEl: buildStatusEl,
        purchaseBtnEl: buildPurchaseBtn,
        placeBtnEl: buildPlaceBtn,
        moveBtnEl: buildMoveBtn,
        deleteBtnEl: buildDeleteBtn,
        closeBtnEl: buildCloseBtn,
        noteEl: buildNoteEl,
      },
      { controller: hangarBuild.controller },
    );
  }

  const activeBuildRuntime = (): BuildAreaRuntime | null =>
    (buildAreas.hangar?.controller.isBuildToolActive() ? buildAreas.hangar : null) ??
    (buildAreas.apartment?.controller.isBuildToolActive() ? buildAreas.apartment : null);

  const pointerNdcForBuildEvent = (event: MouseEvent): { x: number; y: number } => {
    if (document.pointerLockElement === canvas) return { x: 0, y: 0 };
    const rect = canvas.getBoundingClientRect();
    return {
      x: ((event.clientX - rect.left) / rect.width) * 2 - 1,
      y: -((event.clientY - rect.top) / rect.height) * 2 + 1,
    };
  };

  const syncPointerForBuild = (event: MouseEvent): void => {
    const runtime = activeBuildRuntime();
    if (!runtime) return;
    const pointer = pointerNdcForBuildEvent(event);
    runtime.controller.setPointerNdc(pointer.x, pointer.y);
  };

  canvas.addEventListener('mousemove', syncPointerForBuild);
  canvas.addEventListener('mousedown', (event) => {
    const runtime = activeBuildRuntime();
    if (event.button !== 0 || !runtime) return;
    if (!renderer) return;
    const pointer = pointerNdcForBuildEvent(event);
    runtime.controller.setPointerNdc(pointer.x, pointer.y);
    const context = runtime.controller.getContext();
    const room = buildRoomForArea(context.state.area, context.state.assignedHangar);
    const floorPoint = pickStationFloorPoint(
      renderer.getCamera(),
      runtime.controller.getPointerNdc(),
      renderer.getStationRoot(),
      room.floorUp,
    );
    void runtime.controller
      .handlePrimaryAction(floorPoint)
      .then(async () => {
        const nextContext = runtime.controller.getContext();
        await runtime.propRenderer.setPlacements(nextContext.state.placements);
        const definition = nextContext.selectedDefinitionId
          ? nextContext.state.catalog.find((entry) => entry.id === nextContext.selectedDefinitionId)
          : null;
        if (nextContext.ghost && definition && nextContext.toolMode === 'place') {
          await runtime.propRenderer.setGhost({
            prefabId: definition.prefabId,
            transform: nextContext.ghost,
          });
        } else {
          await runtime.propRenderer.setGhost(null);
        }
      })
      .then(() => buildTerminal?.refresh());
  });

  loading?.setProgress(0.75);

  let physics: StationPhysics | null = null;
  try {
    const stationFrame = getStationFrame(planet);
    const spawn = getStationSpawn();
    const spawnPosition = stationLocalToWorld(stationFrame, {
      right: spawn.right,
      up: spawn.up,
      forward: spawn.forward,
    });
    physics = await createStationPhysics(
      stationFrame,
      spawnPosition,
      getStationColliders(),
    );
  } catch (error) {
    console.warn('Failed to initialize station physics; falling back to custom walker.', error);
  }

  const gameLoop = createGameLoop({
    planet,
    seed,
    controls,
    renderer,
    rendererError,
    network: networkClient,
    bootstrap,
    avmsTerminal,
    stationPrefab,
    build:
      buildTerminal
        ? {
            areas: buildAreas,
            terminal: buildTerminal,
          }
        : null,
    physics,
    onHudUpdate: (params) => {
      hud.update(params);
      haloBand?.update(params);
    },
    onResetPeak: () => hud.resetPeak(),
    isPaused: () =>
      gameMenu.isPaused() || avmsTerminal.isPaused() || (buildTerminal?.isPaused() ?? false),
  });

  loopRef.loop = gameLoop;

  if (bootstrap) {
    await syncBootstrapShips(
      bootstrap.ships,
      bootstrap.player.id,
      bootstrap.spawn.hangarInstanceId,
    );
  }

  function resize(): void {
    renderer?.resize(window.innerWidth, window.innerHeight);
  }

  window.addEventListener('resize', resize);
  resize();

  loading?.setProgress(0.95);
  gameLoop.start();

  activeCleanup = {
    gameLoop,
    controls,
    renderer,
    networkClient,
    vegetationControls,
    gameMenu,
    avmsTerminal,
    buildTerminal,
    haloBand,
    buildPropRenderers,
    buildPropColliders,
    physics,
    resize,
    session,
    editorReturnButton,
  };

  if (loading) {
    await loading.complete();
    loading.hide();
  }
  requireElement<HTMLElement>('app').classList.remove('is-hidden');
}
