import { mkdir, readdir, readFile, rm, stat, writeFile } from 'node:fs/promises';
import { join, relative, resolve, sep } from 'node:path';
import type { IncomingMessage, ServerResponse } from 'node:http';
import { defineConfig, type Plugin } from 'vite';

function stripProtectedAssets(): Plugin {
  let root = process.cwd();
  let outDir = 'dist';

  return {
    name: 'claudecitizen-strip-protected-assets',
    apply: 'build',
    configResolved(config) {
      root = config.root;
      outDir = config.build.outDir;
    },
    async closeBundle() {
      if (process.env.INCLUDE_PROTECTED_ASSETS === '1') return;
      await rm(resolve(root, outDir, 'assets/protected'), { recursive: true, force: true });
    },
  };
}

/**
 * Dev-only editor backend served by the Vite dev server (never part of a
 * production build):
 *
 *   GET  /__editor/assets?root=public/assets|src/assets  — recursive file listing
 *   GET  /__editor/prefabs                               — saved prefab ids
 *   GET  /__editor/prefab?id=<id>                        — prefab JSON
 *   POST /__editor/prefab                                — save prefab JSON
 *
 * Prefabs are written to src/world/prefabs/data/<id>.prefab.json so the game
 * bundles them via import.meta.glob.
 */
