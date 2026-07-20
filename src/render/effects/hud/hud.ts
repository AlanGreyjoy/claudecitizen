import type { WorldState } from '../../../player/world_state';
import type { Planet, PlanetSurfaceSample, RenderStats, SsaoSettings, Vec3 } from '../../../types';
import { createChatPanel } from './chat_panel';
import { createDebugMenu } from './debug_menu';
import { createDebugSettings } from './debug_settings';
import { createFpsCounter } from './fps_counter';
import { createStatsPanel } from './stats_panel';
import { createFlightReticle } from './flight_reticle';
import { createCockpitGazeHud } from './cockpit_gaze_hud';
import {
  createCockpitSpeedHud,
  type CockpitSpeedInstrumentUpdate,
} from './cockpit_speed_hud';
import { createSurvivalVitalsHud } from './survival_vitals_hud';

export interface HudElements {
  fpsEl: HTMLElement;
  chatMessagesEl: HTMLElement;
  chatInputEl: HTMLInputElement;
  debugBtnEl: HTMLButtonElement;
  debugMenuEl: HTMLElement;
  statsPanelEl: HTMLElement;
  tutorialBannerEl: HTMLElement | null;
  promptEl: HTMLElement;
  readoutsEl: HTMLElement;
  statusEl: HTMLElement;
  controlsEl: HTMLElement;
  interactPromptEl: HTMLElement;
  screenFadeEl: HTMLElement;
  flightReticleEl: HTMLElement;
  weaponCrosshairEl: HTMLElement;
  cockpitGazeEl: HTMLElement;
  cockpitSpeedEl: HTMLElement;
  survivalVitalsEl: HTMLElement;
  vitalsSyncWarningEl: HTMLElement;
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
  nowMs: number;
  weaponCrosshairVisible: boolean;
  flightDual?: {
    aimOffsetPx: { x: number; y: number };
    noseOffsetPx: { x: number; y: number };
    coupled: boolean;
  };
  cockpitGaze?: {
    visible: boolean;
    label?: string;
    offsetPx?: { x: number; y: number };
  };
  cockpitSpeed?: {
    visible: boolean;
    instruments?: readonly CockpitSpeedInstrumentUpdate[];
  };
}

export interface HudCallbacks {
  onTimeOverrideChange?: (mode: 'auto' | 'day' | 'night') => void;
  onChatSend?: (text: string) => void;
  onSsaoSettingsChange?: (settings: Partial<SsaoSettings>) => void;
  onVegetationLayersChange?: (layers: { grass: boolean; trees: boolean }) => void;
}

export function createHud(
  elements: HudElements,
  callbacks: HudCallbacks = {},
) {
  const debugSettings = createDebugSettings();
  const fpsCounter = createFpsCounter(elements.fpsEl);
  const chatPanel = createChatPanel(elements.chatMessagesEl, elements.chatInputEl, {
    onSendMessage: callbacks.onChatSend,
  });
  createDebugMenu(
    { debugBtnEl: elements.debugBtnEl, debugMenuEl: elements.debugMenuEl },
    debugSettings,
    {
      onSsaoSettingsChange: callbacks.onSsaoSettingsChange,
    },
  );

  const statsPanel = createStatsPanel({
    promptEl: elements.promptEl,
    readoutsEl: elements.readoutsEl,
    statusEl: elements.statusEl,
  });
  const flightReticle = createFlightReticle({ rootEl: elements.flightReticleEl });
  elements.weaponCrosshairEl.classList.remove('is-visible');
  const cockpitGazeHud = createCockpitGazeHud({ rootEl: elements.cockpitGazeEl });
  const cockpitSpeedHud = createCockpitSpeedHud({ rootEl: elements.cockpitSpeedEl });
  const survivalVitalsHud = createSurvivalVitalsHud(elements.survivalVitalsEl);

  debugSettings.subscribe((settings) => {
    debugSettings.applyVisibility({
      statsPanelEl: elements.statsPanelEl,
      controlsEl: elements.controlsEl,
      tutorialBannerEl: elements.tutorialBannerEl,
    });
    callbacks.onTimeOverrideChange?.(settings.timeOverride);
    callbacks.onVegetationLayersChange?.({
      grass: settings.renderGrass,
      trees: settings.renderTrees,
    });
  });

  function update(params: HudUpdateParams): void {
    fpsCounter.update(params.nowMs);

    const prompt = params.world.prompt;
    elements.interactPromptEl.textContent = prompt;
    elements.interactPromptEl.classList.toggle('is-visible', prompt.length > 0);
    elements.screenFadeEl.style.opacity = String(params.world.screenFade ?? 0);

    flightReticle.update({
      mode: params.world.mode,
      flightMode: params.world.flightMode,
      quantum: params.world.quantum,
      dual: params.flightDual,
    });
    elements.weaponCrosshairEl.classList.toggle(
      'is-visible',
      params.weaponCrosshairVisible,
    );
    cockpitGazeHud.update(
      params.cockpitGaze ?? { visible: false },
    );
    cockpitSpeedHud.update(
      params.cockpitSpeed ?? { visible: false },
    );
    survivalVitalsHud.update(params.world.vitals);
    elements.vitalsSyncWarningEl.textContent = params.world.vitalsSyncLocked
      ? 'Vitals sync unavailable · Apartment exits locked'
      : '';
    elements.vitalsSyncWarningEl.classList.toggle(
      'is-visible',
      params.world.vitalsSyncLocked,
    );

    if (debugSettings.getSettings().showStatsPanel) {
      statsPanel.update(params);
    }
  }

  return {
    appendChatMessage(author: string, text: string) {
      chatPanel.appendMessage(author, text);
    },
    resetPeak() {
      statsPanel.resetPeak();
    },
    update,
  };
}
