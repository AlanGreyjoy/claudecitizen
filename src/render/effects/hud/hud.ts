import type { WorldState } from '../../../player/world_state';
import { MODE_IN_SHIP } from '../../../player/modes';
import type { Planet, PlanetSurfaceSample, RenderStats, Vec3 } from '../../../types';
import { createChatPanel } from './chat_panel';
import { createDebugMenu } from './debug_menu';
import { createDebugSettings } from './debug_settings';
import { createFpsCounter } from './fps_counter';
import { createMinimap } from './minimap';
import { createStatsPanel } from './stats_panel';

export interface HudElements {
  fpsEl: HTMLElement;
  minimapCanvas: HTMLCanvasElement;
  chatMessagesEl: HTMLElement;
  chatInputEl: HTMLInputElement;
  debugBtnEl: HTMLButtonElement;
  debugMenuEl: HTMLElement;
  statsPanelEl: HTMLElement;
  vegetationMenuEl: HTMLElement;
  tutorialBannerEl: HTMLElement | null;
  promptEl: HTMLElement;
  readoutsEl: HTMLElement;
  statusEl: HTMLElement;
  controlsEl: HTMLElement;
  interactPromptEl: HTMLElement;
  screenFadeEl: HTMLElement;
}

export interface HudUpdateParams {
  world: WorldState;
  focusSurface: PlanetSurfaceSample;
  focusVelocity: Vec3;
  shipSurface: PlanetSurfaceSample;
  renderStats: RenderStats | null;
  rendererError: unknown;
  rendererMode: string | undefined;
  planet: Planet;
  isPointerLocked: boolean;
  seed: number;
  focusPosition: Vec3;
  focusForward: Vec3;
  shipPosition: Vec3;
  shipForward: Vec3;
  characterPosition: Vec3;
  nowMs: number;
}

export interface HudCallbacks {
  onTimeOverrideChange?: (mode: 'auto' | 'day' | 'night') => void;
}

export function createHud(
  elements: HudElements,
  planet: Planet,
  seed: number,
  callbacks: HudCallbacks = {},
) {
  const debugSettings = createDebugSettings();
  const fpsCounter = createFpsCounter(elements.fpsEl);
  const minimap = createMinimap(elements.minimapCanvas, planet, seed);
  createChatPanel(elements.chatMessagesEl, elements.chatInputEl);
  createDebugMenu(
    { debugBtnEl: elements.debugBtnEl, debugMenuEl: elements.debugMenuEl },
    debugSettings,
  );

  const statsPanel = createStatsPanel({
    promptEl: elements.promptEl,
    readoutsEl: elements.readoutsEl,
    statusEl: elements.statusEl,
  });

  debugSettings.subscribe((settings) => {
    debugSettings.applyVisibility({
      statsPanelEl: elements.statsPanelEl,
      vegetationMenuEl: elements.vegetationMenuEl,
      controlsEl: elements.controlsEl,
      tutorialBannerEl: elements.tutorialBannerEl,
    });
    callbacks.onTimeOverrideChange?.(settings.timeOverride);
  });

  window.addEventListener('resize', () => minimap.resize());

  function update(params: HudUpdateParams): void {
    fpsCounter.update(params.nowMs);

    const prompt = params.world.prompt;
    elements.interactPromptEl.textContent = prompt;
    elements.interactPromptEl.classList.toggle('is-visible', prompt.length > 0);
    elements.screenFadeEl.style.opacity = String(params.world.screenFade ?? 0);

    const showCharacter = params.world.mode !== MODE_IN_SHIP;
    minimap.update({
      planet: params.planet,
      seed: params.seed,
      focusPosition: params.focusPosition,
      focusForward: params.focusForward,
      shipPosition: params.shipPosition,
      shipForward: params.shipForward,
      characterPosition: params.characterPosition,
      showCharacter,
      nowMs: params.nowMs,
    });

    if (debugSettings.getSettings().showStatsPanel) {
      statsPanel.update(params);
    }
  }

  return {
    resetPeak() {
      statsPanel.resetPeak();
    },
    update,
  };
}
