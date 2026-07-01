export interface DebugSettings {
  debugEnabled: boolean;
  showStatsPanel: boolean;
  showVegetationPanel: boolean;
  showControlsReference: boolean;
  showTutorialBanner: boolean;
}

const STORAGE_KEY = 'claudecitizen-debug-settings';

const DEFAULT_SETTINGS: DebugSettings = {
  debugEnabled: false,
  showStatsPanel: false,
  showVegetationPanel: false,
  showControlsReference: false,
  showTutorialBanner: false,
};

const DEBUG_BOOT_SETTINGS: DebugSettings = {
  debugEnabled: true,
  showStatsPanel: true,
  showVegetationPanel: true,
  showControlsReference: true,
  showTutorialBanner: false,
};

function parseUrlDebug(): boolean {
  return new URLSearchParams(window.location.search).get('debug') === '1';
}

function loadStoredSettings(): DebugSettings | null {
  const raw = sessionStorage.getItem(STORAGE_KEY);
  if (!raw) return null;
  try {
    return { ...DEFAULT_SETTINGS, ...JSON.parse(raw) } as DebugSettings;
  } catch {
    return null;
  }
}

function persistSettings(settings: DebugSettings): void {
  sessionStorage.setItem(STORAGE_KEY, JSON.stringify(settings));
}

export function createDebugSettings() {
  let settings: DebugSettings = parseUrlDebug()
    ? { ...DEBUG_BOOT_SETTINGS }
    : loadStoredSettings() ?? { ...DEFAULT_SETTINGS };

  const listeners = new Set<(settings: DebugSettings) => void>();

  function notify(): void {
    persistSettings(settings);
    for (const listener of listeners) {
      listener(settings);
    }
  }

  function getSettings(): DebugSettings {
    return { ...settings };
  }

  function setSetting<K extends keyof DebugSettings>(key: K, value: DebugSettings[K]): void {
    settings = { ...settings, [key]: value };
    notify();
  }

  function subscribe(listener: (settings: DebugSettings) => void): () => void {
    listeners.add(listener);
    listener(getSettings());
    return () => listeners.delete(listener);
  }

  return {
    getSettings,
    setSetting,
    subscribe,
    applyVisibility(elements: {
      statsPanelEl: HTMLElement;
      vegetationMenuEl: HTMLElement;
      controlsEl: HTMLElement;
      tutorialBannerEl: HTMLElement | null;
    }): void {
      const { showStatsPanel, showVegetationPanel, showControlsReference, showTutorialBanner } =
        settings;
      elements.statsPanelEl.classList.toggle('is-visible', showStatsPanel);
      elements.vegetationMenuEl.classList.toggle('is-visible', showVegetationPanel);
      elements.controlsEl.classList.toggle('is-visible', showControlsReference);
      if (elements.tutorialBannerEl) {
        elements.tutorialBannerEl.classList.toggle('is-visible', showTutorialBanner);
      }
    },
  };
}

export type DebugSettingsController = ReturnType<typeof createDebugSettings>;
