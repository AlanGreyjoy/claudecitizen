/**
 * Lightweight player vitals for HaloBand / status UI.
 * Hunger and thirst are persisted, but no vital drives damage, death, or
 * locomotion yet.
 */

export interface PlayerSurvivalVitals {
  /** Remaining food reserve. 1 = satisfied, 0 = empty. */
  hungerReserve01: number;
  /** Remaining hydration reserve. 1 = hydrated, 0 = empty. */
  thirstReserve01: number;
}

export interface PlayerVitals extends PlayerSurvivalVitals {
  /** Overall integrity 0..1 */
  health01: number;
  /** Core body temperature °C */
  bodyTempC: number;
  /** Beats per minute */
  heartRateBpm: number;
  /** Suit / lung oxygen 0..1 */
  oxygen01: number;
}

export interface PlayerVitalsUpdateContext {
  grounded: boolean;
  sprinting: boolean;
  /** Altitude above surface in meters (character or ship focus). */
  altitudeMeters: number;
  /** Atmosphere factor 1 = surface air, 0 = vacuum. */
  atmosphere01: number;
  /** Monotonic seconds for idle heart-rate drift. */
  timeSeconds: number;
}

const BASE_TEMP_C = 36.6;
const BASE_HR = 62;
const SPRINT_HR = 108;
const AIRBORNE_HR = 74;
const VACUUM_O2_DRAIN = 0.015;
const IDLE_RECOVER = 0.012;
export const HUNGER_FULL_TO_EMPTY_SECONDS = 4 * 60 * 60;
export const THIRST_FULL_TO_EMPTY_SECONDS = 2 * 60 * 60;

function clamp01(value: number): number {
  return Math.min(1, Math.max(0, value));
}

function lerp(a: number, b: number, t: number): number {
  return a + (b - a) * t;
}

export function createPlayerVitals(
  survival: PlayerSurvivalVitals = {
    hungerReserve01: 1,
    thirstReserve01: 1,
  },
): PlayerVitals {
  return {
    health01: 1,
    bodyTempC: BASE_TEMP_C,
    heartRateBpm: BASE_HR,
    hungerReserve01: clamp01(survival.hungerReserve01),
    thirstReserve01: clamp01(survival.thirstReserve01),
    oxygen01: 1,
  };
}

/**
 * Project private survival reserves between server heartbeats.
 * Sprint time is added once more because the baseline elapsed time already
 * contains it, producing a 2x total drain while sprinting.
 */
export function drainPlayerSurvivalVitals(
  vitals: PlayerSurvivalVitals,
  elapsedSeconds: number,
  sprintingSeconds: number,
): PlayerSurvivalVitals {
  const elapsed = Math.max(0, elapsedSeconds);
  const sprinting = Math.min(elapsed, Math.max(0, sprintingSeconds));
  const effectiveSeconds = elapsed + sprinting;
  return {
    hungerReserve01: clamp01(
      vitals.hungerReserve01 - effectiveSeconds / HUNGER_FULL_TO_EMPTY_SECONDS,
    ),
    thirstReserve01: clamp01(
      vitals.thirstReserve01 - effectiveSeconds / THIRST_FULL_TO_EMPTY_SECONDS,
    ),
  };
}

/**
 * Soft idle drift + activity response so HaloBand gauges feel live.
 * No lethal outcomes in this pass.
 */
export function updatePlayerVitals(
  vitals: PlayerVitals,
  dt: number,
  context: PlayerVitalsUpdateContext,
): PlayerVitals {
  if (dt <= 0) return vitals;

  const targetHr = context.sprinting
    ? SPRINT_HR
    : !context.grounded
      ? AIRBORNE_HR
      : BASE_HR + Math.sin(context.timeSeconds * 1.2) * 1.4;
  const heartRateBpm = lerp(vitals.heartRateBpm, targetHr, Math.min(1, dt * 2.2));

  const altitudeCool = Math.min(1, Math.max(0, context.altitudeMeters / 40_000)) * 0.8;
  const targetTemp = BASE_TEMP_C - altitudeCool + (context.sprinting ? 0.35 : 0);
  const bodyTempC = lerp(vitals.bodyTempC, targetTemp, Math.min(1, dt * 0.9));

  let oxygen01 = vitals.oxygen01;
  if (context.atmosphere01 < 0.35) {
    oxygen01 = clamp01(oxygen01 - VACUUM_O2_DRAIN * (1 - context.atmosphere01) * dt);
  } else {
    oxygen01 = clamp01(oxygen01 + IDLE_RECOVER * dt);
  }

  // Keep health high for now; slight coupling to O₂ for visual feedback only.
  const health01 = clamp01(0.92 + oxygen01 * 0.08);

  return {
    health01,
    bodyTempC,
    heartRateBpm,
    hungerReserve01: vitals.hungerReserve01,
    thirstReserve01: vitals.thirstReserve01,
    oxygen01,
  };
}
