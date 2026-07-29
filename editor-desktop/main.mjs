import { spawn } from 'node:child_process';
import { basename, dirname, join, resolve } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { stat, writeFile } from 'node:fs/promises';
import {
  app,
  BrowserWindow,
  dialog,
  ipcMain,
  Menu,
  net,
  protocol,
  shell,
} from 'electron';
import {
  createEditorRepository,
  EditorRepositoryError,
  isInsidePath,
} from './repository.mjs';
import { createProjectHub, isAsteronEngineProject } from './project_hub.mjs';
import {
  formatSidekickPackSummary,
  getSidekickPackStatus,
  resolveSidekickVirtualAsset,
  SIDEKICK_VIRTUAL_URL_PREFIX,
  toProjectRelativePackPath,
  validateSidekickPack,
} from './sidekick_pack.mjs';
import { startDevRenderer } from './dev_renderer.mjs';
import { createAgentServer, createRendererAgentTransport } from './agent_server.mjs';
import { createDeployManager } from './deploy.mjs';
import { createMultiplayerDebugManager } from './multiplayer_debug.mjs';
import { resolvePreferredAssetPath } from '../scripts/derived-assets.mjs';

const EDITOR_SCHEME = 'cceditor';
const EDITOR_HOST = 'app';
const EDITOR_ORIGIN = `${EDITOR_SCHEME}://${EDITOR_HOST}`;
const EXTERNAL_PROTOCOLS = new Set(['http:', 'https:', 'mailto:']);
/** Renderer path prefix forwarded to the project's configured Rust API. */
const BACKEND_PROXY_PREFIX = '/__editor/backend/';
/**
 * `/__editor/mp/<n>/backend/<path>` — the same proxy, but through multiplayer
 * debug instance `n`'s own cookie jar. The index rides in the path rather than
 * a session partition because in `--dev` every renderer request reaches the
 * main process through one session-less Node bridge, where a partitioned
 * protocol handler would never be consulted.
 */
const MP_PROXY_PATTERN = /^\/__editor\/mp\/(\d+)\/backend(\/.*)$/;
const editorDesktopRoot = dirname(fileURLToPath(import.meta.url));
const repositoryRoot = dirname(editorDesktopRoot);
const npmCommand = process.platform === 'win32' ? 'npm.cmd' : 'npm';
const editorDevMode =
  process.argv.includes('--dev')
  || process.env.CLAUDECITIZEN_EDITOR_DEV === '1';
/** @type {null | (() => Promise<void>)} */
let disposeDevRenderer = null;
/** @type {ReturnType<typeof createAgentServer> | null} */
let agentServer = null;
/** @type {ReturnType<typeof createMultiplayerDebugManager> | null} */
let multiplayerDebug = null;

protocol.registerSchemesAsPrivileged([
  {
    scheme: EDITOR_SCHEME,
    privileges: {
      standard: true,
      secure: true,
      supportFetchAPI: true,
      corsEnabled: true,
      stream: true,
      codeCache: true,
    },
  },
]);

function parseProjectRootArgument() {
  const argument = process.argv.find((value) => value.startsWith('--project-root='));
  return argument?.slice('--project-root='.length)
    || process.env.CLAUDECITIZEN_EDITOR_PROJECT_ROOT
    || null;
}

function settingsPath() {
  return join(app.getPath('userData'), 'editor-project.json');
}

function editorWebRoot() {
  return app.isPackaged
    ? join(process.resourcesPath, 'editor')
    : join(repositoryRoot, 'dist-editor');
}

function decodeRelativePath(pathname, prefix) {
  try {
    return decodeURIComponent(pathname.slice(prefix.length));
  } catch {
    return null;
  }
}

function resolveStaticPath(pathname) {
  let decoded;
  try {
    decoded = decodeURIComponent(pathname);
  } catch {
    return null;
  }
  if (decoded.includes('\0')) return null;
  const relativePath = decoded.replace(/^\/+/, '') || 'index.html';
  const root = editorWebRoot();
  const candidate = resolve(root, relativePath);
  return isInsidePath(candidate, root) ? candidate : null;
}

function resolveProjectAsset(repository, pathname) {
  // `/assets/` is the only project mount. `/src/assets/` stays with the engine
  // checkout so Vite keeps owning its bundled imports.
  const prefix = '/assets/';
  if (!pathname.startsWith(prefix)) return null;
  const relativePath = decodeRelativePath(pathname, prefix);
  if (relativePath === null || relativePath.includes('\0')) return null;
  // Read path: prefers the KTX2-compressed twin under `.asteron/derived/`.
  return repository.resolveAssetReadPath('assets', relativePath);
}

async function serveFile(request, path) {
  if (!path || !['GET', 'HEAD'].includes(request.method)) {
    return new Response('Not found', { status: 404 });
  }
  let filePath = path;
  try {
    const fileStat = await stat(filePath);
    if (fileStat.isDirectory()) filePath = join(filePath, 'index.html');
  } catch {
    return new Response('Not found', { status: 404 });
  }
  return net.fetch(pathToFileURL(filePath).toString(), {
    method: request.method,
    headers: request.headers,
  });
}

function jsonResponse(status, payload) {
  return new Response(JSON.stringify(payload), {
    status,
    headers: {
      'Content-Type': 'application/json; charset=utf-8',
      'Cache-Control': 'no-store',
    },
  });
}

async function parseDocumentBody(request) {
  let payload;
  try {
    payload = await request.json();
  } catch {
    throw new EditorRepositoryError('invalid JSON request body');
  }
  return payload?.document;
}

async function parseJsonBody(request) {
  try {
    return await request.json();
  } catch {
    throw new EditorRepositoryError('invalid JSON request body');
  }
}

