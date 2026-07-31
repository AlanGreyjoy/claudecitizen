import {
  applyAmbientOcclusion,
  applyRenderQuality,
  applyShadowQualitySetting,
  loadGameSettings,
  saveGameSettings,
  type CloudModeSetting,
  type GameSettings,
} from '../../../settings/game-settings';
import type {
  RenderQualityPreset,
  ShadowQualitySetting,
} from '../../main/domain/render-quality';
import { createGameMenuControls } from './game-menu-controls';

export interface GameMenuElements {
  rootEl: HTMLElement;
  resumeBtnEl: HTMLButtonElement;
  exitBtnEl: HTMLButtonElement;
  chatInputEl: HTMLInputElement;
  masterVolumeEl: HTMLInputElement;
  sfxVolumeEl: HTMLInputElement;
  musicVolumeEl: HTMLInputElement;
  masterValueEl: HTMLElement;
  sfxValueEl: HTMLElement;
  musicValueEl: HTMLElement;
}

export interface GameMenuCallbacks {
  onExitGame: () => void;
}

type GameMenuTab = 'video' | 'audio' | 'controls' | 'exit';

function isTypingTarget(target: EventTarget | null): boolean {
  if (!(target instanceof HTMLElement)) return false;
  return (
    target.tagName === 'INPUT' ||
    target.tagName === 'SELECT' ||
    target.tagName === 'TEXTAREA' ||
    target.isContentEditable
  );
}

function formatPercent(value: number): string {
  return `${Math.round(value * 100)}%`;
}

