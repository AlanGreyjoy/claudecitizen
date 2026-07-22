import type { WeaponFireMode } from '../../../player/inventory/types';

export interface CombatAmmoHudState {
  fireMode: WeaponFireMode;
  magazineSize: number;
  reserveRounds: number;
  roundsInMagazine: number;
}

export interface CombatAmmoHud {
  update(state: CombatAmmoHudState | null): void;
}

const FIRE_MODE_LABELS: Record<WeaponFireMode, string> = {
  auto: 'AUTO',
  bolt: 'BOLT',
  burst3: 'BURST',
  single: 'SEMI',
};

export function createCombatAmmoHud(rootEl: HTMLElement): CombatAmmoHud {
  const magazineEl = rootEl.querySelector<HTMLElement>('[data-combat-magazine]');
  const reserveEl = rootEl.querySelector<HTMLElement>('[data-combat-reserve]');
  const fireModeEl = rootEl.querySelector<HTMLElement>('[data-combat-fire-mode]');
  let lastKey = '';

  function update(state: CombatAmmoHudState | null): void {
    rootEl.classList.toggle('is-visible', state !== null);
    rootEl.setAttribute('aria-hidden', state ? 'false' : 'true');
    if (!state) {
      lastKey = '';
      return;
    }
    const key = `${state.roundsInMagazine}|${state.magazineSize}|${state.reserveRounds}|${state.fireMode}`;
    if (key === lastKey) return;
    lastKey = key;
    if (magazineEl) magazineEl.textContent = `${state.roundsInMagazine} / ${state.magazineSize}`;
    if (reserveEl) reserveEl.textContent = String(state.reserveRounds);
    if (fireModeEl) fireModeEl.textContent = FIRE_MODE_LABELS[state.fireMode];
  }

  return { update };
}
