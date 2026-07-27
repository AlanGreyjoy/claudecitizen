/**
 * Loopback HTTP agent API for AsteronEngine MCP.
 * Binds 127.0.0.1 only; auth via bearer token written to ~/.asteron/agent.json.
 */
import { createServer } from 'node:http';
import { randomBytes, timingSafeEqual } from 'node:crypto';
import { homedir } from 'node:os';
import { join } from 'node:path';
import { mkdir, writeFile, unlink } from 'node:fs/promises';

const DISCOVERY_DIR = join(homedir(), '.asteron');
const DISCOVERY_PATH = join(DISCOVERY_DIR, 'agent.json');
const HOST = '127.0.0.1';
const REQUEST_TIMEOUT_MS = 30_000;
const DEFAULT_CAPTURE_MAX_WIDTH = 1280;
const MIN_CAPTURE_MAX_WIDTH = 320;
const MAX_CAPTURE_MAX_WIDTH = 1920;
const CAPTURE_JPEG_QUALITY = 75;

/**
 * @typedef {object} AgentServerDeps
 * @property {() => { projectRoot: string, getProjectSettings: () => Promise<{ document: Record<string, unknown> }>, listScenes: () => Promise<unknown>, listPrefabs: () => Promise<unknown>, getScene: (id: string) => Promise<unknown>, getPrefab: (id: string) => Promise<unknown> } | null} getRepository
 * @property {() => import('electron').BrowserWindow | null} getEditorWindow
 * @property {(kind: string, params: Record<string, unknown>) => Promise<unknown>} requestRenderer
 */

/**
 * @param {AgentServerDeps} deps
 */
