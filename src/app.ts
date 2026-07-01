import { createPlayerControls } from './flight/player_controls';
import { createGameLoop } from './app/game_loop';
import { createHud } from './render/hud';
import { createSpikeRenderer, type SpikeRenderer } from './render/spike_renderer';
import { createVegetationControls } from './render/vegetation_controls';
import { CLAUDECITIZEN_PLANET } from './world/planet';

function requireElement<T extends HTMLElement>(id: string): T {
  const element = document.getElementById(id);
  if (!element) {
    throw new Error(`Missing required element #${id}`);
  }
  return element as T;
}

const canvas = requireElement<HTMLCanvasElement>('view');
const promptEl = requireElement<HTMLElement>('prompt');
const readoutsEl = requireElement<HTMLElement>('readouts');
const statusEl = requireElement<HTMLElement>('status');
const vegetationMenuEl = requireElement<HTMLElement>('vegetation-menu');
const vegetationResetEl = requireElement<HTMLElement>('vegetation-reset');

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

const hud = createHud({ promptEl, readoutsEl, statusEl });

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