export function createGameMenu(elements: GameMenuElements, callbacks: GameMenuCallbacks) {
  let open = false;
  let activeTab: GameMenuTab = 'video';
  let settings: GameSettings = loadGameSettings();

  const navButtons = Array.from(
    elements.rootEl.querySelectorAll<HTMLButtonElement>('[data-game-menu-tab]'),
  );
  const panels = Array.from(
    elements.rootEl.querySelectorAll<HTMLElement>('[data-game-menu-panel]'),
  );
  const controlsRoot =
    elements.rootEl.querySelector<HTMLElement>('[data-orig-id="game-menu-controls"]') ??
    elements.rootEl.querySelector<HTMLElement>('#game-menu-controls');
  const qualityInputs = Array.from(
    elements.rootEl.querySelectorAll<HTMLInputElement>(
      'input[name="game-menu-quality"], input[name="ed-preview-game-menu-quality"]',
    ),
  );
  const shadowInputs = Array.from(
    elements.rootEl.querySelectorAll<HTMLInputElement>(
      'input[name="game-menu-shadows"], input[name="ed-preview-game-menu-shadows"]',
    ),
  );
  const cloudModeInputs = Array.from(
    elements.rootEl.querySelectorAll<HTMLInputElement>(
      'input[name="game-menu-clouds"], input[name="ed-preview-game-menu-clouds"]',
    ),
  );
  const ambientOcclusionInput =
    elements.rootEl.querySelector<HTMLInputElement>(
      '[data-orig-id="game-menu-ambient-occlusion"]',
    ) ?? elements.rootEl.querySelector<HTMLInputElement>('#game-menu-ambient-occlusion');
  const grassDistanceInput =
    elements.rootEl.querySelector<HTMLInputElement>(
      '[data-orig-id="game-menu-grass-distance"]',
    ) ?? elements.rootEl.querySelector<HTMLInputElement>('#game-menu-grass-distance');
  const grassDistanceValueEl =
    elements.rootEl.querySelector<HTMLElement>(
      '[data-orig-id="game-menu-grass-distance-value"]',
    ) ?? elements.rootEl.querySelector<HTMLElement>('#game-menu-grass-distance-value');

  const controls = createGameMenuControls({
    controlsRoot,
    getSettings: () => settings,
    saveSettings: (next) => {
      settings = saveGameSettings(next);
      return settings;
    },
    getActiveTab: () => activeTab,
    isOpen: () => open,
  });

  function syncQualityRadios(): void {
    for (const input of qualityInputs) {
      input.checked = input.value === settings.renderQuality;
    }
  }

  function syncShadowRadios(): void {
    for (const input of shadowInputs) {
      input.checked = input.value === settings.shadowQuality;
    }
  }

  function syncCloudModeRadios(): void {
    for (const input of cloudModeInputs) {
      input.checked = input.value === settings.cloudMode;
    }
  }

  function syncAmbientOcclusion(): void {
    if (ambientOcclusionInput) ambientOcclusionInput.checked = settings.ambientOcclusion;
  }

  function syncGrassDistance(): void {
    if (grassDistanceInput) {
      grassDistanceInput.value = String(settings.grassRenderDistanceMeters);
    }
    if (grassDistanceValueEl) {
      grassDistanceValueEl.textContent = `${settings.grassRenderDistanceMeters} m`;
    }
  }

  function syncAudioControls(): void {
    elements.masterVolumeEl.value = String(Math.round(settings.masterVolume * 100));
    elements.sfxVolumeEl.value = String(Math.round(settings.sfxVolume * 100));
    elements.musicVolumeEl.value = String(Math.round(settings.musicVolume * 100));
    elements.masterValueEl.textContent = formatPercent(settings.masterVolume);
    elements.sfxValueEl.textContent = formatPercent(settings.sfxVolume);
    elements.musicValueEl.textContent = formatPercent(settings.musicVolume);
  }

  function setActiveTab(tab: GameMenuTab): void {
    activeTab = tab;
    for (const button of navButtons) {
      button.classList.toggle('is-active', button.dataset.gameMenuTab === tab);
    }
    for (const panel of panels) {
      panel.classList.toggle('is-active', panel.dataset.gameMenuPanel === tab);
    }
    if (tab === 'controls') controls.renderControlsPanel();
  }

  function setOpen(next: boolean): void {
    if (open === next) return;
    open = next;
    elements.rootEl.classList.toggle('is-open', open);
    elements.rootEl.setAttribute('aria-hidden', open ? 'false' : 'true');
    if (open) {
      document.exitPointerLock?.();
      syncQualityRadios();
      syncShadowRadios();
      syncCloudModeRadios();
      syncAmbientOcclusion();
      syncGrassDistance();
      syncAudioControls();
      controls.renderControlsPanel();
      controls.startTelemetry();
      elements.resumeBtnEl.focus();
      return;
    }
    controls.cancelCapture();
    controls.stopAxisPreview();
    controls.stopTelemetry();
    elements.rootEl.blur();
  }

  function toggleOpen(): void {
    setOpen(!open);
  }

  function updateAudioSetting(
    key: 'masterVolume' | 'sfxVolume' | 'musicVolume',
    percent: number,
  ): void {
    settings = saveGameSettings({
      ...settings,
      [key]: percent / 100,
    });
    syncAudioControls();
  }

  for (const button of navButtons) {
    button.addEventListener('click', () => {
      const tab = button.dataset.gameMenuTab as GameMenuTab | undefined;
      if (!tab) return;
      setActiveTab(tab);
    });
  }

  // Every video setting applies live; the renderer listens for the
  // settings-changed event and rebuilds only what the change actually touches.
  // Each handler must write the result back to `settings` — the equality guards
  // below read it, and nothing reloads the page to refresh it any more.
  for (const input of qualityInputs) {
    input.addEventListener('change', () => {
      if (!input.checked) return;
      const preset = input.value as RenderQualityPreset;
      if (preset === settings.renderQuality) return;
      settings = applyRenderQuality(preset);
    });
  }

  for (const input of shadowInputs) {
    input.addEventListener('change', () => {
      if (!input.checked) return;
      const shadowQuality = input.value as ShadowQualitySetting;
      if (shadowQuality === settings.shadowQuality) return;
      settings = applyShadowQualitySetting(shadowQuality);
    });
  }

  for (const input of cloudModeInputs) {
    input.addEventListener('change', () => {
      if (!input.checked) return;
      const cloudMode = input.value as CloudModeSetting;
      if (cloudMode === settings.cloudMode) return;
      settings = saveGameSettings({ ...settings, cloudMode });
    });
  }

  ambientOcclusionInput?.addEventListener('change', () => {
    if (ambientOcclusionInput.checked === settings.ambientOcclusion) return;
    settings = applyAmbientOcclusion(ambientOcclusionInput.checked);
  });


  grassDistanceInput?.addEventListener('input', () => {
    const meters = Number.parseInt(grassDistanceInput.value, 10);
    if (!Number.isFinite(meters) || meters === settings.grassRenderDistanceMeters) {
      syncGrassDistance();
      return;
    }
    settings = saveGameSettings({ ...settings, grassRenderDistanceMeters: meters });
    syncGrassDistance();
  });

  elements.masterVolumeEl.addEventListener('input', () => {
    updateAudioSetting('masterVolume', Number.parseInt(elements.masterVolumeEl.value, 10));
  });
  elements.sfxVolumeEl.addEventListener('input', () => {
    updateAudioSetting('sfxVolume', Number.parseInt(elements.sfxVolumeEl.value, 10));
  });
  elements.musicVolumeEl.addEventListener('input', () => {
    updateAudioSetting('musicVolume', Number.parseInt(elements.musicVolumeEl.value, 10));
  });

  elements.resumeBtnEl.addEventListener('click', () => setOpen(false));
  elements.exitBtnEl.addEventListener('click', () => {
    setOpen(false);
    callbacks.onExitGame();
  });

  const handleKeyDown = (event: KeyboardEvent) => {
    if (controls.isCapturingControls()) return;
    if (event.key !== 'Escape') return;
    if (open) {
      event.preventDefault();
      event.stopPropagation();
      setOpen(false);
      return;
    }
    if (isTypingTarget(event.target) && event.target !== elements.chatInputEl) return;
    if (event.target === elements.chatInputEl) return;
    event.preventDefault();
    event.stopPropagation();
    setOpen(true);
  };

  window.addEventListener('keydown', handleKeyDown, true);

  syncQualityRadios();
  syncCloudModeRadios();
  syncAmbientOcclusion();
  syncGrassDistance();
  syncAudioControls();
  controls.renderControlsPanel();

  return {
    dispose() {
      window.removeEventListener('keydown', handleKeyDown, true);
      controls.cancelCapture();
      controls.stopAxisPreview();
      controls.stopTelemetry();
    },
    isOpen() {
      return open;
    },
    isPaused() {
      return open;
    },
    close() {
      setOpen(false);
    },
    open() {
      setOpen(true);
    },
    toggle: toggleOpen,
  };
}

export type GameMenuController = ReturnType<typeof createGameMenu>;