async function handleEditorApi(repository, request, url) {
  const route = `${request.method} ${url.pathname}`;
  try {
    switch (route) {
      case 'GET /__editor/assets':
        return jsonResponse(200, await repository.listAssets(url.searchParams.get('root')));
      case 'POST /__editor/assets/folder': {
        const body = await parseJsonBody(request);
        return jsonResponse(
          200,
          await repository.createAssetFolder(body?.root, body?.parentPath, body?.name),
        );
      }
      case 'POST /__editor/assets/move': {
        const body = await parseJsonBody(request);
        return jsonResponse(
          200,
          await repository.moveAssetEntry(body?.root, body?.fromPath, body?.toPath),
        );
      }
      case 'POST /__editor/assets/delete': {
        const body = await parseJsonBody(request);
        return jsonResponse(200, await repository.deleteAssetEntry(body?.root, body?.path));
      }
      case 'GET /__editor/prefabs':
        return jsonResponse(200, await repository.listPrefabs());
      case 'GET /__editor/prefab':
        return jsonResponse(200, await repository.getPrefab(url.searchParams.get('id')));
      case 'POST /__editor/prefab': {
        const body = await parseJsonBody(request);
        return jsonResponse(
          200,
          await repository.savePrefab(body?.document, {
            root: body?.root,
            folder: body?.folder,
          }),
        );
      }
      case 'POST /__editor/prefab/rename': {
        const body = await parseJsonBody(request);
        return jsonResponse(
          200,
          await repository.renamePrefab(body?.fromId, body?.toId, body?.name),
        );
      }
      case 'GET /__editor/scenes':
        return jsonResponse(200, await repository.listScenes());
      case 'GET /__editor/scene':
        return jsonResponse(200, await repository.getScene(url.searchParams.get('id')));
      case 'GET /__editor/scene/references':
        return jsonResponse(
          200,
          await repository.listSceneReferences(url.searchParams.get('id')),
        );
      case 'POST /__editor/scene':
        return jsonResponse(200, await repository.saveScene(await parseDocumentBody(request)));
      case 'POST /__editor/scene/delete': {
        const body = await parseJsonBody(request);
        return jsonResponse(200, await repository.deleteScene(body?.id));
      }
      case 'GET /__editor/base-characters':
        return jsonResponse(200, await repository.getBaseCharacters());
      case 'POST /__editor/base-characters':
        return jsonResponse(
          200,
          await repository.saveBaseCharacters(await parseDocumentBody(request)),
        );
      case 'GET /__editor/character-settings':
        return jsonResponse(200, await repository.getCharacterSettings());
      case 'POST /__editor/character-settings':
        return jsonResponse(
          200,
          await repository.saveCharacterSettings(await parseDocumentBody(request)),
        );
      case 'GET /__editor/project-settings':
        return jsonResponse(200, await repository.getProjectSettings());
      case 'POST /__editor/project-settings':
        return jsonResponse(
          200,
          await repository.saveProjectSettings(await parseDocumentBody(request)),
        );
      case 'GET /__editor/folder-order':
        return jsonResponse(200, await repository.getFolderOrder());
      case 'POST /__editor/folder-order':
        return jsonResponse(
          200,
          await repository.saveFolderOrder(await parseDocumentBody(request)),
        );
      case 'GET /__editor/editor-session':
        return jsonResponse(200, await repository.getEditorSession());
      case 'POST /__editor/editor-session':
        return jsonResponse(
          200,
          await repository.saveEditorSession(await parseDocumentBody(request)),
        );
      case 'GET /__editor/animation-controllers':
        return jsonResponse(
          200,
          url.searchParams.has('id')
            ? await repository.getAnimationController(url.searchParams.get('id'))
            : await repository.listAnimationControllers(),
        );
      case 'POST /__editor/animation-controllers':
        return jsonResponse(
          200,
          await repository.saveAnimationController(await parseDocumentBody(request)),
        );
      case 'GET /__editor/planets':
        return jsonResponse(200, await repository.listPlanets());
      case 'GET /__editor/planet':
        return jsonResponse(200, await repository.getPlanet(url.searchParams.get('id')));
      case 'POST /__editor/planet':
        return jsonResponse(200, await repository.savePlanet(await parseDocumentBody(request)));
      case 'GET /__editor/systems':
        return jsonResponse(200, await repository.listSystems());
      case 'GET /__editor/system':
        return jsonResponse(200, await repository.getSystem(url.searchParams.get('id')));
      case 'POST /__editor/system':
        return jsonResponse(200, await repository.saveSystem(await parseDocumentBody(request)));
      case 'GET /__editor/sidekick-pack': {
        const { document: settings } = await repository.getProjectSettings();
        return jsonResponse(
          200,
          await getSidekickPackStatus(
            repository.projectRoot,
            settings.contentPacks.syntySidekick,
          ),
        );
      }
      case 'POST /__editor/sidekick-pack/locate': {
        const body = await parseJsonBody(request);
        const folder = typeof body?.folder === 'string' ? body.folder.trim() : '';
        if (!folder) throw new EditorRepositoryError('folder is required');
        const relativePath = toProjectRelativePackPath(repository.projectRoot, folder);
        const status = await validateSidekickPack(
          resolve(repository.projectRoot, relativePath),
          relativePath,
        );
        if (!status.ok) {
          throw new EditorRepositoryError(
            `Selected folder is not a valid Sidekick pack: ${status.errors.join(' ')}`,
            400,
          );
        }
        const { document: settings } = await repository.getProjectSettings();
        const saved = await repository.saveProjectSettings({
          ...settings,
          contentPacks: {
            ...settings.contentPacks,
            syntySidekick: relativePath,
          },
        });
        return jsonResponse(200, { document: saved.document, status });
      }
      default:
        return jsonResponse(404, { error: `unknown editor API route: ${route}` });
    }
  } catch (error) {
    const status = error instanceof EditorRepositoryError ? error.status : 500;
    if (status === 500) console.error(`[editor-api] ${route} failed:`, error);
    return jsonResponse(status, {
      error: error instanceof Error ? error.message : 'internal editor error',
    });
  }
}

