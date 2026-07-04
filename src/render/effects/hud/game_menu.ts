import {
  applyRenderQualityAndReload,
  loadGameSettings,
  saveGameSettings,
  type GameSettings,
} from '../../../app/game_settings';
import type { RenderQualityPreset } from '../../main/domain/render_quality';

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
  let settings: GameSettings = loadGameSettings();

  const navButtons = Array.from(
    elements.rootEl.querySelectorAll<HTMLButtonElement>('[data-game-menu-tab]'),
  );
  const panels = Array.from(
    elements.rootEl.querySelectorAll<HTMLElement>('[data-game-menu-panel]'),
  );
  const qualityInputs = Array.from(
    elements.rootEl.querySelectorAll<HTMLInputElement>('input[name="game-menu-quality"]'),
  );

  function syncQualityRadios(): void {
    for (const input of qualityInputs) {
      input.checked = input.value === settings.renderQuality;
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
    for (const button of navButtons) {
      button.classList.toggle('is-active', button.dataset.gameMenuTab === tab);
    }
    for (const panel of panels) {
      panel.classList.toggle('is-active', panel.dataset.gameMenuPanel === tab);
    }
  }

  function setOpen(next: boolean): void {
    if (open === next) return;
    open = next;
    elements.rootEl.classList.toggle('is-open', open);
    elements.rootEl.setAttribute('aria-hidden', open ? 'false' : 'true');
    if (open) {
      document.exitPointerLock?.();
      syncQualityRadios();
      syncAudioControls();
      elements.resumeBtnEl.focus();
      return;
    }
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

  for (const input of qualityInputs) {
    input.addEventListener('change', () => {
      if (!input.checked) return;
      const preset = input.value as RenderQualityPreset;
      if (preset === settings.renderQuality) return;
      applyRenderQualityAndReload(preset);
    });
  }

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
  syncAudioControls();

  return {
    dispose() {
      window.removeEventListener('keydown', handleKeyDown, true);
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
