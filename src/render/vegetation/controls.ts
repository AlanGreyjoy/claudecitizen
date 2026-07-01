import {
  DEFAULT_VEGETATION_SETTINGS,
  normalizeVegetationSettings,
} from './settings';
import type { SpikeRenderer } from '../main';
import type { FogSettings, VegetationLayerSettings, VegetationSettings } from '../../types';

const DEFAULT_FOG_SETTINGS: FogSettings = {
  density: 0.006,
  maxHeight: 4000,
  heightFalloff: 350,
  noiseStrength: 0.4,
};

const vegetationValueFormatters: Record<string, (value: number) => string> = {
  'grass.density': (value) => `${value.toFixed(2)}x`,
  'grass.gapMeters': (value) => `${value.toFixed(2)} m`,
  'grass.minScale': (value) => `${value.toFixed(2)}x`,
  'grass.maxScale': (value) => `${value.toFixed(2)}x`,
  'tree.density': (value) => `${value.toFixed(2)}x`,
  'tree.gapMeters': (value) => `${value.toFixed(1)} m`,
  'tree.minScale': (value) => `${value.toFixed(2)}x`,
  'tree.maxScale': (value) => `${value.toFixed(2)}x`,
  'fog.density': (value) => `${(value * 1000).toFixed(1)}k`,
  'fog.maxHeight': (value) => `${value.toFixed(0)} m`,
  'fog.heightFalloff': (value) => `${value.toFixed(0)} m`,
  'fog.noiseStrength': (value) => `${(value * 100).toFixed(0)}%`,
};

type VegetationGroup = keyof VegetationSettings | 'fog';

function vegetationSettingPath(group: VegetationGroup, key: string): string {
  return `${group}.${key}`;
}

export function createVegetationControls(
  menuEl: HTMLElement,
  resetEl: HTMLElement,
  renderer: SpikeRenderer | null,
) {
  const inputEls = Array.from(
    menuEl.querySelectorAll<HTMLInputElement>('input[data-group][data-key]'),
  );
  const outputEls = new Map<string, HTMLElement>(
    Array.from(menuEl.querySelectorAll<HTMLElement>('[data-output]')).map((element) => [
      element.dataset.output!,
      element,
    ]),
  );

  let fogSettings: FogSettings = { ...DEFAULT_FOG_SETTINGS };
  let vegetationSettings: VegetationSettings = normalizeVegetationSettings(DEFAULT_VEGETATION_SETTINGS);
  let vegetationSettingsFrame = 0;

  function renderControls(): void {
    inputEls.forEach((input) => {
      const group = input.dataset.group as VegetationGroup;
      const key = input.dataset.key!;
      const value =
        group === 'fog'
          ? fogSettings[key as keyof FogSettings]
          : vegetationSettings[group][key as keyof VegetationLayerSettings];
      input.value = String(value);
      const output = outputEls.get(vegetationSettingPath(group, key));
      if (!output) return;
      const formatter =
        vegetationValueFormatters[vegetationSettingPath(group, key)] ??
        ((nextValue: number) => String(nextValue));
      output.textContent = formatter(value);
    });
  }

  function scheduleVegetationSettingsApply(): void {
    if (vegetationSettingsFrame) return;
    vegetationSettingsFrame = requestAnimationFrame(() => {
      vegetationSettingsFrame = 0;
      renderer?.setVegetationSettings(vegetationSettings);
    });
  }

  function updateSetting(group: VegetationGroup, key: string, value: number): void {
    if (group === 'fog') {
      fogSettings[key as keyof FogSettings] = value;
      renderControls();
      renderer?.setFogSettings(fogSettings);
      return;
    }

    const nextSettings: VegetationSettings = {
      ...vegetationSettings,
      [group]: {
        ...vegetationSettings[group],
        [key]: value,
      },
    };

    if (key === 'minScale' && value > nextSettings[group].maxScale) {
      nextSettings[group].maxScale = value;
    } else if (key === 'maxScale' && value < nextSettings[group].minScale) {
      nextSettings[group].minScale = value;
    }

    vegetationSettings = normalizeVegetationSettings(nextSettings);
    renderControls();
    scheduleVegetationSettingsApply();
  }

  const onInput = (event: Event) => {
    const input = event.currentTarget as HTMLInputElement;
    const nextValue = Number.parseFloat(input.value);
    if (!Number.isFinite(nextValue)) return;
    updateSetting(input.dataset.group as VegetationGroup, input.dataset.key!, nextValue);
  };

  const onReset = () => {
    vegetationSettings = normalizeVegetationSettings(DEFAULT_VEGETATION_SETTINGS);
    fogSettings = { ...DEFAULT_FOG_SETTINGS };
    renderControls();
    scheduleVegetationSettingsApply();
    renderer?.setFogSettings(fogSettings);
  };

  inputEls.forEach((input) => input.addEventListener('input', onInput));
  resetEl.addEventListener('click', onReset);

  renderControls();
  renderer?.setVegetationSettings(vegetationSettings);
  renderer?.setFogSettings(fogSettings);

  return {
    dispose() {
      inputEls.forEach((input) => input.removeEventListener('input', onInput));
      resetEl.removeEventListener('click', onReset);
      if (vegetationSettingsFrame) {
        cancelAnimationFrame(vegetationSettingsFrame);
        vegetationSettingsFrame = 0;
      }
    },
  };
}
