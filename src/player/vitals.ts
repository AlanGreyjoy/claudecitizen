/**
 * Lightweight player vitals for HaloBand / status UI.
 * Presentation model only — does not drive damage, death, or locomotion yet.
 */

export interface PlayerVitals {
  /** Overall integrity 0..1 */
  health01: number;
  /** Core body temperature °C */
  bodyTempC: number;
  /** Beats per minute */
  heartRateBpm: number;
  /** Nourishment / fuel 0..1 */
  nourishment01: number;
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
const SPRINT_NOURISH_DRAIN = 0.008;
const IDLE_RECOVER = 0.012;

function clamp01(value: number): number {
  return Math.min(1, Math.max(0, value));
}

function lerp(a: number, b: number, t: number): number {
  return a + (b - a) * t;
}

export function createPlayerVitals(): PlayerVitals {
  return {
    health01: 1,
    bodyTempC: BASE_TEMP_C,
    heartRateBpm: BASE_HR,
    nourishment01: 1,
    oxygen01: 1,
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

  let nourishment01 = vitals.nourishment01;
  if (context.sprinting) {
    nourishment01 = clamp01(nourishment01 - SPRINT_NOURISH_DRAIN * dt);
  } else {
    nourishment01 = clamp01(nourishment01 + IDLE_RECOVER * 0.15 * dt);
  }

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
    nourishment01,
    oxygen01,
  };
}
