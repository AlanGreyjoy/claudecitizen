import type { WeaponFireMode } from './inventory/types';

export const WEAPON_RELOAD_SECONDS = 1.5;
export const WEAPON_BOLT_DELAY_SECONDS = 0.65;
export const MAX_WEAPON_SHOTS_PER_TICK = 8;

export interface WeaponFireConfig {
  fireModes: readonly WeaponFireMode[];
  magazineSize: number;
  roundsPerMinute: number;
  weaponId: string;
}

export interface WeaponFireState {
  burstRoundsRemaining: number;
  cooldownSeconds: number;
  dryFireLatched: boolean;
  fireModeIndex: number;
  fireModes: WeaponFireMode[];
  magazineSize: number;
  reloadRequestPending: boolean;
  reloadSecondsRemaining: number;
  reloading: boolean;
  roundsInMagazine: number;
  roundsPerMinute: number;
  weaponId: string;
}

export interface WeaponFireInput {
  cycleModePressed: boolean;
  deltaSeconds: number;
  reloadPressed: boolean;
  reserveRounds: number;
  triggerHeld: boolean;
  triggerPressed: boolean;
}

export type WeaponFireEvent =
  | { type: 'shot'; fireMode: WeaponFireMode; weaponId: string }
  | { type: 'dry-fire'; weaponId: string }
  | { type: 'fire-mode-changed'; fireMode: WeaponFireMode; weaponId: string }
  | { type: 'reload-started'; weaponId: string }
  | { type: 'reload-request'; quantity: number; weaponId: string };

function normalizedMagazineSize(value: number): number {
  return Math.max(1, Math.floor(value));
}

function normalizedRoundsPerMinute(value: number): number {
  return Math.max(1, value);
}

export function createWeaponFireState(config: WeaponFireConfig): WeaponFireState {
  const magazineSize = normalizedMagazineSize(config.magazineSize);
  return {
    burstRoundsRemaining: 0,
    cooldownSeconds: 0,
    dryFireLatched: false,
    fireModeIndex: 0,
    fireModes: config.fireModes.length > 0 ? [...config.fireModes] : ['single'],
    magazineSize,
    reloadRequestPending: false,
    reloadSecondsRemaining: 0,
    reloading: false,
    // Magazines are session-local in this phase and start full on first draw.
    roundsInMagazine: magazineSize,
    roundsPerMinute: normalizedRoundsPerMinute(config.roundsPerMinute),
    weaponId: config.weaponId,
  };
}

export function currentWeaponFireMode(state: WeaponFireState): WeaponFireMode {
  return state.fireModes[state.fireModeIndex] ?? 'single';
}

function secondsBetweenShots(state: WeaponFireState, mode: WeaponFireMode): number {
  const cadenceSeconds = 60 / state.roundsPerMinute;
  return mode === 'bolt' ? Math.max(cadenceSeconds, WEAPON_BOLT_DELAY_SECONDS) : cadenceSeconds;
}

function emitShot(state: WeaponFireState, mode: WeaponFireMode, events: WeaponFireEvent[]): void {
  state.roundsInMagazine = Math.max(0, state.roundsInMagazine - 1);
  // Preserve fractional cadence debt so frame boundaries do not silently lower
  // the configured RPM. The caller bounds how many catch-up shots one tick may emit.
  state.cooldownSeconds += secondsBetweenShots(state, mode);
  events.push({ type: 'shot', fireMode: mode, weaponId: state.weaponId });
}

function emitDryFire(state: WeaponFireState, events: WeaponFireEvent[]): void {
  if (state.dryFireLatched) return;
  state.dryFireLatched = true;
  events.push({ type: 'dry-fire', weaponId: state.weaponId });
}

function startReload(
  state: WeaponFireState,
  reserveRounds: number,
  events: WeaponFireEvent[],
): boolean {
  if (
    state.reloading ||
    state.reloadRequestPending ||
    state.roundsInMagazine >= state.magazineSize ||
    reserveRounds <= 0
  ) {
    return false;
  }
  state.burstRoundsRemaining = 0;
  state.cooldownSeconds = 0;
  state.reloading = true;
  state.reloadSecondsRemaining = WEAPON_RELOAD_SECONDS;
  events.push({ type: 'reload-started', weaponId: state.weaponId });
  return true;
}

