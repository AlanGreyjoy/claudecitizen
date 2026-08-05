/**
 * Global error capture.
 *
 * Before this, the runtime had no `window.onerror` and no `unhandledrejection`
 * handler anywhere — an uncaught exception left no trace beyond a console line
 * on a machine nobody was looking at.
 */

import { lastServerRequestId } from './session';
import { enqueueTelemetry } from './sink';

/**
 * One misbehaving frame can throw the same error 60 times a second. Dedup by
 * signature and keep a count instead, so a repeating fault costs one event.
 */
const seen = new Map<string, number>();
/** Bounds the map itself — a fault that varies its message must not leak. */
const MAX_DISTINCT_ERRORS = 50;

function signature(message: string, stack: string): string {
  // First stack frame only: the same bug reached from two call paths is still
  // the same bug, and the full stack rarely matches byte-for-byte.
  return `${message}::${stack.split('\n')[1]?.trim() ?? ''}`;
}

function report(source: string, message: string, stack: string): void {
  const key = signature(message, stack);
  const count = seen.get(key) ?? 0;
  seen.set(key, count + 1);
  // Report the first, then powers of ten. A fault firing thousands of times is
  // worth knowing about, but not worth thousands of records.
  const milestone = count === 0 || count === 9 || count === 99 || count === 999;
  if (!milestone) return;
  if (seen.size > MAX_DISTINCT_ERRORS) seen.clear();
  enqueueTelemetry({
    at: new Date().toISOString(),
    kind: 'error',
    message,
    occurrences: count + 1,
    // Which backend request this player last touched. Approximate, but it turns
    // "an error happened" into a few seconds of server log to read.
    requestId: lastServerRequestId(),
    source,
    stack,
    url: window.location.href,
  });
}

function describe(value: unknown): { message: string; stack: string } {
  if (value instanceof Error) {
    return { message: `${value.name}: ${value.message}`, stack: value.stack ?? '' };
  }
  // A rejected promise can carry anything, including a bare string or a DOM
  // exception with no stack at all.
  return { message: String(value), stack: '' };
}

function onError(event: ErrorEvent): void {
  const { message, stack } = describe(event.error);
  report(
    'window.onerror',
    stack ? message : `${event.message} (${event.filename}:${event.lineno})`,
    stack,
  );
}

function onRejection(event: PromiseRejectionEvent): void {
  const { message, stack } = describe(event.reason);
  report('unhandledrejection', message, stack);
}

export function startErrorCapture(): void {
  window.addEventListener('error', onError);
  window.addEventListener('unhandledrejection', onRejection);
}

export function stopErrorCapture(): void {
  window.removeEventListener('error', onError);
  window.removeEventListener('unhandledrejection', onRejection);
}

/**
 * Reports an error the app caught and handled.
 *
 * The global handlers only see what nothing caught. Boot failures are all
 * routed through `.catch(console.error)`, so without an explicit call they
 * would never be reported at all.
 */
export function reportHandledError(source: string, error: unknown): void {
  const { message, stack } = describe(error);
  report(source, message, stack);
}
