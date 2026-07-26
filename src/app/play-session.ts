import { createPlayerControls } from '../input/player-controls';
import { createGameLoop } from '../game/create-game-loop';
import type { BuildAreaRuntime } from '../game/types';
import type { LoadingScreenHandle } from './loading-screen';
import {
  createPlayerVitalsSession,
  type PlayerVitalsSessionController,
} from './player-vitals-session';
import { restoreTitleScreen } from './title-screen';
import { createSurfaceTeleportPanel } from '../render/effects/hud/biome-teleport-panel';
import { loadCurrentDefaultAnimationController } from '../player/animation';
import { loadCurrentCharacterSettings } from '../player/character-settings';
import {
  clonePlayerCharacterAppearance,
  DEFAULT_PLAYER_CHARACTER_APPEARANCE,
  type PlayerCharacterAppearanceV1,
} from '../player/character_creator/player-character-appearance';
import { createSpikeRenderer, type SpikeRenderer } from '../render/main';
import { warmPlanetSpawnCaches } from '../world/spawn-warm';
import { normalizeVegetationSettings } from '../render/vegetation/settings';
import { buildRoomForArea } from '../player/hangar_build/validation';
import { activateShipPrefab, applyDefaultShipPrefab, syncBootstrapShips } from '../world/ships';
import {
  getStationColliders,
  getStationFrame,
  getStationSpawn,
  stationLocalToWorld,
} from '../world/station';
import { createStationPhysics, type StationPhysics } from '../physics/station-physics';
import { normalizeInventoryState } from '../player/inventory/types';
import type { AuthSession, GameBootstrap } from '../net/api';
import type { BuildTerminalController } from '../render/effects/hud/build-terminal';
import type { HangarPropRenderer } from '../render/hangar/prop-instances';
import type { BuildPropColliderRuntime } from '../player/hangar_build/prop-colliders';
import { pickStationFloorPoint } from '../render/hangar/prop-instances';
import { resolvePlaySessionBootstrap } from './play-session-bootstrap';
import { loadPlayWorldContext, type PlayWorldParams } from './play-session-world';
import { collectPlaySessionDom, requireElement } from './play-session-dom';
import { getPlayChromeRoot, mountPlayChrome } from './play-chrome';
import { createPlayBuildSystems } from './play-session-build';
import { createPlayOverlayStack } from './play-session-overlays';

/**
 * Editor Play (and similar no-auth gameplay) should use the Base Characters
 * Sidekick body — not the legacy UAL mannequin — unless a real appearance
 * already came from bootstrap / character create.
 */
function resolvePlayCharacterAppearance(
  bootstrap: GameBootstrap | null,
  fromEditor: boolean,
): PlayerCharacterAppearanceV1 | null {
  if (bootstrap?.player.characterAppearance) {
    return clonePlayerCharacterAppearance(bootstrap.player.characterAppearance);
  }
  if (fromEditor) {
    return clonePlayerCharacterAppearance(DEFAULT_PLAYER_CHARACTER_APPEARANCE);
  }
  return null;
}

let started = false;
/**
 * Bumped by every stop. `startPlaySession` captures it up front and compares
 * before it publishes the session, so a stop that lands mid-load is not lost:
 * the load finishes, then tears itself down instead of leaking a live loop.
 */
let startGeneration = 0;
/** Editor Play/Pause gate. Overlay pauses stay independent of this flag. */
let externallyPaused = false;

export function setPlaySessionPaused(paused: boolean): void {
  externallyPaused = paused;
}

export function isPlaySessionPaused(): boolean {
  return externallyPaused;
}

export function isPlaySessionRunning(): boolean {
  return started;
}

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
}

let activeCleanup: PlaySessionCleanup | null = null;

/**
 * Releases one session's resources. Takes the cleanup record rather than
 * reading `activeCleanup` so an abandoned start can dispose what it built
 * without touching a session that began after it.
 */
function disposePlaySession(cleanup: PlaySessionCleanup): void {
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
}

/** Keeps the drawing buffer on the window, and returns the listener to release. */
function bindPlayResize(renderer: SpikeRenderer | null): () => void {
  const resize = (): void => {
    renderer?.resize(window.innerWidth, window.innerHeight);
  };
  window.addEventListener('resize', resize);
  resize();
  return resize;
}

