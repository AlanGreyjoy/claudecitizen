import { createServer } from 'node:http';
import { spawn } from 'node:child_process';
import { net } from 'electron';

const VITE_HOST = '127.0.0.1';
const VITE_PORT = 5173;

/**
 * Dev-only renderer: Vite serves the React/TS sources with HMR, while
 * `/__editor` and project asset mounts stay on an Electron-owned HTTP bridge
 * (same handlers as the `cceditor:` protocol).
 */
export async function startDevRenderer({
  repositoryRoot,
  npmCommand,
  serveEditorRequest,
  getRepository,
  toEditorProtocolRequest,
}) {
  const bridge = createServer((req, res) => {
    void (async () => {
      try {
        const host = req.headers.host || `${VITE_HOST}:${VITE_PORT}`;
        const url = new URL(req.url || '/', `http://${host}`);
        const headers = new Headers();
        for (const [key, value] of Object.entries(req.headers)) {
          if (value === undefined) continue;
          if (Array.isArray(value)) {
            for (const entry of value) headers.append(key, entry);
          } else {
            headers.set(key, value);
          }
        }

        let body;
        if (req.method && !['GET', 'HEAD'].includes(req.method)) {
          const chunks = [];
          for await (const chunk of req) chunks.push(chunk);
          body = Buffer.concat(chunks);
        }

        const incoming = new Request(url, {
          method: req.method,
          headers,
          body,
        });
        const response = await serveEditorRequest(
          getRepository,
          toEditorProtocolRequest(incoming),
        );

        res.statusCode = response.status;
        response.headers.forEach((value, key) => {
          if (key.toLowerCase() === 'transfer-encoding') return;
          res.setHeader(key, value);
        });
        const buffer = Buffer.from(await response.arrayBuffer());
        res.end(buffer);
      } catch (error) {
        console.error('[editor-dev] bridge request failed:', error);
        if (!res.headersSent) res.statusCode = 500;
        res.end(error instanceof Error ? error.message : 'bridge error');
      }
    })();
  });

  await new Promise((resolve, reject) => {
    bridge.once('error', reject);
    bridge.listen(0, VITE_HOST, () => {
      bridge.off('error', reject);
      resolve();
    });
  });

  const bridgeAddress = bridge.address();
  if (!bridgeAddress || typeof bridgeAddress === 'string') {
    bridge.close();
    throw new Error('Editor API bridge failed to bind a TCP port.');
  }

  const viteProcess = spawn(
    npmCommand,
    [
      'exec',
      '--',
      'vite',
      '--host',
      VITE_HOST,
      '--port',
      String(VITE_PORT),
      '--strictPort',
      '--mode',
      'editor',
    ],
    {
      cwd: repositoryRoot,
      env: {
        ...process.env,
        CLAUDECITIZEN_EDITOR_BRIDGE_PORT: String(bridgeAddress.port),
      },
      stdio: 'inherit',
    },
  );

  const rendererOrigin = `http://${VITE_HOST}:${VITE_PORT}`;
  try {
    await waitForServer(`${rendererOrigin}/editor.html`, 60_000);
  } catch (error) {
    await dispose();
    throw error;
  }

  async function dispose() {
    if (!viteProcess.killed) {
      viteProcess.kill('SIGTERM');
    }
    await new Promise((resolve) => {
      bridge.close(() => resolve());
    });
  }

  viteProcess.on('exit', (code, signal) => {
    if (signal === 'SIGTERM' || code === 0 || code === null) return;
    console.error(`[editor-dev] Vite exited unexpectedly (code ${code}).`);
  });

  return { rendererOrigin, dispose };
}

async function waitForServer(url, timeoutMs) {
  const started = Date.now();
  let lastError = null;
  while (Date.now() - started < timeoutMs) {
    try {
      const response = await net.fetch(url, { method: 'GET' });
      // Any HTTP response means the listener is up.
      if (response.status > 0) return;
    } catch (error) {
      lastError = error;
    }
    await new Promise((resolve) => setTimeout(resolve, 200));
  }
  throw new Error(
    `Vite dev server did not become ready at ${url}: ${
      lastError instanceof Error ? lastError.message : 'timeout'
    }`,
  );
}
