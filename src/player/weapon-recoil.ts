const DEGREES_TO_RADIANS = Math.PI / 180;

/** Consecutive shots after which the vertical climb stops growing. */
const RECOIL_CLIMB_SHOT_CAP = 12;
const RECOIL_PATTERN_RESET_SECONDS = 0.45;
/** Chance the horizontal wander repeats its previous side instead of flipping. */
const RECOIL_SAME_SIDE_CHANCE = 0.3;

export interface RecoilProfile {
  /** Vertical climb applied to the first shot of a burst. */
  firstShotPitchRadians: number;
  /** Additional climb per consecutive shot, up to `maxClimbRadians`. */
  climbPerShotRadians: number;
  maxClimbRadians: number;
  /** Horizontal wander magnitude; the side alternates. */
  horizontalRadians: number;
}

export interface RecoilPatternState {
  consecutiveShots: number;
  lastHorizontalSign: 1 | -1;
  secondsSinceShot: number;
}

export interface RecoilKick {
  pitchRadians: number;
  yawRadians: number;
}

export interface RecoilWeaponStats {
  muzzleVelocityMps: number;
  roundsPerMinute: number;
}

export function createRecoilPatternState(): RecoilPatternState {
  return { consecutiveShots: 0, lastHorizontalSign: 1, secondsSinceShot: 999 };
}

function clamp(value: number, min: number, max: number): number {
  return Math.max(min, Math.min(max, value));
}

/**
 * Derive a recoil pattern from the weapon's own stats, so every authored
 * firearm kicks without needing new fields on the item definition. Slow, heavy
 * rounds punch hard once; fast cyclic weapons kick lightly but climb.
 */
export function recoilProfileForWeapon(stats: RecoilWeaponStats): RecoilProfile {
  const cadence = clamp(600 / Math.max(1, stats.roundsPerMinute), 0.2, 12);
  const power = clamp(stats.muzzleVelocityMps / 500, 0.7, 1.45);
  const firstShotDegrees = clamp(0.55 * cadence ** 0.6 * power, 0.3, 2.8);
  const firstShotPitchRadians = firstShotDegrees * DEGREES_TO_RADIANS;
  return {
    climbPerShotRadians: firstShotPitchRadians * 0.28,
    firstShotPitchRadians,
    horizontalRadians: firstShotPitchRadians * 0.45,
    maxClimbRadians: Math.min(4.5 * DEGREES_TO_RADIANS, firstShotPitchRadians * 6),
  };
}

/** Lets the burst pattern relax back to the first-shot kick between bursts. */
export function advanceRecoilPattern(state: RecoilPatternState, dt: number): void {
  state.secondsSinceShot += Math.max(0, dt);
  if (state.secondsSinceShot >= RECOIL_PATTERN_RESET_SECONDS) {
    state.consecutiveShots = 0;
  }
}

export function nextRecoilKick(
  state: RecoilPatternState,
  profile: RecoilProfile,
  random01: () => number,
): RecoilKick {
  if (state.secondsSinceShot >= RECOIL_PATTERN_RESET_SECONDS) {
    state.consecutiveShots = 0;
  }
  const shotIndex = Math.min(state.consecutiveShots, RECOIL_CLIMB_SHOT_CAP);
  const climb = Math.min(
    profile.maxClimbRadians,
    profile.firstShotPitchRadians + profile.climbPerShotRadians * shotIndex,
  );
  const sign: 1 | -1 =
    random01() < RECOIL_SAME_SIDE_CHANCE
      ? state.lastHorizontalSign
      : ((-state.lastHorizontalSign) as 1 | -1);

  state.consecutiveShots += 1;
  state.lastHorizontalSign = sign;
  state.secondsSinceShot = 0;

  return {
    pitchRadians: climb * (0.85 + random01() * 0.3),
    yawRadians: profile.horizontalRadians * sign * (0.4 + random01() * 0.8),
  };
}

/** Crosshair bloom, in pixels, for the recoil currently on the camera. */
export function crosshairSpreadPx(
  recoil: RecoilKick,
  pixelsPerRadian = 260,
  maxPx = 26,
): number {
  const magnitude = Math.hypot(recoil.pitchRadians, recoil.yawRadians);
  return Math.min(maxPx, magnitude * pixelsPerRadian);
}
