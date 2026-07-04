import { createPlayerControls } from '../flight/player_controls';
import { createGameLoop } from './game_loop';
import type { LoadingScreenHandle } from './loading_screen';
import { createHud } from '../render/effects';
import { createSpikeRenderer, type SpikeRenderer } from '../render/main';
import { createVegetationControls } from '../render/vegetation';
import { CLAUDECITIZEN_PLANET } from '../world/planet';
import { loadPrefabDocument } from '../world/prefabs/loader';
import { buildStationLayoutFromPrefab } from '../world/prefabs/station_runtime';
import { applyDefaultShipPrefab } from '../world/ships';
import { setStationLayoutOverride } from '../world/station';
import type { PrefabDocument } from '../world/prefabs/schema';
import {
  fetchGameBootstrap,
  getSession,
  type AuthSession,
  type GameBootstrap,
} from '../net/api';
import { createWorldClient, type WorldClient } from '../net/world_client';

function requireElement<T extends HTMLElement>(id: string): T {
  const element = document.getElementById(id);
  if (!element) {
    throw new Error(`Missing required element #${id}`);
  }
  return element as T;
}

/**
 * Dev-only station prefab preview (?stationPrefab=<id>): loads the prefab,
 * activates its gameplay layout, and returns the document for the renderer.
 * The default path (no param, or production) leaves the procedural station
 * untouched.
 */
async function resolveStationPrefabPreview(): Promise<PrefabDocument | null> {
  if (!import.meta.env.DEV) return null;
  const id = new URLSearchParams(window.location.search).get('stationPrefab');
  if (!id) return null;

  const doc = await loadPrefabDocument(id);
  if (!doc) {
    console.warn(`Station prefab "${id}" not found; using the procedural station.`);
    return null;
  }
  const layout = buildStationLayoutFromPrefab(doc);
  if (!layout) {
    console.warn(`Station prefab "${id}" is not walkable; using the procedural station.`);
    return null;
  }
  setStationLayoutOverride(layout);
  console.info(`Station prefab preview active: "${id}".`);
  return doc;
}

/** Dev preview affordance: banner + button that jumps back into the editor with the prefab open. */
function mountEditorReturnButton(prefabId: string): void {
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
}

let started = false;

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
  const stationPrefab = await resolveStationPrefabPreview();
  loading?.setProgress(0.15);

  document.getElementById('title-screen')?.classList.add('is-hidden');
  if (stationPrefab) mountEditorReturnButton(stationPrefab.id);

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
  const screenFadeEl = requireElement<HTMLElement>('screen-fade');

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

  createVegetationControls(vegetationMenuEl, vegetationResetEl, renderer);

  let networkClient: WorldClient | null = null;

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
      screenFadeEl,
    },
    planet,
    seed,
    {
      onChatSend: (text) => networkClient?.sendChat(text),
      onTimeOverrideChange: (mode) => renderer?.setTimeOverride(mode),
    },
  );

  if (bootstrap) {
    loading?.setStatus('Opening relay link...');
    networkClient = createWorldClient({
      bootstrap,
      onChatMessage: (message) => hud.appendChatMessage(message.author, message.text),
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

  let gameLoop: ReturnType<typeof createGameLoop>;

  const controls = createPlayerControls(canvas, {
    onReset: () => gameLoop.resetWorld(),
  });
  loading?.setProgress(0.75);

  gameLoop = createGameLoop({
    planet,
    seed,
    controls,
    renderer,
    rendererError,
    network: networkClient,
    bootstrap,
    onHudUpdate: (params) => hud.update(params),
    onResetPeak: () => hud.resetPeak(),
  });

  function resize(): void {
    renderer?.resize(window.innerWidth, window.innerHeight);
  }

  window.addEventListener('resize', resize);
  resize();

  loading?.setProgress(0.95);
  gameLoop.start();

  if (loading) {
    await loading.complete();
    loading.hide();
  }
  requireElement<HTMLElement>('app').classList.remove('is-hidden');
}