/**
 * Forwards `/__editor/backend/<path>` to the project's configured Rust API.
 *
 * The renderer runs on the `cceditor://app` origin, which the backend's
 * single-origin CORS policy rejects and whose non-HTTP scheme cannot hold the
 * `cc_at` / `cc_rt` / `cc_admin` cookies. Proxying through the main process
 * sidesteps both: `net.fetch` is not subject to CORS and the main session owns
 * a normal cookie jar keyed to the backend's own origin.
 *
 * `fetcher` is that jar. The editor passes the global `net.fetch`; multiplayer
 * debug windows pass their own partitioned session's `fetch`, which is what
 * lets several windows be several different signed-in players at once.
 */
async function proxyBackendRequest(repository, request, backendPath, fetcher) {
  const { document: settings } = await repository.getProjectSettings();
  // Authoring talks to the editor backend, never the release stamp.
  const backendBase = settings.editorBackendUrl || settings.backendUrl;
  let target;
  try {
    target = new URL(backendPath, `${backendBase}/`);
  } catch {
    return jsonResponse(400, { error: 'invalid backend request path' });
  }
  if (!target.href.startsWith(`${backendBase}/`)) {
    return jsonResponse(403, { error: 'backend request escapes the configured host' });
  }

  const headers = new Headers();
  for (const name of ['content-type', 'accept']) {
    const value = request.headers.get(name);
    if (value) headers.set(name, value);
  }

  const hasBody = !['GET', 'HEAD'].includes(request.method);
  try {
    const response = await fetcher(target.toString(), {
      method: request.method,
      headers,
      ...(hasBody ? { body: await request.arrayBuffer() } : {}),
      credentials: 'include',
    });
    // Strip Set-Cookie: the main session already stored it, and the renderer
    // origin cannot hold backend cookies anyway.
    // Also drop framing / encoding headers: net.fetch may decompress the body
    // while leaving content-encoding + the compressed content-length in place
    // (common when backendUrl goes through Caddy). Re-advertising those breaks
    // the editor-dev Node HTTP bridge → Vite proxy.
    const forwarded = new Headers(response.headers);
    for (const name of [
      'set-cookie',
      'access-control-allow-origin',
      'content-encoding',
      'content-length',
      'transfer-encoding',
      'connection',
      'keep-alive',
      'alt-svc',
    ]) {
      forwarded.delete(name);
    }
    const body = Buffer.from(await response.arrayBuffer());
    forwarded.set('content-length', String(body.byteLength));
    return new Response(body, {
      status: response.status,
      statusText: response.statusText,
      headers: forwarded,
    });
  } catch (error) {
    return jsonResponse(502, {
      error: `backend request failed: ${error instanceof Error ? error.message : 'unknown error'}`,
    });
  }
}

async function serveEditorRequest(getRepository, request) {
  const url = new URL(request.url);
  if (url.protocol !== `${EDITOR_SCHEME}:` || url.host !== EDITOR_HOST) {
    return new Response('Not found', { status: 404 });
  }
  const multiplayerRoute = MP_PROXY_PATTERN.exec(url.pathname);
  if (multiplayerRoute) {
    const repository = getRepository();
    if (!repository) {
      return jsonResponse(503, { error: 'No AsteronEngine project is open.' });
    }
    const instanceSession = multiplayerDebug?.sessionForInstance(Number(multiplayerRoute[1]));
    if (!instanceSession) {
      return jsonResponse(403, { error: 'Unknown multiplayer debug instance.' });
    }
    return proxyBackendRequest(
      repository,
      request,
      `${multiplayerRoute[2]}${url.search}`,
      (input, init) => instanceSession.fetch(input, init),
    );
  }
  if (url.pathname.startsWith(BACKEND_PROXY_PREFIX)) {
    const repository = getRepository();
    if (!repository) {
      return jsonResponse(503, { error: 'No AsteronEngine project is open.' });
    }
    return proxyBackendRequest(
      repository,
      request,
      `${url.pathname.slice(BACKEND_PROXY_PREFIX.length - 1)}${url.search}`,
      (input, init) => net.fetch(input, init),
    );
  }
  if (url.pathname.startsWith('/__editor/')) {
    const repository = getRepository();
    if (!repository) {
      return jsonResponse(503, { error: 'No AsteronEngine project is open.' });
    }
    return handleEditorApi(repository, request, url);
  }
  const repository = getRepository();
  if (repository) {
    if (url.pathname.startsWith(SIDEKICK_VIRTUAL_URL_PREFIX)) {
      try {
        const { document: settings } = await repository.getProjectSettings();
        const absolute = resolveSidekickVirtualAsset(
          repository.projectRoot,
          settings.contentPacks.syntySidekick,
          url.pathname,
        );
        if (absolute) {
          return serveFile(
            request,
            resolvePreferredAssetPath(repository.projectRoot, absolute),
          );
        }
      } catch (error) {
        const status = error instanceof EditorRepositoryError ? error.status : 500;
        return jsonResponse(status, {
          error: error instanceof Error ? error.message : 'Sidekick asset error',
        });
      }
    }
    const projectAsset = resolveProjectAsset(repository, url.pathname);
    if (projectAsset) return serveFile(request, projectAsset);
  }
  return serveFile(request, resolveStaticPath(url.pathname));
}

function isTrustedNavigation(rawUrl, trustedOrigins) {
  let url;
  try {
    url = new URL(rawUrl);
  } catch {
    return false;
  }
  if (url.protocol === `${EDITOR_SCHEME}:` && url.host === EDITOR_HOST) return true;
  return trustedOrigins.has(url.origin);
}

function openExternal(rawUrl) {
  let url;
  try {
    url = new URL(rawUrl);
  } catch {
    return;
  }
  if (!EXTERNAL_PROTOCOLS.has(url.protocol)) return;
  void shell.openExternal(url.toString()).catch((error) => {
    console.error(`[editor] Could not open external URL ${url.toString()}:`, error);
  });
}

