/**
 * Session identity for client telemetry.
 *
 * Deliberately free of imports. Every REST call reaches into this module to
 * stamp its session header, so anything imported here would be pulled into the
 * network layer's dependency graph and risk an import cycle with it.
 *
 * There is no distributed tracing between client and server — the browser sends
 * no `traceparent`. Correlation is two ids instead: `sessionId`, minted here and
 * attached to every request and every telemetry event, and `requestId`, minted
 * by the server and echoed in `x-request-id`. A client error report and the 5xx
 * that caused it join on the second; everything that player did around it joins
 * on the first.
 */

const SESSION_STORAGE_KEY = 'asteron-telemetry-session';

let cachedSessionId: string | null = null;
let lastRequestId: string | null = null;

function mintSessionId(): string {
  // `randomUUID` requires a secure context. The editor's custom scheme and
  // localhost both qualify, but a plain-HTTP LAN test does not, and telemetry
  // must not be the thing that throws on boot there.
  if (typeof crypto !== 'undefined' && typeof crypto.randomUUID === 'function') {
    return crypto.randomUUID();
  }
  return `s-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 10)}`;
}

/**
 * Stable for the tab, across reloads.
 *
 * `sessionStorage` rather than a module variable so a player who reloads after
 * a freeze stays one investigable session instead of two unrelated ones. It is
 * per-tab, so two windows are correctly two sessions.
 */
export function telemetrySessionId(): string {
  if (cachedSessionId) return cachedSessionId;
  try {
    const stored = sessionStorage.getItem(SESSION_STORAGE_KEY);
    if (stored) {
      cachedSessionId = stored;
      return stored;
    }
    const minted = mintSessionId();
    sessionStorage.setItem(SESSION_STORAGE_KEY, minted);
    cachedSessionId = minted;
    return minted;
  } catch {
    // Storage can be disabled outright. An in-memory id still correlates
    // everything within this page load, which is most of the value.
    cachedSessionId ??= mintSessionId();
    return cachedSessionId;
  }
}

/** Records the `x-request-id` of the most recent backend response. */
export function noteServerRequestId(requestId: string | null): void {
  if (requestId) lastRequestId = requestId;
}

/**
 * The last request id seen, attached to error reports.
 *
 * "Last" is an approximation — with concurrent requests in flight it may name a
 * neighbour rather than the exact call that failed. It still narrows a search
 * to a few seconds of one player's traffic, which is the point.
 */
export function lastServerRequestId(): string | null {
  return lastRequestId;
}
