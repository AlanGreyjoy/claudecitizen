import { spawn } from 'node:child_process';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { stat } from 'node:fs/promises';
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

const EDITOR_SCHEME = 'cceditor';
const EDITOR_HOST = 'app';
const EDITOR_ORIGIN = `${EDITOR_SCHEME}://${EDITOR_HOST}`;
const EXTERNAL_PROTOCOLS = new Set(['http:', 'https:', 'mailto:']);
const editorDesktopRoot = dirname(fileURLToPath(import.meta.url));
const repositoryRoot = dirname(editorDesktopRoot);
const npmCommand = process.platform === 'win32' ? 'npm.cmd' : 'npm';

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
  const mounts = [
    { prefix: '/editor/assets/', root: 'editor/assets' },
    { prefix: '/src/assets/', root: 'src/assets' },
  ];
  for (const mount of mounts) {
    if (!pathname.startsWith(mount.prefix)) continue;
    const relativePath = decodeRelativePath(pathname, mount.prefix);
    if (relativePath === null || relativePath.includes('\0')) return null;
    return repository.resolveAssetPath(mount.root, relativePath);
  }

  const protectedPrefix = '/assets/protected/';
  if (pathname.startsWith(protectedPrefix)) {
    const relativePath = decodeRelativePath(pathname, protectedPrefix);
    if (relativePath === null || relativePath.includes('\0')) return null;
    const root = resolve(repository.projectRoot, 'public/assets/protected');
    const candidate = resolve(root, relativePath);
    return isInsidePath(candidate, root) ? candidate : null;
  }
  return null;
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