function editorDevApi(): Plugin {
  const ASSET_ROOTS = ['public/assets', 'src/assets'];
  const LISTED_EXTENSIONS = new Set([
    '.glb',
    '.gltf',
    '.png',
    '.jpg',
    '.jpeg',
    '.webp',
    '.bmp',
  ]);
  const PREFAB_ID_PATTERN = /^[a-z0-9][a-z0-9-]{0,63}$/;
  const MAX_LISTING_ENTRIES = 20_000;
  const MAX_BODY_BYTES = 8 * 1024 * 1024;

  let projectRoot = process.cwd();

  function prefabDataDir(): string {
    return resolve(projectRoot, 'src/world/prefabs/data');
  }

  function sendJson(res: ServerResponse, status: number, payload: unknown): void {
    res.statusCode = status;
    res.setHeader('Content-Type', 'application/json; charset=utf-8');
    res.setHeader('Cache-Control', 'no-store');
    res.end(JSON.stringify(payload));
  }

  /** Resolves an allowed asset root; rejects anything outside the two roots. */
  function resolveAssetRoot(rootParam: string | null): string | null {
    if (!rootParam || !ASSET_ROOTS.includes(rootParam)) return null;
    const absolute = resolve(projectRoot, rootParam);
    if (!absolute.startsWith(projectRoot + sep)) return null;
    return absolute;
  }

  interface AssetEntry {
    /** Path relative to the requested root, always with forward slashes. */
    path: string;
    kind: 'dir' | 'file';
    size?: number;
  }

  async function listAssetsRecursive(rootDir: string): Promise<AssetEntry[]> {
    const entries: AssetEntry[] = [];
    const queue: string[] = [rootDir];
    while (queue.length > 0 && entries.length < MAX_LISTING_ENTRIES) {
      const dir = queue.shift()!;
      let dirents;
      try {
        dirents = await readdir(dir, { withFileTypes: true });
      } catch {
        continue;
      }
      for (const dirent of dirents) {
        if (dirent.name.startsWith('.')) continue;
        const absolute = join(dir, dirent.name);
        const relativePath = relative(rootDir, absolute).split(sep).join('/');
        if (dirent.isDirectory()) {
          entries.push({ path: relativePath, kind: 'dir' });
          queue.push(absolute);
          continue;
        }
        if (!dirent.isFile()) continue;
        const extension = dirent.name.slice(dirent.name.lastIndexOf('.')).toLowerCase();
        if (!LISTED_EXTENSIONS.has(extension)) continue;
        let size = 0;
        try {
          size = (await stat(absolute)).size;
        } catch {
          // Size stays 0 when stat races a deletion.
        }
        entries.push({ path: relativePath, kind: 'file', size });
      }
    }
    entries.sort((a, b) => a.path.localeCompare(b.path));
    return entries;
  }

  async function readBody(req: IncomingMessage): Promise<string> {
    return new Promise((resolvePromise, rejectPromise) => {
      let total = 0;
      const chunks: Buffer[] = [];
      req.on('data', (chunk: Buffer) => {
        total += chunk.length;
        if (total > MAX_BODY_BYTES) {
          rejectPromise(new Error('Request body too large'));
          req.destroy();
          return;
        }
        chunks.push(chunk);
      });
      req.on('end', () => resolvePromise(Buffer.concat(chunks).toString('utf8')));
      req.on('error', rejectPromise);
    });
  }

  async function handleListAssets(url: URL, res: ServerResponse): Promise<void> {
    const rootParam = url.searchParams.get('root');
    const rootDir = resolveAssetRoot(rootParam);
    if (!rootDir) {
      sendJson(res, 400, { error: `root must be one of: ${ASSET_ROOTS.join(', ')}` });
      return;
    }
    sendJson(res, 200, { root: rootParam, entries: await listAssetsRecursive(rootDir) });
  }

  async function handleListPrefabs(res: ServerResponse): Promise<void> {
    let ids: string[] = [];
    try {
      ids = (await readdir(prefabDataDir()))
        .filter((name) => name.endsWith('.prefab.json'))
        .map((name) => name.replace('.prefab.json', ''))
        .sort();
    } catch {
      // Missing data dir means no prefabs yet.
    }
    sendJson(res, 200, { prefabs: ids });
  }

  async function handleGetPrefab(url: URL, res: ServerResponse): Promise<void> {
    const id = url.searchParams.get('id') ?? '';
    if (!PREFAB_ID_PATTERN.test(id)) {
      sendJson(res, 400, { error: 'invalid prefab id' });
      return;
    }
    try {
      const contents = await readFile(join(prefabDataDir(), `${id}.prefab.json`), 'utf8');
      sendJson(res, 200, { document: JSON.parse(contents) });
    } catch {
      sendJson(res, 404, { error: `prefab "${id}" not found` });
    }
  }

  async function handleSavePrefab(req: IncomingMessage, res: ServerResponse): Promise<void> {
    let document: { id?: unknown };
    try {
      const parsed = JSON.parse(await readBody(req)) as { document?: unknown };
      if (typeof parsed.document !== 'object' || parsed.document === null) {
        throw new Error('missing document');
      }
      document = parsed.document as { id?: unknown };
    } catch (error) {
      sendJson(res, 400, { error: `invalid request body: ${(error as Error).message}` });
      return;
    }
    const id = typeof document.id === 'string' ? document.id : '';
    if (!PREFAB_ID_PATTERN.test(id)) {
      sendJson(res, 400, { error: 'document.id must be a lowercase slug (a-z, 0-9, -)' });
      return;
    }
    await mkdir(prefabDataDir(), { recursive: true });
    const filePath = join(prefabDataDir(), `${id}.prefab.json`);
    await writeFile(filePath, `${JSON.stringify(document, null, 2)}\n`, 'utf8');
    sendJson(res, 200, { saved: true, id, path: relative(projectRoot, filePath) });
  }

  return {
    name: 'claudecitizen-editor-dev-api',
    apply: 'serve',
    configResolved(config) {
      projectRoot = config.root;
    },
    configureServer(server) {
      server.middlewares.use('/__editor', (req, res) => {
        const url = new URL(req.url ?? '/', 'http://localhost');
        const route = `${req.method ?? 'GET'} ${url.pathname}`;
        const handled = (async () => {
          if (route === 'GET /assets') return handleListAssets(url, res);
          if (route === 'GET /prefabs') return handleListPrefabs(res);
          if (route === 'GET /prefab') return handleGetPrefab(url, res);
          if (route === 'POST /prefab') return handleSavePrefab(req, res);
          sendJson(res, 404, { error: `unknown editor api route: ${route}` });
        })();
        handled.catch((error) => {
          console.error('[editor-dev-api]', error);
          if (!res.headersSent) sendJson(res, 500, { error: 'internal error' });
        });
      });
    },
  };
}

export default defineConfig({
  plugins: [stripProtectedAssets(), editorDevApi()],
  server: {
    watch: {
      // Editor saves write prefab JSON that the game imports via
      // import.meta.glob. Without this, every save triggers a full page
      // reload that races (and cancels) the editor's jump into Play preview.
      // Dev builds read prefabs through /__editor/prefab instead, so no HMR
      // is needed for these files.
      ignored: ['**/src/world/prefabs/data/**'],
    },
  },
});
