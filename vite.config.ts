import { createReadStream } from 'node:fs';
import { copyFile, mkdir, readdir, readFile, rm, stat, writeFile } from 'node:fs/promises';
import { dirname, extname, isAbsolute, join, relative, resolve, sep } from 'node:path';
import type { IncomingMessage, ServerResponse } from 'node:http';
import { defineConfig, type Plugin } from 'vite';

const EDITOR_ASSET_ROOT = 'editor/assets';
const EDITOR_ASSET_URL_PREFIX = '/editor/assets/';

interface AssetMount {
  urlPrefix: string;
  sourceRoot: string;
  outputRoot: string;
}

interface ResolvedAsset {
  sourcePath: string;
  outputPath: string;
  sourceRoot: string;
  outputRoot: string;
}

interface GltfManifest {
  buffers?: { uri?: unknown }[];
  images?: { uri?: unknown }[];
}

const BUILD_ASSET_MOUNTS: AssetMount[] = [
  {
    urlPrefix: EDITOR_ASSET_URL_PREFIX,
    sourceRoot: EDITOR_ASSET_ROOT,
    outputRoot: EDITOR_ASSET_ROOT,
  },
  {
    urlPrefix: '/assets/',
    sourceRoot: 'public/assets',
    outputRoot: 'assets',
  },
  {
    urlPrefix: '/src/assets/',
    sourceRoot: 'src/assets',
    outputRoot: 'src/assets',
  },
];

function isInsidePath(child: string, parent: string): boolean {
  const path = relative(parent, child);
  return path === '' || (!path.startsWith(`..${sep}`) && path !== '..' && !isAbsolute(path));
}

function decodePathComponent(path: string): string | null {
  try {
    return decodeURIComponent(path);
  } catch {
    return null;
  }
}

function resolveAssetUrl(projectRoot: string, outDir: string, rawUrl: string): ResolvedAsset | null {
  let pathname: string | null = null;
  try {
    const parsed = new URL(rawUrl, 'http://claudecitizen.local');
    if (parsed.origin !== 'http://claudecitizen.local') return null;
    pathname = decodePathComponent(parsed.pathname);
  } catch {
    return null;
  }
  if (!pathname) return null;

  for (const mount of BUILD_ASSET_MOUNTS) {
    if (!pathname.startsWith(mount.urlPrefix)) continue;
    const relativeUrlPath = pathname.slice(mount.urlPrefix.length);
    if (!relativeUrlPath || relativeUrlPath.includes('\0')) return null;

    const sourceRoot = resolve(projectRoot, mount.sourceRoot);
    const outputRoot = resolve(projectRoot, outDir, mount.outputRoot);
    const sourcePath = resolve(sourceRoot, relativeUrlPath);
    const outputPath = resolve(outputRoot, relativeUrlPath);
    if (!isInsidePath(sourcePath, sourceRoot) || !isInsidePath(outputPath, outputRoot)) {
      return null;
    }
    return { sourcePath, outputPath, sourceRoot, outputRoot };
  }
  return null;
}

function collectPrefabAssetUrls(value: unknown, urls: Set<string>): void {
  if (!value || typeof value !== 'object') return;
  if (Array.isArray(value)) {
    for (const item of value) collectPrefabAssetUrls(item, urls);
    return;
  }

  const record = value as Record<string, unknown>;
  const asset = record.asset;
  if (asset && typeof asset === 'object') {
    const url = (asset as Record<string, unknown>).url;
    if (typeof url === 'string') urls.add(url);
  }
  for (const child of Object.values(record)) collectPrefabAssetUrls(child, urls);
}

async function listPrefabAssetUrls(projectRoot: string): Promise<string[]> {
  const urls = new Set<string>();
  const prefabDir = resolve(projectRoot, 'src/world/prefabs/data');
  let names: string[] = [];
  try {
    names = await readdir(prefabDir);
  } catch {
    return [];
  }

  for (const name of names) {
    if (!name.endsWith('.prefab.json')) continue;
    const filePath = join(prefabDir, name);
    try {
      collectPrefabAssetUrls(JSON.parse(await readFile(filePath, 'utf8')), urls);
    } catch (error) {
      console.warn(`[claudecitizen-assets] Could not scan ${relative(projectRoot, filePath)}:`, error);
    }
  }
  return [...urls].sort();
}