async function handleEditorApi(repository, request, url) {
  const route = `${request.method} ${url.pathname}`;
  try {
    switch (route) {
      case 'GET /__editor/assets':
        return jsonResponse(200, await repository.listAssets(url.searchParams.get('root')));
      case 'GET /__editor/prefabs':
        return jsonResponse(200, await repository.listPrefabs());
      case 'GET /__editor/prefab':
        return jsonResponse(200, await repository.getPrefab(url.searchParams.get('id')));
      case 'POST /__editor/prefab':
        return jsonResponse(200, await repository.savePrefab(await parseDocumentBody(request)));
      case 'GET /__editor/scenes':
        return jsonResponse(200, await repository.listScenes());
      case 'GET /__editor/scene':
        return jsonResponse(200, await repository.getScene(url.searchParams.get('id')));
      case 'POST /__editor/scene':
        return jsonResponse(200, await repository.saveScene(await parseDocumentBody(request)));
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

async function serveEditorRequest(getRepository, request) {
  const url = new URL(request.url);
  if (url.protocol !== `${EDITOR_SCHEME}:` || url.host !== EDITOR_HOST) {
    return new Response('Not found', { status: 404 });
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
    const projectAsset = resolveProjectAsset(repository, url.pathname);
    if (projectAsset) return serveFile(request, projectAsset);
  }
  return serveFile(request, resolveStaticPath(url.pathname));
}

function isTrustedNavigation(rawUrl) {
  const url = new URL(rawUrl);
  return url.protocol === `${EDITOR_SCHEME}:` && url.host === EDITOR_HOST;
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

function configureNavigation(window) {
  window.webContents.setWindowOpenHandler(({ url }) => {
    openExternal(url);
    return { action: 'deny' };
  });
  window.webContents.on('will-navigate', (event, url) => {
    if (isTrustedNavigation(url)) return;
    event.preventDefault();
    openExternal(url);
  });
  window.webContents.on('will-attach-webview', (event) => {
    event.preventDefault();
  });
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

function resolveEditorRoute(rawRoute) {
  if (typeof rawRoute !== 'string' || rawRoute.length > 2_048) return null;
  try {
    const url = new URL(rawRoute, `${EDITOR_ORIGIN}/`);
    if (url.protocol !== `${EDITOR_SCHEME}:` || url.host !== EDITOR_HOST) return null;
    return url;
  } catch {
    return null;
  }
}

function sendState(window, channel, state) {
  if (!window || window.isDestroyed()) return;
  window.webContents.send(channel, state);
}

function sendEditorCommand(getWindow, type) {
  sendState(getWindow(), 'editor:native-command', { type });
}

function installApplicationMenu({
  getWindow,
  getProjectRoot,
  returnToProjects,
  stopPlay,
  isPlaying,
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
          id: 'play-active-scene',
          label: 'Play Active Scene',
          accelerator: 'F6',
          click: () => {
            if (isPlaying()) stopPlay();
            else sendEditorCommand(getWindow, 'play');
          },
        },
        {
          id: 'stop-play',
          label: 'Stop',
          accelerator: 'Shift+F6',
          enabled: isPlaying(),
          click: () => {
            stopPlay();
            sendEditorCommand(getWindow, 'stop-play');
          },
        },
      ],
    },
    {
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
    },
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

function updatePlayMenuState(isPlaying) {
  const menu = Menu.getApplicationMenu();
  const playItem = menu?.getMenuItemById('play-active-scene');
  const stopItem = menu?.getMenuItemById('stop-play');
  if (playItem) playItem.label = isPlaying ? 'Stop Playing' : 'Play Active Scene';
  if (stopItem) stopItem.enabled = isPlaying;
}

let keepAliveForTransition = false;

const hasSingleInstanceLock = app.requestSingleInstanceLock();
if (!hasSingleInstanceLock) {
  app.quit();
} else {
  let projectsWindow = null;
  let mainWindow = null;
  let playWindow = null;
  let repository = null;
  let buildProcess = null;

  const projectHub = createProjectHub({ settingsPath });

  const withWindowTransition = async (work) => {
    keepAliveForTransition = true;
    try {
      return await work();
    } finally {
      keepAliveForTransition = false;
    }
  };

  const publishPlayState = () => {
    const playing = Boolean(playWindow && !playWindow.isDestroyed());
    updatePlayMenuState(playing);
    sendState(mainWindow, 'editor:play-state', { playing });
  };

  const stopPlay = () => {
    if (playWindow && !playWindow.isDestroyed()) playWindow.close();
  };

  const createProjectsWindow = async () => {
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
    configureNavigation(projectsWindow);
    projectsWindow.once('ready-to-show', () => projectsWindow?.show());
    projectsWindow.once('closed', () => {
      projectsWindow = null;
    });
    await projectsWindow.loadURL(`${EDITOR_ORIGIN}/?boot=projects`);
    return projectsWindow;
  };

  const createEditorWindow = async () => {
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
    configureNavigation(mainWindow);
    mainWindow.once('ready-to-show', () => mainWindow?.show());
    mainWindow.once('closed', () => {
      mainWindow = null;
      if (keepAliveForTransition) return;
      repository = null;
      void withWindowTransition(() => createProjectsWindow());
    });
    await mainWindow.loadURL(`${EDITOR_ORIGIN}/?boot=editor`);
    return mainWindow;
  };

  const bindProject = async (projectRoot) => {
    const root = resolve(projectRoot);
    if (!(await isAsteronEngineProject(root))) {
      throw new Error('The selected folder is not an AsteronEngine project.');
    }
    await projectHub.rememberProject(root);
    repository = createEditorRepository(root);
    return root;
  };

  const openProjectRoot = async (projectRoot) => {
    await bindProject(projectRoot);
    stopPlay();
    return withWindowTransition(async () => {
      if (projectsWindow && !projectsWindow.isDestroyed()) {
        projectsWindow.close();
      }
      await createEditorWindow();
      return { projectRoot: repository.projectRoot };
    });
  };

  const returnToProjects = async () => {
    stopPlay();
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

  const play = async (rawRoute) => {
    const url = resolveEditorRoute(rawRoute);
    if (!url) throw new Error('Play route must stay inside the editor application.');

    if (playWindow && !playWindow.isDestroyed()) {
      await playWindow.loadURL(url.toString());
      playWindow.show();
      playWindow.focus();
      publishPlayState();
      return { playing: true };
    }

    playWindow = new BrowserWindow({
      ...browserWindowOptions(),
      title: 'AsteronEngine — Play Mode',
      width: 1440,
      height: 900,
      minWidth: 960,
      minHeight: 600,
    });
    configureNavigation(playWindow);
    playWindow.once('ready-to-show', () => playWindow?.show());
    playWindow.once('closed', () => {
      playWindow = null;
      publishPlayState();
    });
    await playWindow.loadURL(url.toString());
    publishPlayState();
    return { playing: true };
  };

  const buildWeb = async ({ showResultDialog = false } = {}) => {
    if (!repository) throw new Error('No AsteronEngine project is open.');
    if (buildProcess) {
      const result = { ok: false, message: 'A web build is already running.' };
      sendState(mainWindow, 'editor:build-state', { phase: 'error', ...result });
      return result;
    }

    const projectRoot = repository.projectRoot;
    const outputDir = join(projectRoot, 'dist');
    let outputTail = '';
    sendState(mainWindow, 'editor:build-state', {
      phase: 'building',
      message: 'Building web release…',
      outputDir,
    });

    const result = await new Promise((resolveResult) => {
      const child = spawn(npmCommand, ['run', 'build:web'], {
        cwd: projectRoot,
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

      ipcMain.handle('projects:listRecent', () => projectHub.listRecentProjects());
      ipcMain.handle('projects:open', async (_event, projectRoot) => {
        if (typeof projectRoot !== 'string' || !projectRoot.trim()) {
          throw new Error('Project path is required.');
        }
        return openProjectRoot(projectRoot);
      });
      ipcMain.handle('projects:chooseAndOpen', async () => {
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
            detail: 'Expected package.json and src/world/prefabs/data/.',
          };
          if (parent) await dialog.showMessageBox(parent, messageOptions);
          else await dialog.showMessageBox(messageOptions);
          return { canceled: true, error: 'invalid-project' };
        }
        return openProjectRoot(candidate);
      });
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

      ipcMain.handle('editor:get-play-state', () => ({
        playing: Boolean(playWindow && !playWindow.isDestroyed()),
      }));
      ipcMain.handle('editor:play', (event, rawRoute) => {
        if (event.sender !== mainWindow?.webContents) {
          throw new Error('Only the editor window may start Play Mode.');
        }
        return play(rawRoute);
      });
      ipcMain.handle('editor:stop-play', (event) => {
        if (
          event.sender !== mainWindow?.webContents
          && event.sender !== playWindow?.webContents
        ) {
          return { playing: false };
        }
        stopPlay();
        return { playing: false };
      });
      ipcMain.handle('editor:build-web', (event) => {
        if (event.sender !== mainWindow?.webContents) {
          throw new Error('Only the editor window may build the project.');
        }
        return buildWeb();
      });

      installApplicationMenu({
        getWindow: () => mainWindow,
        getProjectRoot: () => repository?.projectRoot ?? null,
        returnToProjects,
        stopPlay,
        isPlaying: () => Boolean(playWindow && !playWindow.isDestroyed()),
      });
      publishPlayState();

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
