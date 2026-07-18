import { stat } from 'node:fs/promises';
import { dirname, isAbsolute, join, relative, resolve, sep } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { app, BrowserWindow, Menu, net, protocol, shell } from 'electron';

const GAME_SCHEME = 'ccgame';
const GAME_HOST = 'app';
const GAME_ORIGIN = `${GAME_SCHEME}://${GAME_HOST}`;
const EXTERNAL_PROTOCOLS = new Set(['http:', 'https:', 'mailto:', 'steam:']);
const desktopRoot = dirname(fileURLToPath(import.meta.url));
const projectRoot = dirname(desktopRoot);

protocol.registerSchemesAsPrivileged([
  {
    scheme: GAME_SCHEME,
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

function parseDevUrl() {
  const argument = process.argv.find((value) => value.startsWith('--dev-url='));
  const rawUrl = argument?.slice('--dev-url='.length) || process.env.CLAUDECITIZEN_DESKTOP_DEV_URL;
  if (!rawUrl) return null;

  const url = new URL(rawUrl);
  const isLoopback = ['127.0.0.1', 'localhost', '[::1]'].includes(url.hostname);
  if (!isLoopback || !['http:', 'https:'].includes(url.protocol)) {
    throw new Error(`Desktop development URL must use HTTP(S) on loopback: ${rawUrl}`);
  }
  return url;
}

function gameRoot() {
  return app.isPackaged ? join(process.resourcesPath, 'game') : join(projectRoot, 'dist');
}

function resolveGameAsset(requestUrl) {
  const url = new URL(requestUrl);
  if (url.protocol !== `${GAME_SCHEME}:` || url.host !== GAME_HOST) return null;

  let pathname;
  try {
    pathname = decodeURIComponent(url.pathname);
  } catch {
    return null;
  }
  if (pathname.includes('\0')) return null;

  const relativePath = pathname.replace(/^\/+/, '') || 'index.html';
  const root = gameRoot();
  const candidate = resolve(root, relativePath);
  const pathFromRoot = relative(root, candidate);
  const escapedRoot =
    pathFromRoot === '..' || pathFromRoot.startsWith(`..${sep}`) || isAbsolute(pathFromRoot);
  return escapedRoot ? null : candidate;
}

async function serveGameAsset(request) {
  let assetPath = resolveGameAsset(request.url);
  if (!assetPath) return new Response('Not found', { status: 404 });

  try {
    const assetStat = await stat(assetPath);
    if (assetStat.isDirectory()) assetPath = join(assetPath, 'index.html');
  } catch {
    return new Response('Not found', { status: 404 });
  }

  return net.fetch(pathToFileURL(assetPath).toString(), {
    method: request.method,
    headers: request.headers,
  });
}

function isTrustedNavigation(rawUrl, devUrl) {
  const url = new URL(rawUrl);
  if (devUrl) return url.origin === devUrl.origin;
  return url.protocol === `${GAME_SCHEME}:` && url.host === GAME_HOST;
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
    console.error(`[desktop] Could not open external URL ${url.toString()}:`, error);
  });
}

function configureNavigation(window, devUrl) {
  window.webContents.setWindowOpenHandler(({ url }) => {
    openExternal(url);
    return { action: 'deny' };
  });

  window.webContents.on('will-navigate', (event, url) => {
    if (isTrustedNavigation(url, devUrl)) return;
    event.preventDefault();
    openExternal(url);
  });

  window.webContents.on('will-attach-webview', (event) => {
    event.preventDefault();
  });
}

function configureFullscreenShortcut(window) {
  window.webContents.on('before-input-event', (event, input) => {
    if (input.type !== 'keyDown' || input.isAutoRepeat) return;
    const toggleFullscreen = input.key === 'F11' || (input.alt && input.key === 'Enter');
    if (!toggleFullscreen) return;
    event.preventDefault();
    window.setFullScreen(!window.isFullScreen());
  });
}

async function createMainWindow(devUrl) {
  const window = new BrowserWindow({
    title: 'ClaudeCitizen',
    width: 1600,
    height: 1000,
    minWidth: 1024,
    minHeight: 640,
    backgroundColor: '#02070d',
    autoHideMenuBar: true,
    show: false,
    webPreferences: {
      preload: join(desktopRoot, 'preload.cjs'),
      contextIsolation: true,
      nodeIntegration: false,
      sandbox: true,
      webSecurity: true,
      devTools: !app.isPackaged || process.argv.includes('--enable-devtools'),
    },
  });

  configureNavigation(window, devUrl);
  configureFullscreenShortcut(window);
  window.once('ready-to-show', () => window.show());

  await window.loadURL(devUrl?.toString() ?? `${GAME_ORIGIN}/`);
  return window;
}

const hasSingleInstanceLock = app.requestSingleInstanceLock();
if (!hasSingleInstanceLock) {
  app.quit();
} else {
  let mainWindow = null;

  app.on('second-instance', () => {
    if (!mainWindow) return;
    if (mainWindow.isMinimized()) mainWindow.restore();
    mainWindow.show();
    mainWindow.focus();
  });

  app.whenReady()
    .then(async () => {
      const devUrl = parseDevUrl();
      if (!devUrl) await protocol.handle(GAME_SCHEME, serveGameAsset);
      Menu.setApplicationMenu(null);
      mainWindow = await createMainWindow(devUrl);

      app.on('activate', () => {
        if (BrowserWindow.getAllWindows().length === 0) {
          void createMainWindow(devUrl).then((window) => {
            mainWindow = window;
          });
        }
      });
    })
    .catch((error) => {
      console.error('[desktop] Failed to start ClaudeCitizen:', error);
      app.quit();
    });
}

app.on('window-all-closed', () => {
  if (process.platform !== 'darwin') app.quit();
});
