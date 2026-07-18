import { createPlayerControls } from './player_controls';
import { createGameLoop, type BuildAreaRuntime } from './game_loop';
import type { LoadingScreenHandle } from './loading_screen';
import { restoreTitleScreen } from './title_screen';
import { createHud, createHaloBand } from '../render/effects';
import { createGameMenu } from '../render/effects/hud/game_menu';
import { createAvmsTerminal } from '../render/effects/hud/avms_terminal';
import { createEntertainmentSystem } from '../render/effects/hud/entertainment_system';
import { createWeaponShop } from '../render/effects/hud/weapon_shop';
import { createOutfitters } from '../render/effects/hud/outfitters';
import { createPersonalInventory } from '../render/effects/hud/personal_inventory';
import { createBuildTerminal } from '../render/effects/hud/build_terminal';
import { createHangarBuildController } from '../player/hangar_build/build_controller';
import {
  createBuildPropColliderRuntime,
  type BuildPropColliderRuntime,
} from '../player/hangar_build/prop_colliders';
import { createHangarPropRenderer, pickStationFloorPoint } from '../render/hangar/prop_instances';
import { createSpikeRenderer, type SpikeRenderer } from '../render/main';
import { hydrateSpawnPackFromUrl } from '../cache/spawn_pack';
import { CLAUDECITIZEN_PLANET, DEFAULT_PLANET_ID, DEFAULT_PLANET_SEED } from '../world/planet';
import { activatePlanetDocument } from '../world/planets/runtime';
import { loadPlanetDocument } from '../world/planets/loader';
import { createDefaultPlanetDocument } from '../world/planets/schema';
import { loadSystemDocument } from '../world/systems/loader';
import {
  activateSystemDocument,
  DEFAULT_SYSTEM_ID,
  getSystemStationEntriesForPlanetDocument,
  pickPrimarySystemStation,
  resolveStationAltitudeMeters,
} from '../world/systems/runtime';
import { warmPlanetSpawnCaches } from '../world/spawn_warm';
import { normalizeVegetationSettings } from '../render/vegetation/settings';
import { buildRoomForArea } from '../player/hangar_build/validation';
import { loadPrefabDocument } from '../world/prefabs/loader';
import { buildStationLayoutFromPrefab } from '../world/prefabs/station_runtime';
import { applyDefaultShipPrefab, syncBootstrapShips } from '../world/ships';
import {
  getStationColliders,
  getStationFrame,
  getStationFrameAt,
  getStationSpawn,
  orbitHintFromSystemOffset,
  setStationLayoutOverride,
  setStationOrbitHint,
  stationLocalToWorld,
  type StationFrame,
} from '../world/station';
import { createStationPhysics, type StationPhysics } from '../physics/station_physics';
import type { PrefabDocument } from '../world/prefabs/schema';
import {
  normalizeInventoryState,
  type InventoryState,
} from '../player/inventory/types';
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
import { collectHaloBandElements } from '../render/effects/hud/haloband_dom';
import type { HaloBandController } from '../render/effects/hud/haloband';
import { createUiIcon, UiIcons } from '../ui/icons';
import type { PersonalInventoryController } from '../render/effects/hud/personal_inventory';
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
 * renderer. Prefers an explicit `?stationPrefab=` override (dev), else the
 * preferred id from the active system document, else demo-station.
 */
