import {
  pulsePlayerVitalsSession,
  resumePlayerVitalsSession,
  startPlayerVitalsSession,
  stopPlayerVitalsSession,
  type PlayerVitalsSessionResponse,
} from '../net/api';
import {
  drainPlayerSurvivalVitals,
  type PlayerSurvivalVitals,
} from '../player/vitals';

export const PULSE_INTERVAL_MS = 20_000;
export const FAILURE_LIMIT = 3;

export interface PendingPulse {
  sequence: number;
}

export interface PlayerVitalsMutableState {
  canonical: PlayerSurvivalVitals;
  projected: PlayerSurvivalVitals;
  sessionId: string | null;
  acceptedSequence: number;
  totalSprintingSeconds: number;
  pendingPulse: PendingPulse | null;
  consecutiveFailures: number;
  locked: boolean;
  stopped: boolean;
  requestPending: boolean;
  lastProjectionAtMs: number;
  lastAttemptAtMs: number;
}

export function copyVitals(vitals: PlayerSurvivalVitals): PlayerSurvivalVitals {
  return {
    hungerReserve01: vitals.hungerReserve01,
    thirstReserve01: vitals.thirstReserve01,
  };
}

function createVitalsMutators(
  state: PlayerVitalsMutableState,
  options: {
    onLocked: (message: string) => void;
    onUnlocked: () => void;
  },
) {
  function applyResponse(response: PlayerVitalsSessionResponse): void {
    state.sessionId = response.sessionId;
    state.acceptedSequence = response.acceptedSequence;
    state.canonical = copyVitals(response.vitals);
    state.projected = copyVitals(response.vitals);
    state.pendingPulse = null;
    state.consecutiveFailures = 0;
    state.lastProjectionAtMs = performance.now();
    if (state.locked) {
      state.locked = false;
      options.onUnlocked();
    }
  }

  function enterLockedState(message: string): void {
    if (state.locked) return;
    state.locked = true;
    state.projected = copyVitals(state.canonical);
    state.totalSprintingSeconds = 0;
    state.pendingPulse = null;
    state.lastProjectionAtMs = performance.now();
    options.onLocked(message);
  }

  function recordPulseFailure(error: unknown): void {
    console.warn('Player vitals heartbeat failed.', error);
    state.consecutiveFailures += 1;
    if (state.consecutiveFailures >= FAILURE_LIMIT) {
      enterLockedState(
        'Vitals sync unavailable. You were returned to your apartment; exits are locked until synchronization recovers.',
      );
    }
  }

  function advanceProjection(nowMs: number, sprinting: boolean): void {
    const elapsedSeconds = Math.max(0, (nowMs - state.lastProjectionAtMs) / 1000);
    state.lastProjectionAtMs = nowMs;

    if (!state.locked) {
      const sprintingSeconds = sprinting ? elapsedSeconds : 0;
      state.projected = drainPlayerSurvivalVitals(
        state.projected,
        elapsedSeconds,
        sprintingSeconds,
      );
      state.totalSprintingSeconds += sprintingSeconds;
    }
  }

  function stop(persistent: boolean): void {
    if (state.stopped) return;
    advanceProjection(performance.now(), false);
    state.stopped = true;
    if (!persistent || !state.sessionId || state.locked) return;
    void stopPlayerVitalsSession(
      state.sessionId,
      Math.max(state.acceptedSequence + 1, state.pendingPulse?.sequence ?? 0),
      state.totalSprintingSeconds,
    ).catch((error) => {
      console.warn('Final player vitals sync failed.', error);
    });
  }

  return { applyResponse, enterLockedState, recordPulseFailure, advanceProjection, stop };
}

export function createVitalsNetworkOps(
  state: PlayerVitalsMutableState,
  options: {
    onLocked: (message: string) => void;
    onUnlocked: () => void;
  },
) {
  const mutators = createVitalsMutators(state, options);

  async function begin(): Promise<void> {
    if (state.stopped || state.requestPending) return;
    state.requestPending = true;
    state.lastAttemptAtMs = performance.now();
    try {
      const response = await startPlayerVitalsSession();
      if (state.stopped) return;
      state.totalSprintingSeconds = 0;
      mutators.applyResponse(response);
    } catch (error) {
      if (state.stopped) return;
      console.warn('Player vitals session failed to start.', error);
      mutators.enterLockedState(
        'Vitals sync could not start. You are restricted to your apartment until synchronization recovers.',
      );
    } finally {
      state.requestPending = false;
    }
  }

  async function pulse(): Promise<void> {
    if (!state.sessionId || state.stopped || state.locked || state.requestPending) return;
    if (!state.pendingPulse) {
      state.pendingPulse = {
        sequence: state.acceptedSequence + 1,
      };
    }
    const attempt = state.pendingPulse;
    state.requestPending = true;
    state.lastAttemptAtMs = performance.now();
    try {
      const response = await pulsePlayerVitalsSession(
        state.sessionId,
        attempt.sequence,
        state.totalSprintingSeconds,
      );
      if (state.stopped) return;
      mutators.applyResponse(response);
    } catch (error) {
      if (state.stopped) return;
      mutators.recordPulseFailure(error);
    } finally {
      state.requestPending = false;
    }
  }

  async function resume(): Promise<void> {
    if (state.stopped || !state.locked || state.requestPending) return;
    state.requestPending = true;
    state.lastAttemptAtMs = performance.now();
    try {
      if (state.sessionId) {
        const response = await resumePlayerVitalsSession(state.sessionId);
        if (state.stopped) return;
        state.totalSprintingSeconds = 0;
        mutators.applyResponse(response);
      } else {
        const response = await startPlayerVitalsSession();
        if (state.stopped) return;
        state.totalSprintingSeconds = 0;
        mutators.applyResponse(response);
      }
    } catch (error) {
      if (state.stopped) return;
      console.warn('Player vitals synchronization is still unavailable.', error);
    } finally {
      state.requestPending = false;
    }
  }

  return {
    begin,
    pulse,
    resume,
    advanceProjection: mutators.advanceProjection,
    stop: mutators.stop,
  };
}
