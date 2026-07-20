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

const PULSE_INTERVAL_MS = 20_000;
const FAILURE_LIMIT = 3;

interface PendingPulse {
  sequence: number;
}

export interface PlayerVitalsSessionOptions {
  initialVitals: PlayerSurvivalVitals;
  persistent: boolean;
  onLocked: (message: string) => void;
  onUnlocked: () => void;
}

function copyVitals(vitals: PlayerSurvivalVitals): PlayerSurvivalVitals {
  return {
    hungerReserve01: vitals.hungerReserve01,
    thirstReserve01: vitals.thirstReserve01,
  };
}

export function createPlayerVitalsSession(options: PlayerVitalsSessionOptions) {
  let canonical = copyVitals(options.initialVitals);
  let projected = copyVitals(options.initialVitals);
  let sessionId: string | null = null;
  let acceptedSequence = 0;
  let totalSprintingSeconds = 0;
  let pendingPulse: PendingPulse | null = null;
  let consecutiveFailures = 0;
  let locked = false;
  let stopped = false;
  let requestPending = false;
  let lastProjectionAtMs = performance.now();
  let lastAttemptAtMs = -Infinity;

  function applyResponse(response: PlayerVitalsSessionResponse): void {
    sessionId = response.sessionId;
    acceptedSequence = response.acceptedSequence;
    canonical = copyVitals(response.vitals);
    projected = copyVitals(response.vitals);
    pendingPulse = null;
    consecutiveFailures = 0;
    lastProjectionAtMs = performance.now();
    if (locked) {
      locked = false;
      options.onUnlocked();
    }
  }

  function enterLockedState(message: string): void {
    if (locked) return;
    locked = true;
    projected = copyVitals(canonical);
    totalSprintingSeconds = 0;
    pendingPulse = null;
    lastProjectionAtMs = performance.now();
    options.onLocked(message);
  }

  function recordPulseFailure(error: unknown): void {
    console.warn('Player vitals heartbeat failed.', error);
    consecutiveFailures += 1;
    if (consecutiveFailures >= FAILURE_LIMIT) {
      enterLockedState(
        'Vitals sync unavailable. You were returned to your apartment; exits are locked until synchronization recovers.',
      );
    }
  }

  async function begin(): Promise<void> {
    if (!options.persistent || stopped || requestPending) return;
    requestPending = true;
    lastAttemptAtMs = performance.now();
    try {
      const response = await startPlayerVitalsSession();
      if (stopped) return;
      totalSprintingSeconds = 0;
      applyResponse(response);
    } catch (error) {
      if (stopped) return;
      console.warn('Player vitals session failed to start.', error);
      enterLockedState(
        'Vitals sync could not start. You are restricted to your apartment until synchronization recovers.',
      );
    } finally {
      requestPending = false;
    }
  }

  async function pulse(): Promise<void> {
    if (!sessionId || stopped || locked || requestPending) return;
    if (!pendingPulse) {
      pendingPulse = {
        sequence: acceptedSequence + 1,
      };
    }
    const attempt = pendingPulse;
    requestPending = true;
    lastAttemptAtMs = performance.now();
    try {
      const response = await pulsePlayerVitalsSession(
        sessionId,
        attempt.sequence,
        totalSprintingSeconds,
      );
      if (stopped) return;
      applyResponse(response);
    } catch (error) {
      if (stopped) return;
      recordPulseFailure(error);
    } finally {
      requestPending = false;
    }
  }

  async function resume(): Promise<void> {
    if (stopped || !locked || requestPending) return;
    requestPending = true;
    lastAttemptAtMs = performance.now();
    try {
      if (sessionId) {
        const response = await resumePlayerVitalsSession(sessionId);
        if (stopped) return;
        totalSprintingSeconds = 0;
        applyResponse(response);
      } else {
        const response = await startPlayerVitalsSession();
        if (stopped) return;
        totalSprintingSeconds = 0;
        applyResponse(response);
      }
    } catch (error) {
      if (stopped) return;
      console.warn('Player vitals synchronization is still unavailable.', error);
    } finally {
      requestPending = false;
    }
  }

  function advanceProjection(nowMs: number, sprinting: boolean): void {
    const elapsedSeconds = Math.max(0, (nowMs - lastProjectionAtMs) / 1000);
    lastProjectionAtMs = nowMs;

    if (!locked) {
      const sprintingSeconds = sprinting ? elapsedSeconds : 0;
      projected = drainPlayerSurvivalVitals(
        projected,
        elapsedSeconds,
        sprintingSeconds,
      );
      totalSprintingSeconds += sprintingSeconds;
    }
  }

  function update(nowMs: number, sprinting: boolean): PlayerSurvivalVitals {
    if (stopped) return copyVitals(projected);
    advanceProjection(nowMs, sprinting);

    if (
      options.persistent &&
      !requestPending &&
      nowMs - lastAttemptAtMs >= PULSE_INTERVAL_MS
    ) {
      if (locked) void resume();
      else if (sessionId) void pulse();
      else void begin();
    }

    return copyVitals(projected);
  }

  function stop(): void {
    if (stopped) return;
    advanceProjection(performance.now(), false);
    stopped = true;
    if (!options.persistent || !sessionId || locked) return;
    void stopPlayerVitalsSession(
      sessionId,
      Math.max(acceptedSequence + 1, pendingPulse?.sequence ?? 0),
      totalSprintingSeconds,
    ).catch((error) => {
      console.warn('Final player vitals sync failed.', error);
    });
  }

  return {
    begin,
    getVitals: () => copyVitals(projected),
    isLocked: () => locked,
    stop,
    update,
  };
}

export type PlayerVitalsSessionController = ReturnType<
  typeof createPlayerVitalsSession
>;