export function createAgentServer(deps) {
  const token = randomBytes(32).toString('hex');
  /** @type {import('node:http').Server | null} */
  let server = null;
  let port = 0;

  function json(res, status, payload) {
    const body = JSON.stringify(payload);
    res.writeHead(status, {
      'Content-Type': 'application/json; charset=utf-8',
      'Cache-Control': 'no-store',
      'Content-Length': Buffer.byteLength(body),
    });
    res.end(body);
  }

  function readToken(req) {
    const auth = req.headers.authorization;
    if (typeof auth === 'string' && auth.startsWith('Bearer ')) {
      return auth.slice('Bearer '.length).trim();
    }
    const header = req.headers['x-asteron-token'];
    if (typeof header === 'string') return header.trim();
    return '';
  }

  function tokenMatches(provided) {
    if (!provided || provided.length !== token.length) return false;
    try {
      return timingSafeEqual(Buffer.from(provided), Buffer.from(token));
    } catch {
      return false;
    }
  }

  async function writeDiscovery() {
    await mkdir(DISCOVERY_DIR, { recursive: true });
    await writeFile(
      DISCOVERY_PATH,
      `${JSON.stringify(
        {
          port,
          token,
          pid: process.pid,
          host: HOST,
          discoveryPath: DISCOVERY_PATH,
        },
        null,
        2,
      )}\n`,
      { mode: 0o600 },
    );
  }

  async function clearDiscovery() {
    try {
      await unlink(DISCOVERY_PATH);
    } catch {
      // Missing file is fine (another instance or already cleaned).
    }
  }

  async function readBody(req) {
    const chunks = [];
    for await (const chunk of req) chunks.push(chunk);
    if (chunks.length === 0) return {};
    try {
      return JSON.parse(Buffer.concat(chunks).toString('utf8'));
    } catch {
      const err = new Error('invalid JSON request body');
      err.status = 400;
      err.code = 'bad_request';
      throw err;
    }
  }

  async function requireProject() {
    const repository = deps.getRepository();
    if (!repository) {
      const err = new Error('No AsteronEngine project is open.');
      err.status = 503;
      err.code = 'no_project';
      throw err;
    }
    return repository;
  }

  async function liveOrThrow(kind, params = {}) {
    const win = deps.getEditorWindow();
    if (!win || win.isDestroyed()) {
      const err = new Error('AsteronEngine editor workspace is not open.');
      err.status = 503;
      err.code = 'editor_unavailable';
      throw err;
    }
    return deps.requestRenderer(kind, params);
  }

  function clampCaptureMaxWidth(raw) {
    const n = typeof raw === 'number' ? raw : Number(raw);
    if (!Number.isFinite(n)) return DEFAULT_CAPTURE_MAX_WIDTH;
    return Math.min(
      MAX_CAPTURE_MAX_WIDTH,
      Math.max(MIN_CAPTURE_MAX_WIDTH, Math.floor(n)),
    );
  }

  /**
   * @param {unknown} value
   * @returns {{ x: number, y: number, width: number, height: number } | null}
   */
  function parseCaptureRect(value) {
    if (!value || typeof value !== 'object') return null;
    const rect = /** @type {Record<string, unknown>} */ (value);
    const x = Number(rect.x);
    const y = Number(rect.y);
    const width = Number(rect.width);
    const height = Number(rect.height);
    if (![x, y, width, height].every((n) => Number.isFinite(n))) return null;
    if (width <= 0 || height <= 0) return null;
    return {
      x: Math.floor(x),
      y: Math.floor(y),
      width: Math.floor(width),
      height: Math.floor(height),
    };
  }

  async function handleCaptureViewport(maxWidthRaw) {
    const win = deps.getEditorWindow();
    if (!win || win.isDestroyed()) {
      const err = new Error('AsteronEngine editor workspace is not open.');
      err.status = 503;
      err.code = 'editor_unavailable';
      throw err;
    }

    const target = await liveOrThrow('capture_viewport_target');
    if (!target || typeof target !== 'object') {
      const err = new Error('Viewport capture target missing.');
      err.status = 409;
      err.code = 'viewport_unavailable';
      throw err;
    }

    const targetObj = /** @type {Record<string, unknown>} */ (target);
    const rect = parseCaptureRect(targetObj.rect);
    if (!rect) {
      const err = new Error('Viewport capture rect is empty or invalid.');
      err.status = 409;
      err.code = 'viewport_unavailable';
      throw err;
    }

    let image;
    try {
      image = await win.webContents.capturePage(rect);
    } catch (error) {
      const err = new Error(
        `Failed to capture viewport: ${error instanceof Error ? error.message : String(error)}`,
      );
      err.status = 500;
      err.code = 'capture_failed';
      throw err;
    }

    if (!image || image.isEmpty()) {
      const err = new Error('Viewport capture returned an empty image.');
      err.status = 500;
      err.code = 'capture_failed';
      throw err;
    }

    const maxWidth = clampCaptureMaxWidth(maxWidthRaw);
    const size = image.getSize();
    if (size.width > maxWidth) {
      const height = Math.max(1, Math.round((size.height * maxWidth) / size.width));
      image = image.resize({ width: maxWidth, height, quality: 'better' });
    }

    const finalSize = image.getSize();
    return {
      source: targetObj.source === 'play' ? 'play' : 'scene',
      tab: typeof targetObj.tab === 'string' ? targetObj.tab : null,
      playing: Boolean(targetObj.playing),
      width: finalSize.width,
      height: finalSize.height,
      mimeType: 'image/jpeg',
      data: image.toJPEG(CAPTURE_JPEG_QUALITY).toString('base64'),
    };
  }

  async function handleSession() {
    const repository = deps.getRepository();
    const base = {
      projectRoot: repository?.projectRoot ?? null,
      boot: repository ? 'editor' : 'projects',
      pid: process.pid,
    };
    if (!repository) {
      return { ...base, name: null, backendUrl: null, defaultScene: null, live: null };
    }
    const { document: settings } = await repository.getProjectSettings();
    let live = null;
    try {
      live = await liveOrThrow('session');
    } catch (error) {
      if (error?.code === 'editor_unavailable') {
        return {
          ...base,
          name: settings.name,
          backendUrl: settings.backendUrl,
          defaultScene: settings.defaultScene,
          live: null,
          warning: error.message,
        };
      }
      throw error;
    }
    return {
      ...base,
      name: settings.name,
      backendUrl: settings.backendUrl,
      defaultScene: settings.defaultScene,
      live,
    };
  }

  /**
   * @param {import('node:http').IncomingMessage} req
   * @param {import('node:http').ServerResponse} res
   * @param {URL} url
   */
  async function route(req, res, url) {
    if (!tokenMatches(readToken(req))) {
      json(res, 401, { error: 'unauthorized', message: 'Invalid or missing agent token.' });
      return;
    }

    const path = url.pathname;
    const method = req.method || 'GET';

    try {
      if (method === 'GET' && path === '/agent/v1/session') {
        json(res, 200, await handleSession());
        return;
      }
      if (method === 'GET' && path === '/agent/v1/open_document') {
        json(res, 200, await liveOrThrow('open_document'));
        return;
      }
      if (method === 'GET' && path === '/agent/v1/hierarchy') {
        const depth = Number(url.searchParams.get('depth') || '8');
        const limit = Number(url.searchParams.get('limit') || '400');
        json(res, 200, await liveOrThrow('hierarchy', { depth, limit }));
        return;
      }
      if (method === 'GET' && path === '/agent/v1/selection') {
        json(res, 200, await liveOrThrow('selection'));
        return;
      }
      if (method === 'GET' && path === '/agent/v1/entity') {
        const id = url.searchParams.get('id');
        if (!id) {
          json(res, 400, { error: 'bad_request', message: 'Query param id is required.' });
          return;
        }
        json(res, 200, await liveOrThrow('entity', { id }));
        return;
      }
      if (method === 'GET' && path === '/agent/v1/play_state') {
        json(res, 200, await liveOrThrow('play_state'));
        return;
      }
      if (method === 'GET' && path === '/agent/v1/capture_viewport') {
        const maxWidth = url.searchParams.get('maxWidth') ?? DEFAULT_CAPTURE_MAX_WIDTH;
        json(res, 200, await handleCaptureViewport(maxWidth));
        return;
      }
      if (method === 'GET' && path === '/agent/v1/list_scenes') {
        const repository = await requireProject();
        json(res, 200, await repository.listScenes());
        return;
      }
      if (method === 'GET' && path === '/agent/v1/list_prefabs') {
        const repository = await requireProject();
        json(res, 200, await repository.listPrefabs());
        return;
      }
      if (method === 'GET' && path === '/agent/v1/get_scene') {
        const id = url.searchParams.get('id');
        if (!id) {
          json(res, 400, { error: 'bad_request', message: 'Query param id is required.' });
          return;
        }
        const repository = await requireProject();
        json(res, 200, await repository.getScene(id));
        return;
      }
      if (method === 'GET' && path === '/agent/v1/get_prefab') {
        const id = url.searchParams.get('id');
        if (!id) {
          json(res, 400, { error: 'bad_request', message: 'Query param id is required.' });
          return;
        }
        const repository = await requireProject();
        json(res, 200, await repository.getPrefab(id));
        return;
      }
      if (method === 'POST' && path === '/agent/v1/play') {
        json(res, 200, await liveOrThrow('command', { type: 'play' }));
        return;
      }
      if (method === 'POST' && path === '/agent/v1/stop_play') {
        json(res, 200, await liveOrThrow('command', { type: 'stop_play' }));
        return;
      }
      if (method === 'POST' && path === '/agent/v1/save') {
        json(res, 200, await liveOrThrow('command', { type: 'save' }));
        return;
      }
      if (method === 'POST' && path === '/agent/v1/select_entity') {
        const body = await readBody(req);
        json(res, 200, await liveOrThrow('command', { type: 'select_entity', ...body }));
        return;
      }
      if (method === 'POST' && path === '/agent/v1/open_document_by_id') {
        const body = await readBody(req);
        json(res, 200, await liveOrThrow('command', { type: 'open_document_by_id', ...body }));
        return;
      }

      json(res, 404, { error: 'not_found', message: `Unknown agent route ${method} ${path}` });
    } catch (error) {
      const status = typeof error?.status === 'number' ? error.status : 500;
      const code = typeof error?.code === 'string' ? error.code : 'agent_error';
      const message = error instanceof Error ? error.message : 'Agent request failed.';
      json(res, status, { error: code, message });
    }
  }

  async function start() {
    if (server) return { port, token, discoveryPath: DISCOVERY_PATH };

    server = createServer((req, res) => {
      const host = req.headers.host || `${HOST}:${port}`;
      let url;
      try {
        url = new URL(req.url || '/', `http://${host}`);
      } catch {
        json(res, 400, { error: 'bad_request', message: 'Invalid request URL.' });
        return;
      }
      void route(req, res, url);
    });

    await new Promise((resolve, reject) => {
      server.once('error', reject);
      server.listen(0, HOST, () => {
        const address = server.address();
        port = typeof address === 'object' && address ? address.port : 0;
        resolve();
      });
    });

    await writeDiscovery();
    console.log(`[agent] AsteronEngine agent API on http://${HOST}:${port} (discovery ${DISCOVERY_PATH})`);
    return { port, token, discoveryPath: DISCOVERY_PATH };
  }

  async function stop() {
    const current = server;
    server = null;
    await clearDiscovery();
    if (!current) return;
    await new Promise((resolve) => {
      current.close(() => resolve());
    });
  }

  return {
    start,
    stop,
    getToken: () => token,
    getPort: () => port,
    getDiscoveryPath: () => DISCOVERY_PATH,
    REQUEST_TIMEOUT_MS,
  };
}

