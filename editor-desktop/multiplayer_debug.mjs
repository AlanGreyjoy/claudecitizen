import { join } from 'node:path';
import { BrowserWindow, net, screen, session } from 'electron';

/**
 * Local multiplayer smoke test harness.
 *
 * Launches N game windows, each signed in as its own debug account, and streams
 * every window's console back to the editor so replication can be judged from
 * one place. Three things make this work:
 *
 * - Each instance gets a **non-persistent session partition**, so the windows
 *   are genuinely different players. The cell keys entities by `player_id`, so
 *   two windows sharing a cookie jar would collapse into one entity and see
 *   nobody. Non-persistent means each launch starts signed out.
 * - Register/login happens **here**, into that jar, before the window loads.
 *   The renderer therefore never handles a password, and the page is already
 *   authenticated on first paint.
 * - The scene must be `kind: "instance"` with a shared scope, which resolves to
 *   the `scene:<id>` instance — one unpartitioned cell with infinite interest.
 *   A per-player scope would silently route every account into its own
 *   apartment, which the backend then forbids anyone else from joining.
 */

const PARTITION_PREFIX = 'mp-debug-';
const DESCRIPTOR_ARG_PREFIX = '--cc-mp-debug=';
const MAX_INSTANCES = 6;

/** Distinct hues so a cube is identifiable at a glance across windows. */
const CUBE_COLORS = ['#4cc9f0', '#f0a04c', '#8bd450', '#e5674f', '#b47cf0', '#f0d94c'];

class MultiplayerDebugError extends Error {}

function clampInt(value, min, max, fallback) {
  const parsed = Number.parseInt(value, 10);
  if (!Number.isFinite(parsed)) return fallback;
  return Math.min(max, Math.max(min, parsed));
}

function normalizeOptions(raw) {
  const options = typeof raw === 'object' && raw !== null ? raw : {};
  const accountPrefix = String(options.accountPrefix ?? 'mpdebug')
    .trim()
    .toLowerCase()
    .replace(/[^a-z0-9]/g, '');
  if (!accountPrefix) {
    throw new MultiplayerDebugError('Account prefix must contain letters or digits.');
  }
  const password = String(options.password ?? '');
  if (password.length < 8) {
    throw new MultiplayerDebugError('Password must be at least 8 characters.');
  }
  const sceneId = String(options.sceneId ?? '').trim();
  if (!/^[a-z0-9][a-z0-9-]{0,63}$/.test(sceneId)) {
    throw new MultiplayerDebugError(`"${sceneId}" is not a valid scene id.`);
  }
  return {
    instances: clampInt(options.instances, 1, MAX_INSTANCES, 2),
    accountPrefix,
    password,
    sceneId,
    layout: ['grid', 'columns', 'cascade'].includes(options.layout) ? options.layout : 'grid',
    windowWidth: clampInt(options.windowWidth, 480, 3840, 960),
    windowHeight: clampInt(options.windowHeight, 360, 2160, 600),
    openDevTools: options.openDevTools === true,
    cubeAvatars: options.cubeAvatars !== false,
    logPositionDelta: options.logPositionDelta !== false,
  };
}

/**
 * Carves `count` window rects out of the primary display's work area. Each is
 * capped at the requested size so a two-instance run on a wide monitor gets two
 * readable windows rather than two half-screen ones.
 */
function computeTiles(count, layout, width, height) {
  const area = screen.getPrimaryDisplay().workArea;
  if (layout === 'cascade') {
    return Array.from({ length: count }, (_unused, index) => ({
      x: area.x + index * 32,
      y: area.y + index * 32,
      width: Math.min(width, area.width),
      height: Math.min(height, area.height),
    }));
  }
  const columns = layout === 'columns' ? count : Math.ceil(Math.sqrt(count));
  const rows = Math.ceil(count / columns);
  const cellWidth = Math.floor(area.width / columns);
  const cellHeight = Math.floor(area.height / rows);
  return Array.from({ length: count }, (_unused, index) => {
    const column = index % columns;
    const row = Math.floor(index / columns);
    return {
      x: area.x + column * cellWidth,
      y: area.y + row * cellHeight,
      width: Math.min(width, cellWidth),
      height: Math.min(height, cellHeight),
    };
  });
}

async function readErrorMessage(response) {
  try {
    const body = await response.json();
    if (body && typeof body.error === 'string') return body.error;
  } catch {
    // Non-JSON error bodies are not worth a second failure mode.
  }
  return `HTTP ${response.status}`;
}

