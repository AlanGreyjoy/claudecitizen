import { AUTHORING_ENABLED } from '../build-mode';

/**
 * Runtime backend configuration.
 *
 * The backend URL is a deployment concern, not a build-time constant, so it is
 * resolved once at startup instead of being baked in by Vite:
 *
 *   - Editor: read from the open project's `asteron.project.json` through the
 *     `/__editor/project-settings` API.
 *   - Shipped web build: read from `asteron.runtime.json`, which File → Build
 *     Web writes next to `index.html`.
 *
 * There is no API key. Players authenticate with the existing cookie session,
 * so nothing secret is ever shipped to the client.
 */
export interface RuntimeConfig {
  backendUrl: string;
  /** Scene the game loads on start. */
  bootScene: string;
}

const DEFAULTS: RuntimeConfig = {
  backendUrl: 'http://localhost:3000',
  bootScene: 'title',
};
const RUNTIME_CONFIG_URL = '/asteron.runtime.json';

let resolved: RuntimeConfig = { ...DEFAULTS };
let loadPromise: Promise<RuntimeConfig> | null = null;

function normalizeBackendUrl(value: unknown): string | null {
  if (typeof value !== 'string') return null;
  const trimmed = value.trim().replace(/\/$/, '');
  return /^https?:\/\/[^\s]+$/.test(trimmed) ? trimmed : null;
}

function normalizeSceneId(value: unknown): string | null {
  if (typeof value !== 'string') return null;
  const trimmed = value.trim();
  return /^[a-z0-9][a-z0-9-]{0,63}$/.test(trimmed) ? trimmed : null;
}

function merge(backendUrl: unknown, bootScene: unknown): void {
  resolved = {
    backendUrl: normalizeBackendUrl(backendUrl) ?? resolved.backendUrl,
    bootScene: normalizeSceneId(bootScene) ?? resolved.bootScene,
  };
}

async function readEditorProjectSettings(): Promise<void> {
  try {
    const response = await fetch('/__editor/project-settings');
    if (!response.ok) return;
    const payload = (await response.json()) as {
      document?: { backendUrl?: unknown; defaultScene?: unknown };
    };
    merge(payload.document?.backendUrl, payload.document?.defaultScene);
  } catch {
    // Defaults stay in place when no project is bound.
  }
}

async function readShippedRuntimeConfig(): Promise<void> {
  try {
    const response = await fetch(RUNTIME_CONFIG_URL, { cache: 'no-store' });
    if (!response.ok) return;
    const payload = (await response.json()) as {
      backendUrl?: unknown;
      bootScene?: unknown;
    };
    merge(payload.backendUrl, payload.bootScene);
  } catch {
    // A release without runtime config falls back to localhost.
  }
}

/** Resolves runtime config once. Safe to call repeatedly. */
export function loadRuntimeConfig(): Promise<RuntimeConfig> {
  loadPromise ??= (async () => {
    if (AUTHORING_ENABLED) await readEditorProjectSettings();
    else await readShippedRuntimeConfig();
    return resolved;
  })();
  return loadPromise;
}

export function runtimeConfig(): RuntimeConfig {
  return resolved;
}

/**
 * True when backend calls must go through the Electron main process.
 *
 * The packaged editor renderer lives on `cceditor://app`, which the backend's
 * single-origin CORS policy rejects and which cannot store session cookies.
 * Dev mode loads from the Vite origin instead, but still exposes the desktop
 * preload bridge — use that (or the custom protocol) to keep the proxy on.
 */
export function usesBackendProxy(): boolean {
  return (
    window.location.protocol === 'cceditor:'
    || window.claudeCitizenEditorDesktop?.isDesktopEditor === true
  );
}

/** Resolves a backend path to either the proxy route or the direct API URL. */
export function backendRequestUrl(path: string): string {
  const suffix = path.startsWith('/') ? path : `/${path}`;
  return usesBackendProxy()
    ? `/__editor/backend${suffix}`
    : `${resolved.backendUrl}${suffix}`;
}

/** Lets the editor apply a Project Settings change without a reload. */
export function setRuntimeBackendUrl(value: string): void {
  const backendUrl = normalizeBackendUrl(value);
  if (!backendUrl) return;
  resolved = { ...resolved, backendUrl };
  loadPromise = Promise.resolve(resolved);
}
