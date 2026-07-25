import type { PlayerSurvivalVitals } from '../player/vitals';
import {
  copyVitals,
  createVitalsNetworkOps,
  PULSE_INTERVAL_MS,
  type PlayerVitalsMutableState,
} from './player-vitals-session-helpers';

export interface PlayerVitalsSessionOptions {
  initialVitals: PlayerSurvivalVitals;
  persistent: boolean;
  onLocked: (message: string) => void;
  onUnlocked: () => void;
}

export function createPlayerVitalsSession(options: PlayerVitalsSessionOptions) {
  const state: PlayerVitalsMutableState = {
    canonical: copyVitals(options.initialVitals),
    projected: copyVitals(options.initialVitals),
    sessionId: null,
    acceptedSequence: 0,
    totalSprintingSeconds: 0,
    pendingPulse: null,
    consecutiveFailures: 0,
    locked: false,
    stopped: false,
    requestPending: false,
    lastProjectionAtMs: performance.now(),
    lastAttemptAtMs: -Infinity,
  };

  const ops = createVitalsNetworkOps(state, {
    onLocked: options.onLocked,
    onUnlocked: options.onUnlocked,
  });

  function update(nowMs: number, sprinting: boolean): PlayerSurvivalVitals {
    if (state.stopped) return copyVitals(state.projected);
    ops.advanceProjection(nowMs, sprinting);

    if (
      options.persistent &&
      !state.requestPending &&
      nowMs - state.lastAttemptAtMs >= PULSE_INTERVAL_MS
    ) {
      if (state.locked) void ops.resume();
      else if (state.sessionId) void ops.pulse();
      else void ops.begin();
    }

    return copyVitals(state.projected);
  }

  return {
    begin: async () => {
      if (!options.persistent) return;
      await ops.begin();
    },
    getVitals: () => copyVitals(state.projected),
    /** Apply server vitals from consume / other authoritative writes. */
    applyAuthoritativeVitals(vitals: PlayerSurvivalVitals): void {
      state.canonical = copyVitals(vitals);
      state.projected = copyVitals(vitals);
      state.lastProjectionAtMs = performance.now();
    },
    isLocked: () => state.locked,
    stop: () => ops.stop(options.persistent),
    update,
  };
}

export type PlayerVitalsSessionController = ReturnType<
  typeof createPlayerVitalsSession
>;