export function createMultiplayerDebugManager({
  getRepository,
  getRendererOrigin,
  editorDesktopRoot,
  onEvent,
}) {
  /** instanceIndex → { window, session, label }. Empty when nothing is running. */
  const instances = new Map();
  let launching = false;
  /** Set while `stopAll` destroys windows, so per-window teardown stays quiet. */
  let stopping = false;

  const emit = (event) => onEvent(event);

  const emitLifecycle = (instance, label, phase, message) => {
    emit({ kind: 'lifecycle', instance, label, phase, message });
  };

  function status() {
    return { running: instances.size > 0, instances: instances.size };
  }

  /**
   * The cookie jar for `/__editor/mp/<n>/backend/*`. Returns null for any index
   * that is not part of the live run, so a stale or forged path cannot borrow
   * another instance's session.
   */
  function sessionForInstance(index) {
    return instances.get(index)?.session ?? null;
  }

  async function backendBase() {
    const repository = getRepository();
    if (!repository) throw new MultiplayerDebugError('No AsteronEngine project is open.');
    const { document: settings } = await repository.getProjectSettings();
    return settings.editorBackendUrl || settings.backendUrl;
  }

  async function checkHealth() {
    const base = await backendBase();
    const probe = async (path) => {
      try {
        const response = await net.fetch(`${base}${path}`, { method: 'GET' });
        return { ok: response.ok, status: response.status };
      } catch (error) {
        return { ok: false, status: 0, error: error instanceof Error ? error.message : 'unreachable' };
      }
    };
    const [live, ready] = await Promise.all([probe('/livez'), probe('/readyz')]);
    return { backendBase: base, ok: live.ok && ready.ok, live, ready };
  }

  /**
   * Registers the account, falling back to login when it already exists — the
   * common case on every run after the first.
   */
  async function signIn(instanceSession, base, options, index) {
    const username = `${options.accountPrefix}${index}`;
    const email = `${username}@debug.local`;
    const post = (path, body) =>
      instanceSession.fetch(`${base}${path}`, {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify(body),
        credentials: 'include',
      });

    const registered = await post('/auth/register', {
      email,
      username,
      password: options.password,
    });
    if (registered.ok) {
      emitLifecycle(index, username, 'account', `Registered ${email}.`);
      return username;
    }

    const registerError = await readErrorMessage(registered);
    const loggedIn = await post('/auth/login', {
      identifier: email,
      password: options.password,
    });
    if (!loggedIn.ok) {
      throw new MultiplayerDebugError(
        `${username}: register failed (${registerError}) and login failed (${await readErrorMessage(loggedIn)}).`,
      );
    }
    emitLifecycle(index, username, 'account', `Signed in as ${email}.`);
    return username;
  }

  /**
   * Everything the editor learns about a debug window without the renderer
   * having to say anything. Deliberately not `configureNavigation`: that one
   * force-opens DevTools in dev mode, which is unusable at N windows.
   */
  function attachDiagnostics(window, index, label) {
    const contents = window.webContents;

    contents.setWindowOpenHandler(() => ({ action: 'deny' }));
    contents.on('will-attach-webview', (event) => event.preventDefault());

    contents.on('console-message', (details) => {
      if (details.level === 'debug') return;
      emit({
        kind: 'console',
        instance: index,
        label,
        level: details.level,
        line: details.message,
        source: `${details.sourceId}:${details.lineNumber}`,
      });
    });
    contents.on('did-fail-load', (_event, code, description, url, isMainFrame) => {
      if (!isMainFrame) return;
      emitLifecycle(index, label, 'load-failed', `${code} ${description} ${url}`);
    });
    contents.on('render-process-gone', (_event, gone) => {
      emitLifecycle(index, label, 'renderer-gone', gone.reason);
    });
    contents.on('unresponsive', () => {
      emitLifecycle(index, label, 'unresponsive', 'Renderer stopped responding.');
    });
    contents.on('responsive', () => {
      emitLifecycle(index, label, 'responsive', 'Renderer responsive again.');
    });
    // A malformed descriptor is otherwise completely silent, and is the single
    // most likely first-run failure.
    contents.on('preload-error', (_event, preloadPath, error) => {
      emitLifecycle(index, label, 'preload-error', `${preloadPath}: ${error.message}`);
    });
  }

  function createInstanceWindow(index, label, username, options, tile) {
    const descriptor = {
      instanceIndex: index,
      label,
      username,
      sceneId: options.sceneId,
      cubeAvatars: options.cubeAvatars,
      cubeColor: CUBE_COLORS[(index - 1) % CUBE_COLORS.length],
      logPositionDelta: options.logPositionDelta,
    };
    const window = new BrowserWindow({
      backgroundColor: '#02070d',
      icon: join(editorDesktopRoot, 'build', 'icon.png'),
      show: false,
      title: `${label} — Multiplayer Debug`,
      ...tile,
      webPreferences: {
        // A trimmed bridge: a game window has no business holding
        // deleteProject / deployBackend.
        preload: join(editorDesktopRoot, 'game_preload.cjs'),
        contextIsolation: true,
        nodeIntegration: false,
        sandbox: true,
        webSecurity: true,
        devTools: true,
        additionalArguments: [`${DESCRIPTOR_ARG_PREFIX}${JSON.stringify(descriptor)}`],
      },
    });

    attachDiagnostics(window, index, label);
    window.once('ready-to-show', () => {
      if (window.isDestroyed()) return;
      window.show();
      if (options.openDevTools) window.webContents.openDevTools({ mode: 'detach' });
    });
    window.once('closed', () => {
      if (stopping) return;
      instances.delete(index);
      emitLifecycle(index, label, 'window-closed', 'Window closed.');
      if (instances.size === 0 && !launching) {
        emit({ kind: 'run', phase: 'stopped', message: 'All debug windows closed.', instances: 0 });
      }
    });
    return window;
  }

  async function launch(rawOptions) {
    if (instances.size > 0 || launching) {
      throw new MultiplayerDebugError('A multiplayer debug run is already active.');
    }
    const options = normalizeOptions(rawOptions);
    const health = await checkHealth();
    if (!health.ok) {
      throw new MultiplayerDebugError(
        `Backend unreachable at ${health.backendBase}. Start it with \`npm run dev:infra\` then \`npm run dev:server\`.`,
      );
    }

    launching = true;
    emit({
      kind: 'run',
      phase: 'starting',
      message: `Launching ${options.instances} instance(s) into scene:${options.sceneId}.`,
      instances: options.instances,
    });
    const tiles = computeTiles(
      options.instances,
      options.layout,
      options.windowWidth,
      options.windowHeight,
    );

    try {
      for (let index = 1; index <= options.instances; index += 1) {
        // Non-persistent: no `persist:` prefix, so the jar dies with the app.
        const instanceSession = session.fromPartition(`${PARTITION_PREFIX}${index}`);
        const username = await signIn(instanceSession, health.backendBase, options, index);
        const window = createInstanceWindow(index, username, username, options, tiles[index - 1]);
        // Registered before loadURL so the proxy can serve the page's first
        // backend call, which happens during module evaluation.
        instances.set(index, { window, session: instanceSession, label: username });
        await window.loadURL(
          `${getRendererOrigin()}/?boot=scene&sceneId=${encodeURIComponent(options.sceneId)}`,
        );
      }
    } catch (error) {
      launching = false;
      await stopAll();
      const message = error instanceof Error ? error.message : 'Launch failed.';
      emit({ kind: 'run', phase: 'error', message, instances: 0 });
      throw error instanceof MultiplayerDebugError ? error : new MultiplayerDebugError(message);
    }

    launching = false;
    emit({
      kind: 'run',
      phase: 'ready',
      message: `${options.instances} instance(s) running in scene:${options.sceneId}.`,
      instances: options.instances,
    });
    return status();
  }

  /**
   * `destroy` rather than `close`: a `beforeunload` in the game must not be
   * able to veto teardown when the editor is on its way out.
   */
  async function stopAll() {
    const live = [...instances.values()];
    instances.clear();
    stopping = true;
    try {
      for (const entry of live) {
        if (!entry.window.isDestroyed()) entry.window.destroy();
      }
      await Promise.all(
        live.map((entry) => entry.session.clearStorageData().catch(() => undefined)),
      );
    } finally {
      stopping = false;
    }
    if (live.length > 0) {
      emit({ kind: 'run', phase: 'stopped', message: 'Debug windows stopped.', instances: 0 });
    }
    return status();
  }

  return { sessionForInstance, checkHealth, launch, stopAll, status };
}
