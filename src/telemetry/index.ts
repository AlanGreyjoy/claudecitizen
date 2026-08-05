/**
 * Client telemetry for the shipped game runtime.
 *
 * Scope is `index.html` / `game-main.ts` only. The editor renderer is excluded
 * deliberately: it loads from the privileged `cceditor://app` origin, whose
 * requests are proxied by the Electron main process through a header allow-list
 * that would drop anything this added.
 *
 * See `docs/docs/architecture/observability.md` for the whole pipeline.
 */

import { captureTelemetryContext } from './context';
import { startErrorCapture, stopErrorCapture } from './errors';
import { startFrameSampling, stopFrameSampling } from './frame-sample';
import { telemetrySessionId } from './session';
import { enqueueTelemetry, startTelemetrySink, stopTelemetrySink } from './sink';

export { reportHandledError } from './errors';
export { flushTelemetry } from './sink';
export { lastServerRequestId, noteServerRequestId, telemetrySessionId } from './session';

let running = false;

/**
 * Starts capture. Safe to call before the backend URL is known — nothing is
 * sent until the first flush ten seconds later.
 *
 * Every failure path here is swallowed. Telemetry must never be the reason the
 * game does not boot.
 */
export async function startClientTelemetry(): Promise<void> {
  if (running) return;
  running = true;
  try {
    const context = await captureTelemetryContext();
    startTelemetrySink(context);
    // Registered after the sink, or the boot event would be dropped by the
    // not-started guard in `enqueueTelemetry`.
    startErrorCapture();
    startFrameSampling();
    enqueueTelemetry({
      at: new Date().toISOString(),
      kind: 'boot',
      sessionId: telemetrySessionId(),
      url: window.location.href,
    });
  } catch {
    running = false;
  }
}

export function stopClientTelemetry(): void {
  if (!running) return;
  running = false;
  stopFrameSampling();
  stopErrorCapture();
  stopTelemetrySink();
}
