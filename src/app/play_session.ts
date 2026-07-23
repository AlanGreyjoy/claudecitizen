import { createPlayerControls } from '../input/player_controls';
import { createGameLoop } from '../game/create_game_loop';
import type { BuildAreaRuntime } from '../game/types';
import type { LoadingScreenHandle } from './loading_screen';
import {
  createPlayerVitalsSession,
  type PlayerVitalsSessionController,
} from './player_vitals_session';
import { restoreTitleScreen } from './title_screen';
import { createSurfaceTeleportPanel } from '../render/effects/hud/biome_teleport_panel';
import { loadCurrentDefaultAnimationController } from '../player/animation';
import { loadCurrentCharacterSettings } from '../player/character_settings';
import { createSpikeRenderer, type SpikeRenderer } from '../render/main';
import { warmPlanetSpawnCaches } from '../world/spawn_warm';
import { normalizeVegetationSettings } from '../render/vegetation/settings';
import { buildRoomForArea } from '../player/hangar_build/validation';
import { applyDefaultShipPrefab, syncBootstrapShips } from '../world/ships';
import {
  getStationColliders,
  getStationFrame,
  getStationSpawn,
  stationLocalToWorld,
} from '../world/station';
import { createStationPhysics, type StationPhysics } from '../physics/station_physics';
import { normalizeInventoryState } from '../player/inventory/types';
import type { AuthSession, GameBootstrap } from '../net/api';
import type { BuildTerminalController } from '../render/effects/hud/build_terminal';
import type { HangarPropRenderer } from '../render/hangar/prop_instances';
import type { BuildPropColliderRuntime } from '../player/hangar_build/prop_colliders';
import { createUiIcon, UiIcons } from '../ui/icons';
import { pickStationFloorPoint } from '../render/hangar/prop_instances';
import { resolvePlaySessionBootstrap } from './play_session_bootstrap';
import { loadPlayWorldContext } from './play_session_world';
import { collectPlaySessionDom, requireElement } from './play_session_dom';
import { createPlayBuildSystems } from './play_session_build';
import { createPlayOverlayStack } from './play_session_overlays';

