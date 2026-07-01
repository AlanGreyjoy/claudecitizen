import type { DebugSettingsController } from './debug_settings';

export interface DebugMenuElements {
  debugBtnEl: HTMLButtonElement;
  debugMenuEl: HTMLElement;
}

export function createDebugMenu(
  elements: DebugMenuElements,
  debugSettings: DebugSettingsController,
) {
  const toggles = Array.from(
    elements.debugMenuEl.querySelectorAll<HTMLInputElement>('input[data-debug-key]'),
  );

  function syncToggles(settings: ReturnType<DebugSettingsController['getSettings']>): void {
    for (const input of toggles) {
      const key = input.dataset.debugKey as keyof typeof settings | undefined;
      if (key && key in settings) {
        input.checked = settings[key];
      }
    }
  }

  debugSettings.subscribe((settings) => {
    syncToggles(settings);
  });

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
