/** Punch decay half-life; short enough to read as a snap, not a pulse. */
const CROSSHAIR_PUNCH_HALF_LIFE_SECONDS = 0.045;
const CROSSHAIR_MAX_STEP_SECONDS = 0.1;

export interface WeaponCrosshairUpdate {
  /** Monotonic shot count; any change fires the punch animation. */
  shotCount: number;
  spreadPx: number;
  visible: boolean;
}

export interface WeaponCrosshairHud {
  update(state: WeaponCrosshairUpdate, nowMs: number): void;
}

/**
 * Live crosshair: blooms with the recoil currently on the camera and punches
 * on every shot. A static reticle gives the player no read on where the next
 * round actually goes.
 */
export function createWeaponCrosshair(rootEl: HTMLElement): WeaponCrosshairHud {
  let punch = 0;
  let lastShotCount = -1;
  let lastNowMs = 0;
  let writtenSpread = Number.NaN;
  let writtenPunch = Number.NaN;

  function write(spreadPx: number): void {
    const spread = Math.round(spreadPx * 10) / 10;
    if (spread !== writtenSpread) {
      rootEl.style.setProperty('--weapon-crosshair-spread', `${spread}px`);
      writtenSpread = spread;
    }
    const punchValue = Math.round(punch * 100) / 100;
    if (punchValue !== writtenPunch) {
      rootEl.style.setProperty('--weapon-crosshair-punch', String(punchValue));
      writtenPunch = punchValue;
    }
  }

  function update(state: WeaponCrosshairUpdate, nowMs: number): void {
    const dt = lastNowMs > 0 ? Math.min(CROSSHAIR_MAX_STEP_SECONDS, (nowMs - lastNowMs) / 1000) : 0;
    lastNowMs = nowMs;
    rootEl.classList.toggle('is-visible', state.visible);
    if (!state.visible) {
      punch = 0;
      lastShotCount = state.shotCount;
      write(0);
      return;
    }
    if (state.shotCount !== lastShotCount) {
      // A holstered-then-drawn weapon must not punch on its first frame.
      if (lastShotCount >= 0) punch = 1;
      lastShotCount = state.shotCount;
    } else if (punch > 0) {
      punch *= Math.exp((-dt * Math.LN2) / CROSSHAIR_PUNCH_HALF_LIFE_SECONDS);
      if (punch < 0.01) punch = 0;
    }
    write(state.spreadPx);
  }

  return { update };
}