export function advanceWeaponFire(
  state: WeaponFireState,
  input: WeaponFireInput,
): WeaponFireEvent[] {
  const events: WeaponFireEvent[] = [];
  const deltaSeconds = Math.max(0, input.deltaSeconds);
  state.cooldownSeconds -= deltaSeconds;

  if (!input.triggerHeld && !input.triggerPressed) state.dryFireLatched = false;

  if (input.cycleModePressed && state.fireModes.length > 1) {
    state.fireModeIndex = (state.fireModeIndex + 1) % state.fireModes.length;
    state.burstRoundsRemaining = 0;
    events.push({
      type: 'fire-mode-changed',
      fireMode: currentWeaponFireMode(state),
      weaponId: state.weaponId,
    });
  }

  if (state.reloading) {
    state.cooldownSeconds = 0;
    state.reloadSecondsRemaining = Math.max(0, state.reloadSecondsRemaining - deltaSeconds);
    if (state.reloadSecondsRemaining <= 0 && !state.reloadRequestPending) {
      const quantity = Math.min(
        Math.max(0, Math.floor(input.reserveRounds)),
        state.magazineSize - state.roundsInMagazine,
      );
      if (quantity > 0) {
        state.reloadRequestPending = true;
        events.push({ type: 'reload-request', quantity, weaponId: state.weaponId });
      } else {
        state.reloading = false;
      }
    }
    return events;
  }

  if (input.reloadPressed && startReload(state, input.reserveRounds, events)) return events;
  if (state.reloadRequestPending) {
    state.cooldownSeconds = 0;
    return events;
  }

  const mode = currentWeaponFireMode(state);
  if (mode === 'burst3' && input.triggerPressed && state.burstRoundsRemaining <= 0) {
    if (state.roundsInMagazine <= 0) {
      emitDryFire(state, events);
    } else {
      state.burstRoundsRemaining = Math.min(3, state.roundsInMagazine);
    }
  }

  const wantsShot =
    (mode === 'auto' && input.triggerHeld) ||
    ((mode === 'single' || mode === 'bolt') && input.triggerPressed) ||
    (mode === 'burst3' && state.burstRoundsRemaining > 0);

  if (!wantsShot) {
    state.cooldownSeconds = Math.max(0, state.cooldownSeconds);
    return events;
  }
  if (state.roundsInMagazine <= 0) {
    if (input.triggerPressed || mode === 'auto') emitDryFire(state, events);
    state.burstRoundsRemaining = 0;
    state.cooldownSeconds = Math.max(0, state.cooldownSeconds);
    return events;
  }
  if (state.cooldownSeconds > 0) return events;

  const shotLimit = mode === 'auto' || mode === 'burst3' ? MAX_WEAPON_SHOTS_PER_TICK : 1;
  let shotsEmitted = 0;
  while (
    state.cooldownSeconds <= 0 &&
    state.roundsInMagazine > 0 &&
    shotsEmitted < shotLimit
  ) {
    emitShot(state, mode, events);
    shotsEmitted += 1;
    if (mode === 'burst3') {
      state.burstRoundsRemaining = Math.max(0, state.burstRoundsRemaining - 1);
      if (state.burstRoundsRemaining <= 0) break;
    } else if (mode !== 'auto' || !input.triggerHeld) {
      break;
    }
  }

  if (state.roundsInMagazine <= 0) state.burstRoundsRemaining = 0;
  // A suspended tab or debugger pause must not create an unbounded shot backlog.
  if (shotsEmitted >= shotLimit) state.cooldownSeconds = Math.max(0, state.cooldownSeconds);
  return events;
}

export function resolveWeaponReload(state: WeaponFireState, consumedRounds: number): void {
  if (!state.reloadRequestPending) return;
  const acceptedRounds = Math.max(0, Math.floor(consumedRounds));
  state.roundsInMagazine = Math.min(
    state.magazineSize,
    state.roundsInMagazine + acceptedRounds,
  );
  state.reloadRequestPending = false;
  state.reloading = false;
  state.reloadSecondsRemaining = 0;
  if (acceptedRounds > 0) state.dryFireLatched = false;
}

export function rejectWeaponReload(state: WeaponFireState): void {
  state.reloadRequestPending = false;
  state.reloading = false;
  state.reloadSecondsRemaining = 0;
}
