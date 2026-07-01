import { createPlayerControls } from './flight/player_controls';
import { createGameLoop } from './app/game_loop';
import { createHud } from './render/effects';
import { createSpikeRenderer, type SpikeRenderer } from './render/main';
import { createVegetationControls } from './render/vegetation';
import { CLAUDECITIZEN_PLANET } from './world/planet';

function requireElement<T extends HTMLElement>(id: string): T {
  const element = document.getElementById(id);
  if (!element) {
    throw new Error(`Missing required element #${id}`);
  }
  return element as T;
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

const seed = 20061;
const planet = CLAUDECITIZEN_PLANET;

let renderer: SpikeRenderer | null = null;
let rendererError: unknown = null;
try {
  renderer = createSpikeRenderer(canvas, planet, seed);
} catch (error) {
  rendererError = error;
  console.error('ClaudeCitizen renderer init failed.', error);
}

createVegetationControls(vegetationMenuEl, vegetationResetEl, renderer);

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
  },
  planet,
  seed,
);

let gameLoop: ReturnType<typeof createGameLoop>;

const controls = createPlayerControls(canvas, {
  onReset: () => gameLoop.resetWorld(),
});

gameLoop = createGameLoop({
  planet,
  seed,
  controls,
  renderer,
  rendererError,
  onHudUpdate: (params) => hud.update(params),
  onResetPeak: () => hud.resetPeak(),
});

function resize(): void {
  renderer?.resize(window.innerWidth, window.innerHeight);
}

window.addEventListener('resize', resize);
resize();

gameLoop.start();