/**
 * Main↔renderer request/response correlation for live editor snapshots.
 * @param {() => import('electron').BrowserWindow | null} getEditorWindow
 * @param {import('electron').IpcMain} ipcMain
 */
export function createRendererAgentTransport(getEditorWindow, ipcMain) {
  /** @type {Map<string, { resolve: (value: unknown) => void, reject: (error: Error) => void, timer: NodeJS.Timeout }>} */
  const pending = new Map();

  ipcMain.on('agent:response', (_event, payload) => {
    if (!payload || typeof payload.id !== 'string') return;
    const entry = pending.get(payload.id);
    if (!entry) return;
    clearTimeout(entry.timer);
    pending.delete(payload.id);
    if (payload.ok === false) {
      const error = new Error(
        typeof payload.error?.message === 'string'
          ? payload.error.message
          : 'Renderer agent request failed.',
      );
      error.status = typeof payload.error?.status === 'number' ? payload.error.status : 500;
      error.code = typeof payload.error?.code === 'string' ? payload.error.code : 'renderer_error';
      entry.reject(error);
      return;
    }
    entry.resolve(payload.result);
  });

  /**
   * @param {string} kind
   * @param {Record<string, unknown>} [params]
   */
  function requestRenderer(kind, params = {}) {
    return new Promise((resolve, reject) => {
      const win = getEditorWindow();
      if (!win || win.isDestroyed()) {
        const error = new Error('AsteronEngine editor workspace is not open.');
        error.status = 503;
        error.code = 'editor_unavailable';
        reject(error);
        return;
      }

      const id = randomBytes(16).toString('hex');
      const timer = setTimeout(() => {
        pending.delete(id);
        const error = new Error('Timed out waiting for editor renderer.');
        error.status = 504;
        error.code = 'renderer_timeout';
        reject(error);
      }, REQUEST_TIMEOUT_MS);

      pending.set(id, { resolve, reject, timer });
      win.webContents.send('agent:request', { id, kind, params });
    });
  }

  return { requestRenderer };
}