async function resolveStationPrefab(preferredId?: string | null): Promise<PrefabDocument | null> {
  const params = new URLSearchParams(window.location.search);
  const id = import.meta.env.DEV
    ? params.get('stationPrefab') ?? preferredId ?? DEFAULT_STATION_PREFAB_ID
    : preferredId ?? DEFAULT_STATION_PREFAB_ID;

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

let started = false;

interface PlaySessionCleanup {
  gameLoop: ReturnType<typeof createGameLoop>;
  controls: ReturnType<typeof createPlayerControls>;
  renderer: SpikeRenderer | null;
  networkClient: WorldClient | null;
  gameMenu: GameMenuController;
  avmsTerminal: AvmsTerminalController;
  entertainmentSystem: ReturnType<typeof createEntertainmentSystem>;
  weaponShop: ReturnType<typeof createWeaponShop>;
  outfitters: ReturnType<typeof createOutfitters>;
  personalInventory: PersonalInventoryController;
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
  cleanup.entertainmentSystem.dispose();
  cleanup.weaponShop.dispose();
  cleanup.outfitters.dispose();
  cleanup.personalInventory.dispose();
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

export async function startPlaySession(
  loading?: LoadingScreenHandle,
  options: StartPlaySessionOptions = {},
): Promise<void> {
  if (started) return;

  const requireAuth = options.requireAuth ?? true;
  let session: AuthSession | null = options.session ?? null;
  let bootstrap: GameBootstrap | null = options.bootstrap ?? null;

  if (requireAuth) {
    loading?.setStatus('Checking credentials...');
    session = session ?? (await getSession());
    if (!session) throw new Error('Login required.');
    if (!bootstrap) {
      loading?.setStatus('Loading citizen record...');
      bootstrap = await fetchGameBootstrap();
    }
  }

  started = true;

  // The ship layout must be active before the renderer (hull, doors) and the
  // world state (rig doors) are created.
  await applyDefaultShipPrefab();
  loading?.setProgress(0.15);

  document.getElementById('title-screen')?.classList.add('is-hidden');
  const playParams = new URLSearchParams(window.location.search);
  const planetId = playParams.get('planetId') ?? DEFAULT_PLANET_ID;
  const systemId = playParams.get('systemId') ?? DEFAULT_SYSTEM_ID;
  const spawnSurface = playParams.get('spawn') === 'surface';
  const fromEditor = playParams.get('from') === 'editor';
  const stationPrefabOverride = import.meta.env.DEV ? playParams.get('stationPrefab') : null;

  const planetDocument =
    (await loadPlanetDocument(planetId)) ?? createDefaultPlanetDocument(planetId, planetId);
  const planetConfig = activatePlanetDocument(planetDocument);
  const seed = planetConfig.seed || DEFAULT_PLANET_SEED;
  const planet = planetConfig.planet.name ? planetConfig.planet : { ...CLAUDECITIZEN_PLANET, ...planetConfig.planet };

  loading?.setStatus('Seeding spawn tile cache...');
  await hydrateSpawnPackFromUrl(planetDocument.id);
  loading?.setProgress(0.22);

  const systemDocument =
    (await loadSystemDocument(systemId)) ??
    (systemId !== DEFAULT_SYSTEM_ID ? await loadSystemDocument(DEFAULT_SYSTEM_ID) : null);
  if (systemDocument) {
    activateSystemDocument(systemDocument);
    console.info(`System active: "${systemDocument.id}" (${systemDocument.name}).`);
  } else {
    console.warn(
      `System "${systemId}" not found; station placement falls back to the default orbital frame.`,
    );
    setStationOrbitHint(null);
  }

  const systemStations = systemDocument
    ? getSystemStationEntriesForPlanetDocument(systemDocument, planetDocument.id)
    : [];
  const primaryStation = pickPrimarySystemStation(systemStations, stationPrefabOverride);
  if (primaryStation) {
    setStationOrbitHint(
      orbitHintFromSystemOffset(
        primaryStation.offsetMeters,
        resolveStationAltitudeMeters(primaryStation),
      ),
    );
    console.info(
      `Primary station instance "${primaryStation.id}" (${primaryStation.stationPrefabId}) from system map.`,
    );
  } else {
    setStationOrbitHint(null);
  }

  const stationPrefab = await resolveStationPrefab(
    primaryStation?.stationPrefabId ?? DEFAULT_STATION_PREFAB_ID,
  );

  const additionalStations: Array<{ prefab: PrefabDocument; frame: StationFrame }> = [];
  for (const entry of systemStations) {
    if (primaryStation && entry.id === primaryStation.id) continue;
    const prefab = await loadPrefabDocument(entry.stationPrefabId);
    if (!prefab) {
      console.warn(`Secondary station prefab "${entry.stationPrefabId}" missing; skipping.`);
      continue;
    }
    const hint = orbitHintFromSystemOffset(
      entry.offsetMeters,
      resolveStationAltitudeMeters(entry),
    );
    additionalStations.push({
      prefab,
      frame: getStationFrameAt(planet, hint.latRadians, hint.lonRadians, hint.altitudeMeters),
    });
  }
  if (additionalStations.length > 0) {
    console.info(
      `Spawned ${additionalStations.length} secondary system station(s) as visual roots (primary owns walk physics).`,
    );
  }

  console.info(
    `Planet active: "${planetDocument.id}" seed=${seed}${spawnSurface ? ' (surface spawn)' : ''}.`,
  );

  let editorReturnButton: HTMLButtonElement | null = null;
  if (import.meta.env.DEV) {
    if (fromEditor && planetId) {
      editorReturnButton = mountPlanetEditorReturnButton(planetId);
    } else if (stationPrefab) {
      const previewId = playParams.get('stationPrefab');
      if (previewId) {
        editorReturnButton = mountEditorReturnButton(stationPrefab.id);
      }
    }
  }

  const canvas = requireElement<HTMLCanvasElement>('view');
  const fpsEl = requireElement<HTMLElement>('hud-fps-value');
  const chatMessagesEl = requireElement<HTMLElement>('hud-chat-messages');
  const chatInputEl = requireElement<HTMLInputElement>('hud-chat-input');
  const debugBtnEl = requireElement<HTMLButtonElement>('hud-debug-btn');
  const debugMenuEl = requireElement<HTMLElement>('hud-debug-menu');
  const statsPanelEl = requireElement<HTMLElement>('hud-stats');
  const tutorialBannerEl = document.getElementById('hud-tutorial-banner');
  const promptEl = requireElement<HTMLElement>('prompt');
  const readoutsEl = requireElement<HTMLElement>('readouts');
  const statusEl = requireElement<HTMLElement>('status');
  const controlsEl = requireElement<HTMLElement>('hud-controls');
  const interactPromptEl = requireElement<HTMLElement>('interact-prompt');
  const flightReticleEl = requireElement<HTMLElement>('flight-reticle');
  const cockpitGazeEl = requireElement<HTMLElement>('cockpit-gaze');
  const cockpitSpeedEl = requireElement<HTMLElement>('cockpit-speed');
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
  const avmsPowerBtn = requireElement<HTMLButtonElement>('avms-power-btn');
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

  let renderer: SpikeRenderer | null = null;
  let rendererError: unknown = null;
  try {
    renderer = createSpikeRenderer(canvas, planet, seed, {
      stationPrefab,
      additionalStations,
      characterAppearance: bootstrap?.player.characterAppearance ?? null,
    });
  } catch (error) {
    rendererError = error;
    console.error('ClaudeCitizen renderer init failed.', error);
  }
  loading?.setProgress(0.45);

  renderer?.setVegetationSettings(normalizeVegetationSettings(planetDocument.vegetation));
  const spawnCatalog = planetDocument.spawning;
  renderer?.setSurfaceSpawnCatalog(spawnCatalog);
  console.info(
    `ClaudeCitizen surface spawns: ${spawnCatalog.entries.length} entr(y/ies)` +
      ` samplesPerTile=${spawnCatalog.samplesPerTile}` +
      ` density=${spawnCatalog.density}`,
    spawnCatalog.entries.map(
      (layer) => `${layer.id}:${layer.assetUrl ? 'asset' : 'no-asset'}`,
    ),
  );
  if (fromEditor || playParams.get('debug') === '1') {
    statsPanelEl.classList.remove('is-hidden');
  }

  loading?.setStatus('Warming planet surface...');
  const spawnFocus = warmPlanetSpawnCaches(planet, seed);
  loading?.setProgress(0.52);
  if (renderer) {
    await renderer.warmSpawnCorridor(spawnFocus, {
      onProgress: (fraction, label) => {
        loading?.setStatus(label);
        loading?.setProgress(0.52 + fraction * 0.2);
      },
    });
  }
  loading?.setProgress(0.72);

  let networkClient: WorldClient | null = null;
  let haloBand: HaloBandController | null = null;

  const hud = createHud(
    {
      fpsEl,
      chatMessagesEl,
      chatInputEl,
      debugBtnEl,
      debugMenuEl,
      statsPanelEl,
      tutorialBannerEl,
      promptEl,
      readoutsEl,
      statusEl,
      controlsEl,
      interactPromptEl,
      flightReticleEl,
      cockpitGazeEl,
      cockpitSpeedEl,
      screenFadeEl,
    },
    {
      onChatSend: (text) => networkClient?.sendChat(text),
      onTimeOverrideChange: (mode) => renderer?.setTimeOverride(mode),
      onSsaoSettingsChange: (settings) => renderer?.setSsaoSettings(settings),
      onVegetationLayersChange: (layers) => renderer?.setVegetationLayers(layers),
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
    ? normalizeInventoryState(bootstrap.inventory)
    : null;
  haloBand = createHaloBand(
    collectHaloBandElements(halobandEl),
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
    powerBtnEl: avmsPowerBtn,
  });

  const entertainmentSystemEl = requireElement<HTMLElement>('entertainment-system');
  const entertainmentSystem = createEntertainmentSystem({
    rootEl: entertainmentSystemEl,
    homeEl: requireElement<HTMLElement>('es-home'),
    docsEl: requireElement<HTMLElement>('es-docs'),
    youtubeEl: requireElement<HTMLElement>('es-youtube'),
    nasaEl: requireElement<HTMLElement>('es-nasa'),
    localnowEl: requireElement<HTMLElement>('es-localnow'),
    docsFrameEl: requireElement<HTMLIFrameElement>('es-docs-frame'),
    youtubeFrameEl: requireElement<HTMLIFrameElement>('es-youtube-frame'),
    nasaFrameEl: requireElement<HTMLIFrameElement>('es-nasa-frame'),
    youtubeUrlInputEl: requireElement<HTMLInputElement>('es-youtube-url'),
    youtubeGridEl: requireElement<HTMLElement>('es-youtube-grid'),
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

  const personalInventory = createPersonalInventory(
    {
      rootEl: requireElement<HTMLElement>('personal-inventory'),
      searchEl: requireElement<HTMLInputElement>('personal-inventory-search'),
      capacityFillEl: requireElement<HTMLElement>('personal-inventory-capacity-fill'),
      capacityLabelEl: requireElement<HTMLElement>('personal-inventory-capacity-label'),
      filtersEl: requireElement<HTMLElement>('personal-inventory-filters'),
      gridEl: requireElement<HTMLElement>('personal-inventory-grid'),
      weaponBarsEl: requireElement<HTMLElement>('personal-inventory-weapon-bars'),
      gearSlotsEl: requireElement<HTMLElement>('personal-inventory-gear-slots'),
      statusEl: requireElement<HTMLElement>('personal-inventory-status'),
      quickEquipBtnEl: requireElement<HTMLButtonElement>('personal-inventory-quick-equip'),
      closeBtnEl: requireElement<HTMLButtonElement>('personal-inventory-close'),
    },
    {
      playerControls: controls,
      getInventory: () => inventoryState,
      onInventoryResult: (inventory) => {
        inventoryState = normalizeInventoryState(inventory);
        personalInventory.refresh();
        loopRef.loop?.setEquippedLoadout(inventoryState.loadout);
      },
    },
  );

  const weaponShop = createWeaponShop(
    {
      rootEl: requireElement<HTMLElement>('weapon-shop'),
      bezelEl: requireElement<HTMLElement>('weapon-shop-bezel'),
      listEl: requireElement<HTMLElement>('weapon-shop-list'),
      statusEl: requireElement<HTMLElement>('weapon-shop-status'),
      balanceEl: requireElement<HTMLElement>('weapon-shop-balance'),
      closeBtnEl: requireElement<HTMLButtonElement>('weapon-shop-close-btn'),
      powerBtnEl: requireElement<HTMLButtonElement>('weapon-shop-power-btn'),
    },
    {
      getArcBalance: () => arcBalance,
      getInventory: () => inventoryState,
      onPurchaseResult: (result) => {
        arcBalance = result.arcBalance;
        inventoryState = normalizeInventoryState(result.inventory);
        personalInventory.refresh();
      },
    },
  );

  const outfitters = createOutfitters(
    {
      rootEl: requireElement<HTMLElement>('outfitters'),
      bezelEl: requireElement<HTMLElement>('outfitters-bezel'),
      tabsEl: requireElement<HTMLElement>('outfitters-tabs'),
      listEl: requireElement<HTMLElement>('outfitters-list'),
      statusEl: requireElement<HTMLElement>('outfitters-status'),
      balanceEl: requireElement<HTMLElement>('outfitters-balance'),
      closeBtnEl: requireElement<HTMLButtonElement>('outfitters-close-btn'),
      powerBtnEl: requireElement<HTMLButtonElement>('outfitters-power-btn'),
    },
    {
      getArcBalance: () => arcBalance,
      getInventory: () => inventoryState,
      onPurchaseResult: (result) => {
        arcBalance = result.arcBalance;
        inventoryState = normalizeInventoryState(result.inventory);
        personalInventory.refresh();
      },
    },
  );

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
    spawn: spawnSurface ? 'surface' : 'station',
    planetId: planetDocument.id,
    systemId: systemDocument?.id ?? systemId,
    activeStationInstanceId: primaryStation?.id ?? null,
    controls,
    renderer,
    rendererError,
    network: networkClient,
    bootstrap,
    avmsTerminal,
    entertainmentSystem,
    weaponShop,
    outfitters,
    personalInventory,
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
      gameMenu.isPaused() ||
      avmsTerminal.isPaused() ||
      entertainmentSystem.isPaused() ||
      weaponShop.isPaused() ||
      outfitters.isPaused() ||
      personalInventory.isPaused() ||
      (buildTerminal?.isPaused() ?? false),
    getInventoryLoadout: () => inventoryState?.loadout ?? {},
    getInventory: () => inventoryState,
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
    gameMenu,
    avmsTerminal,
    entertainmentSystem,
    weaponShop,
    outfitters,
    personalInventory,
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