function mountEditorReturnButton(prefabId: string): HTMLButtonElement {
  const button = document.createElement('button');
  button.type = 'button';
  button.title = 'Return to the editor with this prefab loaded (press Esc first to unlock the mouse)';
  button.append(
    createUiIcon(UiIcons.chevronLeft, { className: 'sc-ui-icon', size: 14, strokeWidth: 2 }),
    document.createTextNode(` Back to Editor (${prefabId})`),
  );
  Object.assign(button.style, {
    position: 'fixed',
    top: '18px',
    left: '50%',
    transform: 'translateX(-50%)',
    zIndex: '250',
    display: 'inline-flex',
    alignItems: 'center',
    gap: '6px',
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

function mountPlanetEditorReturnButton(planetId: string): HTMLButtonElement {
  const button = document.createElement('button');
  button.type = 'button';
  button.title = 'Return to Planet Authoring with this planet loaded';
  button.append(
    createUiIcon(UiIcons.chevronLeft, { className: 'sc-ui-icon', size: 14, strokeWidth: 2 }),
    document.createTextNode(` Back to Editor (${planetId})`),
  );
  Object.assign(button.style, {
    position: 'fixed',
    top: '18px',
    left: '50%',
    transform: 'translateX(-50%)',
    zIndex: '250',
    display: 'inline-flex',
    alignItems: 'center',
    gap: '6px',
    padding: '9px 18px',
    border: '1px solid rgba(111, 206, 255, 0.5)',
    background: 'rgba(6, 12, 26, 0.88)',
    color: 'var(--accent, #8bd8ff)',
    font: "600 13px/1 'Rajdhani', sans-serif",
    letterSpacing: '0.14em',
    textTransform: 'uppercase',
    cursor: 'pointer',
  } satisfies Partial<CSSStyleDeclaration>);
  button.addEventListener('click', () => {
    window.location.href = `/?boot=editor&tab=planet&planetId=${encodeURIComponent(planetId)}`;
  });
  document.body.appendChild(button);
  return button;
}

function mountPlayEditorReturnButton(
  world: Awaited<ReturnType<typeof loadPlayWorldContext>>,
): HTMLButtonElement | null {
  if (!import.meta.env.DEV) return null;
  const { params, stationPrefab } = world;
  if (params.fromEditor && params.planetId) {
    return mountPlanetEditorReturnButton(params.planetId);
  }
  if (stationPrefab && params.stationPrefabOverride) {
    return mountEditorReturnButton(stationPrefab.id);
  }
  return null;
}

let started = false;

interface PlaySessionCleanup {
  gameLoop: ReturnType<typeof createGameLoop>;
  controls: ReturnType<typeof createPlayerControls>;
  renderer: SpikeRenderer | null;
  networkClient: Awaited<ReturnType<typeof createPlayOverlayStack>>['networkClient'];
  gameMenu: Awaited<ReturnType<typeof createPlayOverlayStack>>['gameMenu'];
  avmsTerminal: Awaited<ReturnType<typeof createPlayOverlayStack>>['avmsTerminal'];
  entertainmentSystem: Awaited<ReturnType<typeof createPlayOverlayStack>>['entertainmentSystem'];
  weaponShop: Awaited<ReturnType<typeof createPlayOverlayStack>>['weaponShop'];
  outfitters: Awaited<ReturnType<typeof createPlayOverlayStack>>['outfitters'];
  foodShop: Awaited<ReturnType<typeof createPlayOverlayStack>>['foodShop'];
  personalInventory: Awaited<ReturnType<typeof createPlayOverlayStack>>['personalInventory'];
  buildTerminal: BuildTerminalController | null;
  haloBand: Awaited<ReturnType<typeof createPlayOverlayStack>>['haloBand'];
  vitalsSession: PlayerVitalsSessionController;
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
  cleanup.entertainmentSystem.dispose();
  cleanup.weaponShop.dispose();
  cleanup.outfitters.dispose();
  cleanup.foodShop.dispose();
  cleanup.personalInventory.dispose();
  cleanup.buildTerminal?.dispose();
  cleanup.haloBand.dispose();
  cleanup.vitalsSession.stop();
  for (const renderer of cleanup.buildPropRenderers) renderer.dispose();
  for (const colliders of cleanup.buildPropColliders) colliders.dispose();
  cleanup.physics?.dispose();
  cleanup.gameLoop.stop();
  cleanup.gameLoop.cleanupForTitleReturn();
  cleanup.controls.dispose();
  cleanup.renderer?.dispose();
  cleanup.networkClient?.leave();
  cleanup.networkClient?.close();
  window.removeEventListener('resize', cleanup.resize);
  cleanup.editorReturnButton?.remove();
  started = false;
  restoreTitleScreen(cleanup.session);
}

export interface StartPlaySessionOptions {
  requireAuth?: boolean;
  session?: AuthSession | null;
  bootstrap?: GameBootstrap;
}

async function warmPlaySpawnSurface(
  loading: LoadingScreenHandle | undefined,
  world: Awaited<ReturnType<typeof loadPlayWorldContext>>,
  renderer: SpikeRenderer | null,
): Promise<void> {
  if (!world.params.spawnSurface) {
    loading?.setStatus('Preparing station interior...');
    return;
  }
  loading?.setStatus('Warming planet surface...');
  const spawnFocus = warmPlanetSpawnCaches(world.planet, world.seed);
  loading?.setProgress(0.52);
  if (!renderer) return;
  await renderer.warmSpawnCorridor(spawnFocus, {
    onProgress: (fraction, label) => {
      loading?.setStatus(label);
      loading?.setProgress(0.52 + fraction * 0.2);
    },
  });
}

function createPlayGameLoop(options: {
  world: Awaited<ReturnType<typeof loadPlayWorldContext>>;
  controls: ReturnType<typeof createPlayerControls>;
  renderer: SpikeRenderer | null;
  rendererError: unknown;
  overlays: Awaited<ReturnType<typeof createPlayOverlayStack>>;
  bootstrap: GameBootstrap | null;
  buildTerminal: BuildTerminalController | null;
  buildAreas: Partial<Record<string, BuildAreaRuntime>>;
  physics: StationPhysics | null;
  vitalsSession: PlayerVitalsSessionController;
}) {
  const {
    world,
    controls,
    renderer,
    rendererError,
    overlays,
    bootstrap,
    buildTerminal,
    buildAreas,
    physics,
    vitalsSession,
  } = options;

  return createGameLoop({
    planet: world.planet,
    seed: world.seed,
    spawn: world.params.spawnSurface ? 'surface' : 'station',
    planetId: world.planetDocument.id,
    systemId: world.systemDocument?.id ?? world.params.systemId,
    activeStationInstanceId: world.primaryStation?.id ?? null,
    controls,
    renderer,
    rendererError,
    network: overlays.networkClient,
    bootstrap,
    avmsTerminal: overlays.avmsTerminal,
    entertainmentSystem: overlays.entertainmentSystem,
    weaponShop: overlays.weaponShop,
    outfitters: overlays.outfitters,
    foodShop: overlays.foodShop,
    personalInventory: overlays.personalInventory,
    stationPrefab: world.stationPrefab,
    build: buildTerminal ? { areas: buildAreas, terminal: buildTerminal } : null,
    physics,
    onHudUpdate: (params) => {
      overlays.hud.update(params);
      overlays.haloBand.update(params);
    },
    onResetPeak: () => overlays.hud.resetPeak(),
    isPaused: () =>
      overlays.gameMenu.isPaused()
      || overlays.avmsTerminal.isPaused()
      || overlays.entertainmentSystem.isPaused()
      || overlays.weaponShop.isPaused()
      || overlays.outfitters.isPaused()
      || overlays.foodShop.isPaused()
      || overlays.personalInventory.isPaused()
      || (buildTerminal?.isPaused() ?? false),
    getInventoryLoadout: () => overlays.economy.getInventoryState()?.loadout ?? {},
    getInventory: () => overlays.economy.getInventoryState(),
    onInventoryUpdate: (inventory) => {
      overlays.economy.setInventoryState(normalizeInventoryState(inventory));
      overlays.personalInventory.refresh();
    },
    vitalsSession,
  });
}

async function createPlayRenderer(
  dom: ReturnType<typeof collectPlaySessionDom>,
  world: Awaited<ReturnType<typeof loadPlayWorldContext>>,
  bootstrap: GameBootstrap | null,
): Promise<{ renderer: SpikeRenderer | null; rendererError: unknown }> {
  try {
    const renderer = createSpikeRenderer(dom.canvas, world.planet, world.seed, {
      stationPrefab: world.stationPrefab,
      additionalStations: world.additionalStations,
      characterAppearance: bootstrap?.player.characterAppearance ?? null,
    });
    return { renderer, rendererError: null };
  } catch (error) {
    console.error('ClaudeCitizen renderer init failed.', error);
    return { renderer: null, rendererError: error };
  }
}

function wireBuildCanvas(
  dom: ReturnType<typeof collectPlaySessionDom>,
  buildAreas: Partial<Record<string, BuildAreaRuntime>>,
  buildTerminal: BuildTerminalController | null,
  renderer: SpikeRenderer | null,
): void {
  const activeBuildRuntime = (): BuildAreaRuntime | null =>
    (buildAreas.hangar?.controller.isBuildToolActive() ? buildAreas.hangar : null)
    ?? (buildAreas.apartment?.controller.isBuildToolActive() ? buildAreas.apartment : null);

  const pointerNdcForBuildEvent = (event: MouseEvent): { x: number; y: number } => {
    if (document.pointerLockElement === dom.canvas) return { x: 0, y: 0 };
    const rect = dom.canvas.getBoundingClientRect();
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

  dom.canvas.addEventListener('mousemove', syncPointerForBuild);
  dom.canvas.addEventListener('mousedown', (event) => {
    const runtime = activeBuildRuntime();
    if (event.button !== 0 || !runtime || !renderer) return;
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
}

async function createPlayStationPhysics(
  world: Awaited<ReturnType<typeof loadPlayWorldContext>>,
): Promise<StationPhysics | null> {
  try {
    const stationFrame = getStationFrame(world.planet);
    const spawn = getStationSpawn();
    const spawnPosition = stationLocalToWorld(stationFrame, {
      right: spawn.right,
      up: spawn.up,
      forward: spawn.forward,
    });
    return await createStationPhysics(stationFrame, spawnPosition, getStationColliders());
  } catch (error) {
    console.warn('Failed to initialize station physics; falling back to custom walker.', error);
    return null;
  }
}

function initializePlayBuildPhase(options: {
  bootstrap: GameBootstrap | null;
  renderer: SpikeRenderer | null;
  dom: ReturnType<typeof collectPlaySessionDom>;
  onArcBalanceChange: (balance: number) => void;
}) {
  const empty = {
    buildTerminal: null as BuildTerminalController | null,
    buildAreas: {} as Partial<Record<string, BuildAreaRuntime>>,
    buildPropRenderers: [] as HangarPropRenderer[],
    buildPropColliders: [] as BuildPropColliderRuntime[],
  };
  if (!options.bootstrap || !options.renderer) return empty;
  const buildSystems = createPlayBuildSystems({
    bootstrap: options.bootstrap,
    renderer: options.renderer,
    dom: options.dom,
    onArcBalanceChange: options.onArcBalanceChange,
  });
  wireBuildCanvas(
    options.dom,
    buildSystems.buildAreas,
    buildSystems.buildTerminal,
    options.renderer,
  );
  return buildSystems;
}

function createPlayVitalsSession(options: {
  bootstrap: GameBootstrap | null;
  overlays: Awaited<ReturnType<typeof createPlayOverlayStack>>;
  buildTerminal: BuildTerminalController | null;
  loopRef: { loop?: ReturnType<typeof createGameLoop> };
}) {
  const closeGameplayOverlays = (): void => {
    options.overlays.gameMenu.close();
    options.overlays.avmsTerminal.close();
    options.overlays.entertainmentSystem.close();
    options.overlays.weaponShop.close();
    options.overlays.outfitters.close();
    options.overlays.foodShop.close();
    options.overlays.personalInventory.close();
    options.buildTerminal?.close();
    options.overlays.haloBand.close();
  };
  return createPlayerVitalsSession({
    initialVitals: options.bootstrap?.player.vitals ?? { hungerReserve01: 1, thirstReserve01: 1 },
    persistent: options.bootstrap !== null,
    onLocked: (message) => {
      closeGameplayOverlays();
      options.overlays.hud.appendChatMessage('SYS', message);
      options.overlays.haloBand.appendChatMessage('SYS', message);
      options.loopRef.loop?.setVitalsSyncLocked(true);
      options.loopRef.loop?.returnToApartmentForVitalsFailure();
    },
    onUnlocked: () => {
      options.loopRef.loop?.syncApartmentInstanceForVitalsRecovery();
      options.loopRef.loop?.setVitalsSyncLocked(false);
    },
  });
}

async function finalizePlaySessionStart(options: {
  world: Awaited<ReturnType<typeof loadPlayWorldContext>>;
  overlays: Awaited<ReturnType<typeof createPlayOverlayStack>>;
  bootstrap: GameBootstrap | null;
  onSurfaceTeleport: ReturnType<typeof createGameLoop>['teleportToSurface'];
}): Promise<void> {
  const { world, overlays, bootstrap, onSurfaceTeleport } = options;
  if (world.params.spawnSurface) {
    createSurfaceTeleportPanel(requireElement('biome-teleport'), {
      onTeleport: onSurfaceTeleport,
      onStatus: (text) => overlays.hud.appendChatMessage('SYS', text),
    }).setVisible(true);
  }
  if (!bootstrap) return;
  await syncBootstrapShips(
    bootstrap.ships,
    bootstrap.player.id,
    bootstrap.spawn.hangarInstanceId,
  );
}

export async function startPlaySession(
  loading?: LoadingScreenHandle,
  options: StartPlaySessionOptions = {},
): Promise<void> {
  if (started) return;

  const { session, bootstrap } = await resolvePlaySessionBootstrap(loading, options);
  started = true;

  await Promise.all([loadCurrentCharacterSettings(), loadCurrentDefaultAnimationController()]);
  await applyDefaultShipPrefab();
  loading?.setProgress(0.15);

  document.getElementById('title-screen')?.classList.add('is-hidden');
  const world = await loadPlayWorldContext(loading);
  const editorReturnButton = mountPlayEditorReturnButton(world);
  const dom = collectPlaySessionDom();

  const { renderer, rendererError } = await createPlayRenderer(dom, world, bootstrap);
  loading?.setProgress(0.45);
  renderer?.setVegetationSettings(normalizeVegetationSettings(world.planetDocument.vegetation));
  renderer?.setSurfaceSpawnCatalog(world.planetDocument.spawning);
  if (world.params.fromEditor || new URLSearchParams(window.location.search).get('debug') === '1') {
    dom.statsPanelEl.classList.remove('is-hidden');
  }

  await warmPlaySpawnSurface(loading, world, renderer);
  loading?.setProgress(0.72);

  const loopRef: { loop?: ReturnType<typeof createGameLoop> } = {};
  const vitalsSessionRef: { current: PlayerVitalsSessionController | null } = { current: null };
  const controls = createPlayerControls(dom.canvas, { onReset: () => loopRef.loop?.resetWorld() });
  const overlays = await createPlayOverlayStack({
    dom,
    bootstrap,
    session,
    controls,
    renderer,
    loopRef,
    vitalsSessionRef,
    characterAppearance: bootstrap?.player.characterAppearance ?? null,
  });

  const buildSystems = initializePlayBuildPhase({
    bootstrap,
    renderer,
    dom,
    onArcBalanceChange: overlays.economy.setArcBalance,
  });
  const { buildTerminal, buildAreas, buildPropRenderers, buildPropColliders } = buildSystems;

  loading?.setProgress(0.75);
  const physics = await createPlayStationPhysics(world);

  const vitalsSession = createPlayVitalsSession({ bootstrap, overlays, buildTerminal, loopRef });
  vitalsSessionRef.current = vitalsSession;
  if (bootstrap) {
    loading?.setStatus('Synchronizing citizen vitals...');
    await vitalsSession.begin();
  }

  const gameLoop = createPlayGameLoop({
    world,
    controls,
    renderer,
    rendererError,
    overlays,
    bootstrap,
    buildTerminal,
    buildAreas,
    physics,
    vitalsSession,
  });

  loopRef.loop = gameLoop;
  if (vitalsSession.isLocked()) {
    gameLoop.setVitalsSyncLocked(true);
    gameLoop.returnToApartmentForVitalsFailure();
  }

  loading?.setProgress(0.95);
  await finalizePlaySessionStart({
    world,
    overlays,
    bootstrap,
    onSurfaceTeleport: (destination) => gameLoop.teleportToSurface(destination),
  });

  function resize(): void {
    renderer?.resize(window.innerWidth, window.innerHeight);
  }
  window.addEventListener('resize', resize);
  resize();
  gameLoop.start();

  activeCleanup = {
    gameLoop,
    controls,
    renderer,
    networkClient: overlays.networkClient,
    gameMenu: overlays.gameMenu,
    avmsTerminal: overlays.avmsTerminal,
    entertainmentSystem: overlays.entertainmentSystem,
    weaponShop: overlays.weaponShop,
    outfitters: overlays.outfitters,
    foodShop: overlays.foodShop,
    personalInventory: overlays.personalInventory,
    buildTerminal,
    haloBand: overlays.haloBand,
    vitalsSession,
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
