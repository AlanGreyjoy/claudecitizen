import type { PlayerSurvivalVitals } from '../../../player/vitals';
import { createUiIcon, UiIcons, type UiIconNode } from '../../../ui/icons';

interface SurvivalMeter {
  fillEl: HTMLElement;
  progressEl: HTMLElement;
  valueEl: HTMLElement;
}

function clamp01(value: number): number {
  return Math.min(1, Math.max(0, value));
}

function createMeter(
  rootEl: HTMLElement,
  label: string,
  kind: 'hunger' | 'thirst',
  icon: UiIconNode,
): SurvivalMeter {
  const row = document.createElement('div');
  row.className = `sc-survival-meter sc-survival-meter-${kind}`;

  const labelEl = document.createElement('div');
  labelEl.className = 'sc-survival-meter-label';
  labelEl.append(
    createUiIcon(icon, {
      className: 'sc-survival-meter-icon sc-ui-icon',
      size: 16,
      strokeWidth: 1.8,
    }),
  );
  const labelText = document.createElement('span');
  labelText.textContent = label;
  labelEl.append(labelText);

  const valueEl = document.createElement('span');
  valueEl.className = 'sc-survival-meter-value';

  const progressEl = document.createElement('div');
  progressEl.className = 'sc-survival-meter-track';
  progressEl.setAttribute('role', 'progressbar');
  progressEl.setAttribute('aria-label', `${label} reserve`);
  progressEl.setAttribute('aria-valuemin', '0');
  progressEl.setAttribute('aria-valuemax', '100');

  const fillEl = document.createElement('span');
  fillEl.className = 'sc-survival-meter-fill';
  progressEl.append(fillEl);
  row.append(labelEl, valueEl, progressEl);
  rootEl.append(row);
  return { fillEl, progressEl, valueEl };
}

export function createSurvivalVitalsHud(rootEl: HTMLElement) {
  rootEl.replaceChildren();
  rootEl.classList.remove('is-hidden');
  const hunger = createMeter(rootEl, 'Hunger', 'hunger', UiIcons.utensils);
  const thirst = createMeter(rootEl, 'Thirst', 'thirst', UiIcons.droplets);

  function updateMeter(meter: SurvivalMeter, value01: number): void {
    const value = clamp01(value01);
    const percent = Math.round(value * 100);
    meter.fillEl.style.width = `${percent}%`;
    meter.valueEl.textContent = `${percent}%`;
    meter.progressEl.setAttribute('aria-valuenow', String(percent));
    meter.progressEl.parentElement?.classList.toggle('is-warning', value < 0.25);
  }

  function update(vitals: PlayerSurvivalVitals): void {
    updateMeter(hunger, vitals.hungerReserve01);
    updateMeter(thirst, vitals.thirstReserve01);
  }

  return { update };
}
