import type { DebugSettingsController } from './debug_settings';
import type { SsaoSettings } from '../../../types';
import { resolveRenderQuality } from '../../main/domain/render_quality';
import {
  resetSsaoSettings,
  resolveSsaoSettings,
  saveSsaoSettings,
} from '../../main/domain/ssao_settings';

export interface DebugMenuElements {
  debugBtnEl: HTMLButtonElement;
  debugMenuEl: HTMLElement;
}

export interface DebugMenuCallbacks {
  onSsaoSettingsChange?: (settings: Partial<SsaoSettings>) => void;
}

export function createDebugMenu(
  elements: DebugMenuElements,
  debugSettings: DebugSettingsController,
  callbacks: DebugMenuCallbacks = {},
) {
  const toggles = Array.from(
    elements.debugMenuEl.querySelectorAll<HTMLInputElement>('input[data-debug-key]'),
  );
  const timeRadios = Array.from(
    elements.debugMenuEl.querySelectorAll<HTMLInputElement>('input[data-time-override]'),
  );
  const ssaoInputs = Array.from(
    elements.debugMenuEl.querySelectorAll<HTMLInputElement>('input[data-ssao-key]'),
  );
  const ssaoOutputs = Array.from(
    elements.debugMenuEl.querySelectorAll<HTMLElement>('[data-ssao-output]'),
  );
  const ssaoResetBtn = elements.debugMenuEl.querySelector<HTMLButtonElement>('[data-ssao-reset]');

  function resolveCurrentSsaoSettings(): SsaoSettings {
    return resolveSsaoSettings(resolveRenderQuality().ambientOcclusionIntensity);
  }

  function formatSsaoValue(key: keyof SsaoSettings, value: number): string {
    switch (key) {
      case 'aoRadius':
        return `${value.toFixed(2)}m`;
      case 'distanceFalloff':
        return value.toFixed(2);
      default:
        return value.toFixed(2);
    }
  }

  function setSsaoOutput(key: keyof SsaoSettings, value: number): void {
    const output = ssaoOutputs.find((item) => item.dataset.ssaoOutput === key);
    if (output) output.textContent = formatSsaoValue(key, value);
  }

  function syncSsaoControls(settings = resolveCurrentSsaoSettings()): void {
    for (const input of ssaoInputs) {
      const key = input.dataset.ssaoKey as keyof SsaoSettings | undefined;
      if (!key || !(key in settings)) continue;
      input.value = String(settings[key]);
      setSsaoOutput(key, settings[key]);
    }
  }

  function syncToggles(settings: ReturnType<DebugSettingsController['getSettings']>): void {
    for (const input of toggles) {
      const key = input.dataset.debugKey as keyof typeof settings | undefined;
      if (!key || !(key in settings)) continue;
      const value = settings[key];
      if (typeof value === 'boolean') {
        input.checked = value;
      }
    }
    for (const input of timeRadios) {
      input.checked = input.value === settings.timeOverride;
    }
  }

  debugSettings.subscribe((settings) => {
    syncToggles(settings);
  });
  syncSsaoControls();

  for (const input of toggles) {
    input.addEventListener('change', () => {
      const key = input.dataset.debugKey as
        | 'showStatsPanel'
        | 'showVegetationPanel'
        | 'showControlsReference'
        | 'showTutorialBanner'
        | undefined;
      if (!key) return;
      debugSettings.setSetting(key, input.checked);
    });
  }

  for (const input of timeRadios) {
    input.addEventListener('change', () => {
      if (!input.checked) return;
      const value = input.value;
      if (value === 'auto' || value === 'day' || value === 'night') {
        debugSettings.setSetting('timeOverride', value);
      }
    });
  }

  for (const input of ssaoInputs) {
    input.addEventListener('input', () => {
      const key = input.dataset.ssaoKey as keyof SsaoSettings | undefined;
      if (!key) return;
      const value = Number.parseFloat(input.value);
      if (!Number.isFinite(value)) return;
      const settings = { [key]: value } as Partial<SsaoSettings>;
      setSsaoOutput(key, value);
      saveSsaoSettings(settings);
      callbacks.onSsaoSettingsChange?.(settings);
    });
  }

  ssaoResetBtn?.addEventListener('click', () => {
    resetSsaoSettings();
    const settings = resolveCurrentSsaoSettings();
    syncSsaoControls(settings);
    callbacks.onSsaoSettingsChange?.(settings);
  });

  let open = false;

  function setOpen(next: boolean): void {
    open = next;
    elements.debugMenuEl.classList.toggle('is-open', open);
    elements.debugBtnEl.setAttribute('aria-expanded', open ? 'true' : 'false');
  }

  elements.debugBtnEl.addEventListener('click', (event) => {
    event.stopPropagation();
    setOpen(!open);
  });

  document.addEventListener('click', (event) => {
    if (!open) return;
    const target = event.target as Node;
    if (
      !elements.debugMenuEl.contains(target) &&
      !elements.debugBtnEl.contains(target)
    ) {
      setOpen(false);
    }
  });

  return {
    close() {
      setOpen(false);
    },
  };
}