function configureNavigation(window, trustedOrigins) {
  window.webContents.setWindowOpenHandler(({ url }) => {
    openExternal(url);
    return { action: 'deny' };
  });
  window.webContents.on('will-navigate', (event, url) => {
    if (isTrustedNavigation(url, trustedOrigins)) return;
    event.preventDefault();
    openExternal(url);
  });
  window.webContents.on('will-attach-webview', (event) => {
    event.preventDefault();
  });
  window.webContents.on('console-message', (_event, level, message, line, sourceId) => {
    if (!editorDevMode || level < 2) return;
    console.error(`[renderer] ${message} (${sourceId}:${line})`);
  });
  window.webContents.on('did-fail-load', (_event, code, description, validatedURL, isMainFrame) => {
    if (!isMainFrame) return;
    console.error(`[renderer] did-fail-load ${code} ${description} ${validatedURL}`);
  });
  if (editorDevMode) {
    window.webContents.openDevTools({ mode: 'detach' });
  }
}

/** Rewrite a bridge HTTP request onto the privileged editor origin. */
function toEditorProtocolRequest(request) {
  const url = new URL(request.url);
  return new Request(`${EDITOR_ORIGIN}${url.pathname}${url.search}`, request);
}

function browserWindowOptions(overrides = {}) {
  return {
    backgroundColor: '#02070d',
    show: false,
    webPreferences: {
      preload: join(editorDesktopRoot, 'preload.cjs'),
      contextIsolation: true,
      nodeIntegration: false,
      sandbox: true,
      webSecurity: true,
      devTools: true,
    },
    ...overrides,
  };
}

function sendState(window, channel, state) {
  if (!window || window.isDestroyed()) return;
  window.webContents.send(channel, state);
}

function sendEditorCommand(getWindow, type) {
  sendState(getWindow(), 'editor:native-command', { type });
}

function viewMenuTemplate() {
  return {
    label: 'View',
    submenu: [
      { role: 'reload' },
      { role: 'forceReload' },
      { role: 'toggleDevTools' },
      { type: 'separator' },
      { role: 'resetZoom' },
      { role: 'zoomIn' },
      { role: 'zoomOut' },
      { role: 'togglefullscreen' },
    ],
  };
}

/** Menu for the Projects hub — no scene/prefab/play actions. */
function installProjectsApplicationMenu({ getProjectsWindow, onOpenProject }) {
  const menu = Menu.buildFromTemplate([
    {
      label: 'File',
      submenu: [
        {
          label: 'New Project',
          accelerator: 'CmdOrCtrl+N',
          click: () => sendEditorCommand(getProjectsWindow, 'new-project'),
        },
        {
          label: 'Open Project…',
          accelerator: 'CmdOrCtrl+O',
          click: () => void onOpenProject(),
        },
        { type: 'separator' },
        { role: 'quit' },
      ],
    },
    viewMenuTemplate(),
    {
      label: 'Help',
      submenu: [
        {
          label: 'Create or open a project to start authoring.',
          enabled: false,
        },
      ],
    },
  ]);
  Menu.setApplicationMenu(menu);
}

/** Full authoring menu — only while an editor workspace is open. */
function installEditorApplicationMenu({
  getWindow,
  getProjectRoot,
  returnToProjects,
  onLocateSidekickPack,
  onValidateSidekickPack,
  onRevealSidekickPack,
}) {
  const menu = Menu.buildFromTemplate([
    {
      label: 'File',
      submenu: [
        {
          label: 'New Scene',
          click: () => sendEditorCommand(getWindow, 'new-scene'),
        },
        {
          label: 'Open Scene…',
          click: () => sendEditorCommand(getWindow, 'open-scene'),
        },
        {
          label: 'Scene Settings…',
          click: () => sendEditorCommand(getWindow, 'open-scene-settings'),
        },
        {
          label: 'Delete Scene…',
          click: () => sendEditorCommand(getWindow, 'delete-scene'),
        },
        {
          label: 'Project Settings…',
          click: () => sendEditorCommand(getWindow, 'open-project-settings'),
        },
        { type: 'separator' },
        {
          label: 'New Prefab',
          click: () => sendEditorCommand(getWindow, 'new-prefab'),
        },
        {
          label: 'Open Prefab…',
          click: () => sendEditorCommand(getWindow, 'open-prefab'),
        },
        { type: 'separator' },
        {
          label: 'Open Planets…',
          click: () => sendEditorCommand(getWindow, 'open-planet'),
        },
        {
          label: 'Open Menus…',
          click: () => sendEditorCommand(getWindow, 'open-menu'),
        },
        { type: 'separator' },
        {
          label: 'Save',
          accelerator: 'CmdOrCtrl+S',
          click: () => sendEditorCommand(getWindow, 'save'),
        },
        { type: 'separator' },
        {
          label: 'Open Project…',
          accelerator: 'CmdOrCtrl+O',
          click: () => void returnToProjects(),
        },
        {
          label: 'Show Project Folder',
          click: () => {
            const projectRoot = getProjectRoot();
            if (projectRoot) void shell.openPath(projectRoot);
          },
        },
        { type: 'separator' },
        {
          label: 'Build Web',
          accelerator: 'CmdOrCtrl+B',
          click: () => sendEditorCommand(getWindow, 'build-web'),
        },
        { type: 'separator' },
        {
          label: 'Exit to Title',
          click: () => sendEditorCommand(getWindow, 'exit-to-title'),
        },
        { role: 'quit' },
      ],
    },
    {
      label: 'Edit',
      submenu: [
        {
          label: 'Undo',
          accelerator: 'CmdOrCtrl+Z',
          click: () => sendEditorCommand(getWindow, 'undo'),
        },
        {
          label: 'Redo',
          accelerator: 'CmdOrCtrl+Y',
          click: () => sendEditorCommand(getWindow, 'redo'),
        },
        { type: 'separator' },
        {
          label: 'Duplicate',
          accelerator: 'CmdOrCtrl+D',
          click: () => sendEditorCommand(getWindow, 'duplicate'),
        },
        {
          label: 'Delete',
          accelerator: 'Delete',
          click: () => sendEditorCommand(getWindow, 'delete'),
        },
      ],
    },
    {
      label: 'Play',
      submenu: [
        {
          label: 'Play / Stop',
          accelerator: 'F6',
          click: () => sendEditorCommand(getWindow, 'play'),
        },
        {
          label: 'Pause / Resume',
          accelerator: 'F7',
          click: () => sendEditorCommand(getWindow, 'pause-play'),
        },
        {
          label: 'Stop',
          accelerator: 'Shift+F6',
          click: () => sendEditorCommand(getWindow, 'stop-play'),
        },
      ],
    },
    {
      label: 'Deploy',
      submenu: [
        {
          label: 'Front End…',
          click: () => sendEditorCommand(getWindow, 'deploy-frontend'),
        },
        {
          label: 'Backend…',
          click: () => sendEditorCommand(getWindow, 'deploy-backend'),
        },
      ],
    },
    {
      label: 'Debug',
      submenu: [
        {
          label: 'Multiplayer…',
          click: () => sendEditorCommand(getWindow, 'open-multiplayer-debug'),
        },
      ],
    },
    {
      label: 'Tools',
      submenu: [
        {
          label: 'Locate Synty Sidekick Pack…',
          click: () => void onLocateSidekickPack(),
        },
        {
          label: 'Validate Sidekick Pack',
          click: () => void onValidateSidekickPack(),
        },
        {
          label: 'Reveal Sidekick Pack',
          click: () => void onRevealSidekickPack(),
        },
      ],
    },
    viewMenuTemplate(),
    {
      label: 'Help',
      submenu: [
        { label: 'Viewport', enabled: false },
        { label: 'LMB — select / orbit', enabled: false },
        { label: 'MMB — pan', enabled: false },
        { label: 'Wheel — zoom', enabled: false },
        { label: 'RMB + WASD — fly', enabled: false },
        { type: 'separator' },
        { label: 'Gizmo', enabled: false },
        { label: 'W / E / R — move / rotate / scale', enabled: false },
        { label: 'F — focus selection', enabled: false },
        { type: 'separator' },
        { label: 'Edit', enabled: false },
        { label: 'Ctrl+S — save', enabled: false },
        { label: 'Ctrl+Z / Ctrl+Y — undo / redo', enabled: false },
        { label: 'Ctrl+D — duplicate', enabled: false },
        { label: 'Del — delete selection', enabled: false },
      ],
    },
  ]);
  Menu.setApplicationMenu(menu);
}