function isRelativeGltfUri(uri: string): boolean {
  return (
    uri.length > 0 &&
    !uri.startsWith('/') &&
    !uri.startsWith('//') &&
    !uri.startsWith('data:') &&
    !/^[a-z][a-z0-9+.-]*:/i.test(uri)
  );
}

function cleanRelativeUri(uri: string): string | null {
  const cleaned = uri.split(/[?#]/, 1)[0];
  return decodePathComponent(cleaned);
}

async function enqueueGltfDependencies(
  asset: ResolvedAsset,
  queue: ResolvedAsset[],
  missing: string[],
): Promise<void> {
  if (extname(asset.sourcePath).toLowerCase() !== '.gltf') return;

  let parsed: GltfManifest;
  try {
    parsed = JSON.parse(await readFile(asset.sourcePath, 'utf8')) as GltfManifest;
  } catch {
    return;
  }

  const uris = [
    ...(parsed.buffers ?? []).map((buffer) => buffer.uri),
    ...(parsed.images ?? []).map((image) => image.uri),
  ];

  for (const uri of uris) {
    if (typeof uri !== 'string' || !isRelativeGltfUri(uri)) continue;
    const relativeUri = cleanRelativeUri(uri);
    if (!relativeUri || relativeUri.includes('\0')) continue;

    const sourcePath = resolve(dirname(asset.sourcePath), relativeUri);
    const outputPath = resolve(dirname(asset.outputPath), relativeUri);
    if (!isInsidePath(sourcePath, asset.sourceRoot) || !isInsidePath(outputPath, asset.outputRoot)) {
      missing.push(`${sourcePath} (escaped asset root)`);
      continue;
    }
    queue.push({
      sourcePath,
      outputPath,
      sourceRoot: asset.sourceRoot,
      outputRoot: asset.outputRoot,
    });
  }
}

function copyReferencedGameAssets(): Plugin {
  let root = process.cwd();
  let outDir = 'dist';

  return {
    name: 'claudecitizen-copy-referenced-game-assets',
    apply: 'build',
    configResolved(config) {
      root = config.root;
      outDir = config.build.outDir;
    },
    async closeBundle() {
      // Vite copies public/ wholesale; protected public assets are local library
      // material and should be re-added only when a prefab actually references one.
      await rm(resolve(root, outDir, 'assets/protected'), { recursive: true, force: true });
      await rm(resolve(root, outDir, EDITOR_ASSET_ROOT), { recursive: true, force: true });

      const queue = (await listPrefabAssetUrls(root))
        .map((url) => resolveAssetUrl(root, outDir, url))
        .filter((asset): asset is ResolvedAsset => asset !== null);
      const seen = new Set<string>();
      const copied = new Set<string>();
      const missing: string[] = [];

      while (queue.length > 0) {
        const asset = queue.shift()!;
        if (seen.has(asset.sourcePath)) continue;
        seen.add(asset.sourcePath);

        let fileStat;
        try {
          fileStat = await stat(asset.sourcePath);
        } catch {
          missing.push(relative(root, asset.sourcePath));
          continue;
        }
        if (!fileStat.isFile()) continue;

        await mkdir(dirname(asset.outputPath), { recursive: true });
        await copyFile(asset.sourcePath, asset.outputPath);
        copied.add(asset.sourcePath);
        await enqueueGltfDependencies(asset, queue, missing);
      }

      if (copied.size > 0) {
        console.log(`[claudecitizen-assets] copied ${copied.size} referenced asset file(s).`);
      }
      if (missing.length > 0) {
        const shown = missing.slice(0, 8).join(', ');
        const remaining = missing.length > 8 ? `, +${missing.length - 8} more` : '';
        console.warn(`[claudecitizen-assets] missing local asset(s): ${shown}${remaining}`);
      }
    },
  };
}

/**
 * Dev-only editor backend served by the Vite dev server (never part of a
 * production build):
 *
 *   GET  /__editor/assets?root=editor/assets             — recursive file listing
 *   GET  /__editor/prefabs                               — saved prefab ids
 *   GET  /__editor/prefab?id=<id>                        — prefab JSON
 *   POST /__editor/prefab                                — save prefab JSON
 *
 * Prefabs are written to src/world/prefabs/data/<id>.prefab.json so the game
 * bundles them via import.meta.glob.
 */
function editorDevApi(): Plugin {
  const ASSET_ROOTS = [EDITOR_ASSET_ROOT];
  const LISTED_EXTENSIONS = new Set([
    '.glb',
    '.gltf',
    '.png',
    '.jpg',
    '.jpeg',
    '.webp',
    '.bmp',
  ]);
  const MIME_TYPES = new Map<string, string>([
    ['.bin', 'application/octet-stream'],
    ['.bmp', 'image/bmp'],
    ['.glb', 'model/gltf-binary'],
    ['.gltf', 'model/gltf+json'],
    ['.jpeg', 'image/jpeg'],
    ['.jpg', 'image/jpeg'],
    ['.png', 'image/png'],
    ['.webp', 'image/webp'],
  ]);
  const PREFAB_ID_PATTERN = /^[a-z0-9][a-z0-9-]{0,63}$/;
  const MAX_LISTING_ENTRIES = 20_000;
  const MAX_BODY_BYTES = 8 * 1024 * 1024;

  let projectRoot = process.cwd();

  function prefabDataDir(): string {
    return resolve(projectRoot, 'src/world/prefabs/data');
  }

  function editorAssetDir(): string {
    return resolve(projectRoot, EDITOR_ASSET_ROOT);
  }

  function sendJson(res: ServerResponse, status: number, payload: unknown): void {
    res.statusCode = status;
    res.setHeader('Content-Type', 'application/json; charset=utf-8');
    res.setHeader('Cache-Control', 'no-store');
    res.end(JSON.stringify(payload));
  }

  /** Resolves an allowed asset root; rejects anything outside the project. */
  function resolveAssetRoot(rootParam: string | null): string | null {
    if (!rootParam || !ASSET_ROOTS.includes(rootParam)) return null;
    const absolute = resolve(projectRoot, rootParam);
    if (!isInsidePath(absolute, projectRoot)) return null;
    return absolute;
  }

  function contentTypeFor(path: string): string {
    return MIME_TYPES.get(extname(path).toLowerCase()) ?? 'application/octet-stream';
  }

  async function serveEditorAsset(
    req: IncomingMessage,
    res: ServerResponse,
    next: () => void,
  ): Promise<void> {
    const requestUrl = new URL(req.url ?? '/', 'http://localhost');
    const decodedPath = decodePathComponent(requestUrl.pathname.slice(1));
    if (decodedPath === null) {
      res.statusCode = 400;
      res.end('bad asset path');
      return;
    }
    const filePath = resolve(editorAssetDir(), decodedPath);
    if (!isInsidePath(filePath, editorAssetDir())) {
      res.statusCode = 403;
      res.end('forbidden');
      return;
    }
    try {
      const fileStat = await stat(filePath);
      if (!fileStat.isFile()) {
        next();
        return;
      }
      res.statusCode = 200;
      res.setHeader('Content-Type', contentTypeFor(filePath));
      res.setHeader('Content-Length', String(fileStat.size));
      res.setHeader('Cache-Control', 'no-store');
      createReadStream(filePath).pipe(res);
    } catch {
      next();
    }
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
      server.middlewares.use('/editor/assets', (req, res, next) => {
        void serveEditorAsset(req, res, next).catch((error) => {
          console.error('[editor-assets]', error);
          if (!res.headersSent) {
            res.statusCode = 500;
            res.end('internal error');
          }
        });
      });
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
  plugins: [copyReferencedGameAssets(), editorDevApi()],
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