/**
 * Makes a finished session the active one, or discards it when a stop landed
 * while it was still loading. Returns false when the caller must abandon the
 * start: a later Play may already own the session.
 */
function publishPlaySession(
  cleanup: PlaySessionCleanup,
  generation: number,
  loading?: LoadingScreenHandle,
): boolean {
  if (generation !== startGeneration) {
    disposePlaySession(cleanup);
    loading?.hide();
    return false;
  }
  activeCleanup = cleanup;
  return true;
}

export function stopPlaySession(options: { restoreTitle?: boolean } = {}): void {
  const cleanup = activeCleanup;
  // Clear the flags even when no session published itself yet: a stop that
  // lands mid-load has nothing to dispose, and leaving `started` set would make
  // the next Play a no-op.
  activeCleanup = null;
  externallyPaused = false;
  started = false;
  startGeneration += 1;
  if (cleanup) disposePlaySession(cleanup);
  if (options.restoreTitle ?? true) {
    restoreTitleScreen(cleanup?.session ?? null);
    return;
  }
  getPlayChromeRoot()?.classList.add('is-hidden');
}

export interface StartPlaySessionOptions {
  requireAuth?: boolean;
  session?: AuthSession | null;
  bootstrap?: GameBootstrap;
  /** Scene-resolved world config. Skips URL param resolution when provided. */
  worldParams?: PlayWorldParams;
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

/**
 * Activates the hull the scene actually placed. A scene that places no ship
 * still needs one loaded (mode transitions read a body), so the default hull
 * remains the fallback rather than the only option.
 */
async function applyScenePlayShipPrefab(params: PlayWorldParams): Promise<void> {
  if (!params.shipPrefabOverride) {
    await applyDefaultShipPrefab();
    return;
  }
  await activateShipPrefab(params.shipPrefabOverride);
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
    content: world.params.content,
    shipPrefabId: world.params.shipPrefabOverride,
    shipRampDownOnSpawn: world.params.shipTest,
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
      externallyPaused
      || overlays.gameMenu.isPaused()
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
  characterAppearance: PlayerCharacterAppearanceV1 | null,
): Promise<{ renderer: SpikeRenderer | null; rendererError: unknown }> {
  try {
    const renderer = createSpikeRenderer(dom.canvas, world.planet, world.seed, {
      stationPrefab: world.stationPrefab,
      additionalStations: world.additionalStations,
      characterAppearance,
      environment: world.params.content.planet ? 'planet' : 'interior',
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
  if (!bootstrap || !world.params.content.ship) return;
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
  const generation = startGeneration;

  await Promise.all([loadCurrentCharacterSettings(), loadCurrentDefaultAnimationController()]);
  loading?.setProgress(0.15);

  document.getElementById('title-screen')?.classList.add('is-hidden');
  const world = await loadPlayWorldContext(loading, options.worldParams);
  // Scenes that place no ship never load a hull. The player ship stays an
  // unrendered data stub so mode transitions keep a body to read.
  if (world.params.content.ship) await applyScenePlayShipPrefab(world.params);
  // Editor Play hosts chrome in `#editor-play-host`. Remounting onto `document.body`
  // leaves that host as an empty black overlay (z-index 40) on top of the canvas.
  const playChromeParent =
    document.getElementById('editor-play-host') ?? document.body;
  const chrome = mountPlayChrome(playChromeParent);
  chrome.classList.remove('is-hidden');
  const dom = collectPlaySessionDom(chrome);
  const characterAppearance = resolvePlayCharacterAppearance(
    bootstrap,
    world.params.fromEditor,
  );

  const { renderer, rendererError } = await createPlayRenderer(
    dom,
    world,
    characterAppearance,
  );
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
    characterAppearance,
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

  const resize = bindPlayResize(renderer);
  gameLoop.start();

  const cleanup: PlaySessionCleanup = {
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
  };

  if (!publishPlaySession(cleanup, generation, loading)) return;

  if (loading) {
    await loading.complete();
    loading.hide();
  }
  requireElement<HTMLElement>('app').classList.remove('is-hidden');
}