let keepAliveForTransition = false;

const hasSingleInstanceLock = app.requestSingleInstanceLock();
if (!hasSingleInstanceLock) {
  app.quit();
} else {
  let projectsWindow = null;
  let mainWindow = null;
  let repository = null;
  let buildProcess = null;
  let rendererOrigin = EDITOR_ORIGIN;
  const trustedOrigins = new Set();

  const projectHub = createProjectHub({ settingsPath });
  const { requestRenderer } = createRendererAgentTransport(
    () => (mainWindow && !mainWindow.isDestroyed() ? mainWindow : null),
    ipcMain,
  );

  const withWindowTransition = async (work) => {
    keepAliveForTransition = true;
    try {
      return await work();
    } finally {
      keepAliveForTransition = false;
    }
  };

  const editorParentWindow = () =>
    (mainWindow && !mainWindow.isDestroyed() && mainWindow) || null;

  const showSidekickMessage = async (options) => {
    const parent = editorParentWindow();
    if (parent) await dialog.showMessageBox(parent, options);
    else await dialog.showMessageBox(options);
  };

  const locateSidekickPackFromDialog = async () => {
    if (!repository) {
      await showSidekickMessage({
        type: 'error',
        title: 'No Project Open',
        message: 'Open an AsteronEngine project before locating a Sidekick pack.',
      });
      return;
    }
    const parent = editorParentWindow();
    const pickOptions = {
      title: 'Locate Synty Sidekick Pack',
      message: 'Select the Sidekick pack folder inside this project (contains manifest.json).',
      defaultPath: repository.projectRoot,
      properties: ['openDirectory'],
    };
    const result = parent
      ? await dialog.showOpenDialog(parent, pickOptions)
      : await dialog.showOpenDialog(pickOptions);
    if (result.canceled || result.filePaths.length !== 1) return;

    try {
      const absoluteDir = resolve(result.filePaths[0]);
      const relativePath = toProjectRelativePackPath(repository.projectRoot, absoluteDir);
      const status = await validateSidekickPack(absoluteDir, relativePath);
      if (!status.ok) {
        await showSidekickMessage({
          type: 'error',
          title: 'Invalid Sidekick Pack',
          message: formatSidekickPackSummary(status),
          detail: absoluteDir,
        });
        return;
      }
      const { document: settings } = await repository.getProjectSettings();
      await repository.saveProjectSettings({
        ...settings,
        contentPacks: {
          ...settings.contentPacks,
          syntySidekick: relativePath,
        },
      });
      sendEditorCommand(() => mainWindow, 'sidekick-pack-changed');
      await showSidekickMessage({
        type: 'info',
        title: 'Sidekick Pack Located',
        message: formatSidekickPackSummary(status),
        detail: `Saved to Project Settings:\ncontentPacks.syntySidekick = ${relativePath}`,
      });
    } catch (error) {
      await showSidekickMessage({
        type: 'error',
        title: 'Locate Sidekick Failed',
        message: error instanceof Error ? error.message : 'Locate failed.',
      });
    }
  };

  const validateSidekickPackDialog = async () => {
    if (!repository) {
      await showSidekickMessage({
        type: 'error',
        title: 'No Project Open',
        message: 'Open an AsteronEngine project before validating the Sidekick pack.',
      });
      return;
    }
    const { document: settings } = await repository.getProjectSettings();
    const status = await getSidekickPackStatus(
      repository.projectRoot,
      settings.contentPacks.syntySidekick,
    );
    await showSidekickMessage({
      type: status.ok ? 'info' : status.configured ? 'warning' : 'error',
      title: 'Sidekick Pack Status',
      message: formatSidekickPackSummary(status),
      detail: status.path,
    });
  };

  const revealSidekickPack = async () => {
    if (!repository) {
      await showSidekickMessage({
        type: 'error',
        title: 'No Project Open',
        message: 'Open an AsteronEngine project first.',
      });
      return;
    }
    const { document: settings } = await repository.getProjectSettings();
    const status = await getSidekickPackStatus(
      repository.projectRoot,
      settings.contentPacks.syntySidekick,
    );
    if (!status.configured || !status.present) {
      await showSidekickMessage({
        type: 'warning',
        title: 'Sidekick Pack Missing',
        message: formatSidekickPackSummary(status),
      });
      return;
    }
    await shell.openPath(status.path);
  };

  const showProjectsMenu = () => {
    installProjectsApplicationMenu({
      getProjectsWindow: () => projectsWindow,
      onOpenProject: () => chooseAndOpenProject(),
    });
  };

  const showEditorMenu = () => {
    installEditorApplicationMenu({
      getWindow: () => mainWindow,
      getProjectRoot: () => repository?.projectRoot ?? null,
      returnToProjects,
      onLocateSidekickPack: locateSidekickPackFromDialog,
      onValidateSidekickPack: validateSidekickPackDialog,
      onRevealSidekickPack: revealSidekickPack,
    });
  };

  const createProjectsWindow = async () => {
    showProjectsMenu();
    if (projectsWindow && !projectsWindow.isDestroyed()) {
      projectsWindow.show();
      projectsWindow.focus();
      return projectsWindow;
    }

    projectsWindow = new BrowserWindow({
      ...browserWindowOptions(),
      title: 'AsteronEngine — Projects',
      width: 960,
      height: 640,
      minWidth: 720,
      minHeight: 480,
    });
    configureNavigation(projectsWindow, trustedOrigins);
    projectsWindow.once('ready-to-show', () => projectsWindow?.show());
    projectsWindow.once('closed', () => {
      projectsWindow = null;
    });
    await projectsWindow.loadURL(`${rendererOrigin}/editor.html?boot=projects`);
    return projectsWindow;
  };

  const createEditorWindow = async () => {
    showEditorMenu();
    if (mainWindow && !mainWindow.isDestroyed()) {
      mainWindow.show();
      mainWindow.focus();
      return mainWindow;
    }

    mainWindow = new BrowserWindow({
      ...browserWindowOptions(),
      title: 'AsteronEngine',
      width: 1600,
      height: 1000,
      minWidth: 1024,
      minHeight: 640,
    });
    configureNavigation(mainWindow, trustedOrigins);
    mainWindow.once('ready-to-show', () => mainWindow?.show());
    mainWindow.once('closed', () => {
      // Before the transition guard: orphaned debug windows would otherwise keep
      // `window-all-closed` from ever firing, and the hub would reopen beside them.
      void multiplayerDebug?.stopAll();
      mainWindow = null;
      if (keepAliveForTransition) return;
      repository = null;
      void withWindowTransition(() => createProjectsWindow());
    });
    await mainWindow.loadURL(`${rendererOrigin}/editor.html?boot=editor`);
    return mainWindow;
  };

  const bindProject = async (projectRoot) => {
    const root = resolve(projectRoot);
    if (!(await isAsteronEngineProject(root))) {
      throw new Error('The selected folder is not an AsteronEngine project.');
    }
    await projectHub.rememberProject(root);
    repository = createEditorRepository(root, { engineRoot: repositoryRoot });
    return root;
  };

  const openProjectRoot = async (projectRoot) => {
    await bindProject(projectRoot);
    return withWindowTransition(async () => {
      if (projectsWindow && !projectsWindow.isDestroyed()) {
        projectsWindow.close();
      }
      await createEditorWindow();
      return { projectRoot: repository.projectRoot };
    });
  };

  const returnToProjects = async () => {
    await multiplayerDebug?.stopAll();
    await withWindowTransition(async () => {
      if (mainWindow && !mainWindow.isDestroyed()) {
        mainWindow.close();
      }
      repository = null;
      await createProjectsWindow();
    });
  };

  const chooseDirectory = async (options) => {
    const parent =
      (projectsWindow && !projectsWindow.isDestroyed() && projectsWindow)
      || (mainWindow && !mainWindow.isDestroyed() && mainWindow)
      || null;
    const result = parent
      ? await dialog.showOpenDialog(parent, options)
      : await dialog.showOpenDialog(options);
    if (result.canceled || result.filePaths.length !== 1) return null;
    return resolve(result.filePaths[0]);
  };

  const chooseAndOpenProject = async () => {
    const candidate = await chooseDirectory({
      title: 'Open AsteronEngine Project',
      message: 'Select an AsteronEngine project folder.',
      properties: ['openDirectory'],
    });
    if (!candidate) return { canceled: true };
    if (!(await isAsteronEngineProject(candidate))) {
      const parent =
        (projectsWindow && !projectsWindow.isDestroyed() && projectsWindow)
        || null;
      const messageOptions = {
        type: 'error',
        title: 'Invalid AsteronEngine Project',
        message: 'The selected folder is not an AsteronEngine project.',
        detail: 'Expected package.json and an assets/ folder.',
      };
      if (parent) await dialog.showMessageBox(parent, messageOptions);
      else await dialog.showMessageBox(messageOptions);
      return { canceled: true, error: 'invalid-project' };
    }
    return openProjectRoot(candidate);
  };

  const buildWeb = async ({ showResultDialog = false } = {}) => {
    if (!repository) throw new Error('No AsteronEngine project is open.');
    if (buildProcess) {
      const result = { ok: false, message: 'A web build is already running.' };
      sendState(mainWindow, 'editor:build-state', { phase: 'error', ...result });
      return result;
    }

    const projectRoot = repository.projectRoot;
    const { document: projectSettings } = await repository.getProjectSettings();
    const outputDir = join(projectRoot, projectSettings.build.outDir);
    let outputTail = '';
    sendState(mainWindow, 'editor:build-state', {
      phase: 'building',
      message: 'Building web release…',
      outputDir,
    });

    const result = await new Promise((resolveResult) => {
      // Runs in the engine checkout, not the project: the project owns content
      // but the engine owns index.html, the Vite config, and every bundling
      // glob. build_project_web.mjs stages the two together and writes the
      // release into the project's configured build.outDir.
      const child = spawn(npmCommand, ['run', 'build:project-web', '--', '--project', projectRoot], {
        cwd: repositoryRoot,
        env: { ...process.env, CI: '1' },
        stdio: ['ignore', 'pipe', 'pipe'],
      });
      buildProcess = child;

      const collectOutput = (chunk) => {
        outputTail = `${outputTail}${chunk.toString()}`.slice(-24_000);
      };
      child.stdout?.on('data', collectOutput);
      child.stderr?.on('data', collectOutput);
      child.once('error', (error) => {
        buildProcess = null;
        resolveResult({
          ok: false,
          message: `Could not start the web build: ${error.message}`,
          output: outputTail,
        });
      });
      child.once('close', (code) => {
        buildProcess = null;
        resolveResult(
          code === 0
            ? {
                ok: true,
                message: 'Web release built successfully.',
                outputDir,
              }
            : {
                ok: false,
                message: `Web build failed with exit code ${code ?? 'unknown'}.`,
                output: outputTail,
              },
        );
      });
    });

    // The release reads its backend URL at runtime, so the same bundle can be
    // pointed at any deployment by re-stamping this file.
    if (result.ok) {
      try {
        await writeFile(
          join(outputDir, 'asteron.runtime.json'),
          `${JSON.stringify(
            {
              schemaVersion: 1,
              project: projectSettings.name,
              backendUrl: projectSettings.backendUrl,
              bootScene: projectSettings.defaultScene,
            },
            null,
            2,
          )}\n`,
          'utf8',
        );
      } catch (error) {
        result.ok = false;
        result.message = `Web build succeeded but runtime config could not be written: ${error.message}`;
      }
    }

    sendState(mainWindow, 'editor:build-state', {
      phase: result.ok ? 'success' : 'error',
      ...result,
    });

    if (showResultDialog && mainWindow && !mainWindow.isDestroyed()) {
      if (result.ok) {
        const response = await dialog.showMessageBox(mainWindow, {
          type: 'info',
          title: 'Build Complete',
          message: result.message,
          detail: result.outputDir,
          buttons: ['OK', 'Show Build Folder'],
          defaultId: 0,
        });
        if (response.response === 1) void shell.openPath(result.outputDir);
      } else {
        await dialog.showMessageBox(mainWindow, {
          type: 'error',
          title: 'Build Failed',
          message: result.message,
          detail: result.output?.slice(-4_000) || 'No build output was captured.',
        });
      }
    }
    return result;
  };

  // SSH and the local release build both need Node, so deployment lives here and
  // streams progress to the Deploy tab over `editor:deploy-state`.
  const deployManager = createDeployManager({
    getRepository: () => repository,
    repositoryRoot,
    npmCommand,
    onEvent: (event) => sendState(mainWindow, 'editor:deploy-state', event),
  });

  // Assigned to the module-scope binding so `serveEditorRequest` can route
  // `/__editor/mp/<n>/backend/*` through the right instance's cookie jar.
  multiplayerDebug = createMultiplayerDebugManager({
    getRepository: () => repository,
    getRendererOrigin: () => rendererOrigin,
    editorDesktopRoot,
    onEvent: (event) => sendState(mainWindow, 'editor:mp-debug-state', event),
  });

  app.on('second-instance', () => {
    const focus =
      (mainWindow && !mainWindow.isDestroyed() && mainWindow)
      || (projectsWindow && !projectsWindow.isDestroyed() && projectsWindow);
    if (!focus) return;
    if (focus.isMinimized()) focus.restore();
    focus.show();
    focus.focus();
  });

  app.whenReady()
    .then(async () => {
      await protocol.handle(
        EDITOR_SCHEME,
        (request) => serveEditorRequest(() => repository, request),
      );

      if (editorDevMode) {
        console.log('[editor-dev] Starting Vite HMR renderer…');
        const dev = await startDevRenderer({
          repositoryRoot,
          npmCommand,
          serveEditorRequest,
          getRepository: () => repository,
          toEditorProtocolRequest,
        });
        rendererOrigin = dev.rendererOrigin;
        trustedOrigins.add(dev.rendererOrigin);
        disposeDevRenderer = dev.dispose;
        console.log(`[editor-dev] Renderer: ${rendererOrigin}/editor.html`);
      }

      ipcMain.handle('projects:listRecent', () => projectHub.listRecentProjects());
      ipcMain.handle('projects:open', async (_event, projectRoot) => {
        if (typeof projectRoot !== 'string' || !projectRoot.trim()) {
          throw new Error('Project path is required.');
        }
        return openProjectRoot(projectRoot);
      });
      ipcMain.handle('projects:chooseAndOpen', () => chooseAndOpenProject());
      ipcMain.handle('projects:pickDirectory', async () => {
        const candidate = await chooseDirectory({
          title: 'Choose Project Location',
          message: 'Select the folder where the new project will be created.',
          properties: ['openDirectory', 'createDirectory'],
        });
        return candidate ? { path: candidate } : { canceled: true };
      });
      ipcMain.handle('projects:create', async (_event, payload) => {
        const name = payload?.name;
        let parentDir = typeof payload?.parentDir === 'string' ? payload.parentDir : null;
        if (!parentDir) {
          parentDir = await chooseDirectory({
            title: 'Choose Project Location',
            message: 'Select the folder where the new project will be created.',
            properties: ['openDirectory', 'createDirectory'],
          });
          if (!parentDir) return { canceled: true };
        }
        const created = await projectHub.createProject({ name, parentDir });
        return openProjectRoot(created.projectRoot);
      });
      ipcMain.handle('projects:removeRecent', (_event, projectRoot) => {
        if (typeof projectRoot !== 'string' || !projectRoot.trim()) {
          throw new Error('Project path is required.');
        }
        return projectHub.removeRecentProject(projectRoot);
      });
      ipcMain.handle('projects:rename', (_event, payload) => {
        const projectRoot = payload?.projectRoot;
        if (typeof projectRoot !== 'string' || !projectRoot.trim()) {
          throw new Error('Project path is required.');
        }
        return projectHub.renameProject(projectRoot, payload?.name);
      });
      ipcMain.handle('projects:delete', async (_event, projectRoot) => {
        if (typeof projectRoot !== 'string' || !projectRoot.trim()) {
          throw new Error('Project path is required.');
        }
        const root = resolve(projectRoot);
        if (!(await isAsteronEngineProject(root))) {
          throw new Error(`${root} is not an AsteronEngine project.`);
        }
        const recent = await projectHub.listRecentProjects();
        const known = recent.projects.find((entry) => entry.path === root);
        const label = known?.name || basename(root);
        const parent =
          (projectsWindow && !projectsWindow.isDestroyed() && projectsWindow)
          || (mainWindow && !mainWindow.isDestroyed() && mainWindow)
          || null;
        const confirmOptions = {
          type: 'warning',
          title: 'Delete Project',
          message: `Permanently delete “${label}”?`,
          detail:
            `This deletes the entire project folder and cannot be undone:\n${root}\n\n`
            + 'Remove from Recent only forgets the entry; Delete erases the files.',
          buttons: ['Cancel', 'Delete Permanently'],
          defaultId: 0,
          cancelId: 0,
          noLink: true,
        };
        const { response } = parent
          ? await dialog.showMessageBox(parent, confirmOptions)
          : await dialog.showMessageBox(confirmOptions);
        if (response !== 1) return { canceled: true };
        const result = await projectHub.deleteProject(root);
        return { canceled: false, ...result };
      });
      // Stripe Checkout must open in the system browser: the hosted page has to run on
      // stripe.com, and `openExternal` already restricts the scheme to http/https/mailto.
      ipcMain.handle('shell:openExternal', async (_event, rawUrl) => {
        if (typeof rawUrl !== 'string' || !rawUrl.trim()) {
          throw new Error('A URL is required.');
        }
        openExternal(rawUrl);
        return { ok: true };
      });
      ipcMain.handle('projects:showInFolder', async (_event, projectRoot) => {
        if (typeof projectRoot !== 'string' || !projectRoot.trim()) {
          throw new Error('Project path is required.');
        }
        await shell.openPath(resolve(projectRoot));
        return { ok: true };
      });
      ipcMain.handle('projects:returnToHub', async (event) => {
        if (
          event.sender !== mainWindow?.webContents
          && event.sender !== projectsWindow?.webContents
        ) {
          throw new Error('Only the AsteronEngine app may return to Projects.');
        }
        await returnToProjects();
        return { ok: true };
      });

      ipcMain.handle('editor:build-web', (event) => {
        if (event.sender !== mainWindow?.webContents) {
          throw new Error('Only the editor window may build the project.');
        }
        return buildWeb();
      });

      /** Deploy IPC. Every channel is editor-window only — these reach a live server. */
      const deployChannels = {
        'deploy:get-config': () => deployManager.getConfig(),
        'deploy:save-config': (payload) => deployManager.saveConfig(payload),
        'deploy:preflight': () => deployManager.preflight(),
        'deploy:test-connection': () => deployManager.testConnection(),
        'deploy:backend': () => deployManager.deployBackend(),
        'deploy:client': () => deployManager.deployClient(),
        'deploy:cancel': () => deployManager.cancel(),
      };
      for (const [channel, handler] of Object.entries(deployChannels)) {
        ipcMain.handle(channel, (event, payload) => {
          if (event.sender !== mainWindow?.webContents) {
            throw new Error('Only the editor window may deploy.');
          }
          return handler(payload);
        });
      }

      /** Multiplayer debug IPC. The launched game windows must never reach these. */
      const multiplayerChannels = {
        'mp-debug:health': () => multiplayerDebug.checkHealth(),
        'mp-debug:launch': (payload) => multiplayerDebug.launch(payload),
        'mp-debug:stop': () => multiplayerDebug.stopAll(),
        'mp-debug:status': () => multiplayerDebug.status(),
      };
      for (const [channel, handler] of Object.entries(multiplayerChannels)) {
        ipcMain.handle(channel, (event, payload) => {
          if (event.sender !== mainWindow?.webContents) {
            throw new Error('Only the editor window may run multiplayer debug.');
          }
          return handler(payload);
        });
      }

      agentServer = createAgentServer({
        getRepository: () => repository,
        getEditorWindow: () =>
          mainWindow && !mainWindow.isDestroyed() ? mainWindow : null,
        requestRenderer,
      });
      await agentServer.start();

      const explicit = parseProjectRootArgument();
      if (explicit) {
        if (!(await isAsteronEngineProject(explicit))) {
          throw new Error(`Invalid AsteronEngine project root: ${explicit}`);
        }
        await openProjectRoot(explicit);
      } else {
        await createProjectsWindow();
      }

      app.on('activate', () => {
        if (BrowserWindow.getAllWindows().length === 0) {
          void createProjectsWindow();
        }
      });
    })
    .catch((error) => {
      console.error('[editor] Failed to start AsteronEngine:', error);
      app.quit();
    });
}

app.on('window-all-closed', () => {
  if (keepAliveForTransition) return;
  if (process.platform !== 'darwin') app.quit();
});

app.on('will-quit', () => {
  if (multiplayerDebug) {
    const manager = multiplayerDebug;
    multiplayerDebug = null;
    void manager.stopAll();
  }
  if (agentServer) {
    const server = agentServer;
    agentServer = null;
    void server.stop();
  }
  if (!disposeDevRenderer) return;
  const dispose = disposeDevRenderer;
  disposeDevRenderer = null;
  void dispose();
});
