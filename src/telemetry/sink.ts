/**
 * Batches telemetry events and ships them to the backend.
 *
 * Everything here fails silently on purpose. Telemetry that surfaces its own
 * errors to the player, or that throws into a caller's frame, has made the
 * product worse to observe the product.
 */

import { backendRequestUrl } from '../net/runtime-config';
import { telemetrySessionId } from './session';
import type { TelemetryContext } from './context';

/** Long enough that flushes are rare, short enough that a crash loses little. */
const FLUSH_INTERVAL_MS = 10_000;
/**
 * Hard ceiling on the in-memory queue. If the backend is unreachable the queue
 * would otherwise grow for the whole session; dropping the oldest keeps the
 * most recent events, which are the ones near whatever went wrong.
 */
const MAX_QUEUED_EVENTS = 200;
const INGEST_PATH = '/telemetry/client';

export interface TelemetryEvent {
  kind: string;
  [field: string]: unknown;
}

let context: TelemetryContext | null = null;
let queue: TelemetryEvent[] = [];
let timer: ReturnType<typeof setInterval> | null = null;
let started = false;

export function enqueueTelemetry(event: TelemetryEvent): void {
  if (!started) return;
  queue.push(event);
  if (queue.length > MAX_QUEUED_EVENTS) {
    queue = queue.slice(queue.length - MAX_QUEUED_EVENTS);
  }
}

function send(events: TelemetryEvent[]): void {
  if (events.length === 0 || !context) return;
  const body = JSON.stringify({
    context,
    events,
    sessionId: telemetrySessionId(),
  });
  // `keepalive` rather than `sendBeacon`: a beacon cannot set a JSON
  // content-type without tripping a CORS preflight it is not allowed to make,
  // and the ingest route needs credentials to attribute the batch to a player.
  // Chromium caps a keepalive body at 64 KB, which the queue cap stays under.
  void fetch(backendRequestUrl(INGEST_PATH), {
    body,
    credentials: 'include',
    headers: { 'Content-Type': 'application/json' },
    keepalive: true,
    method: 'POST',
  }).catch(() => {
    // Dropped. Retrying would compete with the game for bandwidth during
    // exactly the network trouble that caused the failure.
  });
}

export function flushTelemetry(): void {
  if (queue.length === 0) return;
  const batch = queue;
  queue = [];
  send(batch);
}

/**
 * `pagehide` rather than `beforeunload` or `unload`: it is the only one that
 * fires reliably when a tab is discarded or restored from the back/forward
 * cache, which is how most sessions actually end. `visibilitychange` covers a
 * player who tabs away and never returns.
 */
function handleHide(): void {
  flushTelemetry();
}

function handleVisibility(): void {
  if (document.visibilityState === 'hidden') flushTelemetry();
}

export function startTelemetrySink(captured: TelemetryContext): void {
  if (started) return;
  context = captured;
  started = true;
  timer = setInterval(flushTelemetry, FLUSH_INTERVAL_MS);
  window.addEventListener('pagehide', handleHide);
  document.addEventListener('visibilitychange', handleVisibility);
}

export function stopTelemetrySink(): void {
  if (!started) return;
  flushTelemetry();
  if (timer !== null) clearInterval(timer);
  timer = null;
  started = false;
  window.removeEventListener('pagehide', handleHide);
  document.removeEventListener('visibilitychange', handleVisibility);
}
