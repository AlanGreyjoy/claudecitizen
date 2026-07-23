import { createReadStream } from 'node:fs';
import { copyFile, mkdir, readdir, readFile, rm, stat, writeFile } from 'node:fs/promises';
import { dirname, extname, isAbsolute, join, relative, resolve, sep } from 'node:path';
import type { IncomingMessage, ServerResponse } from 'node:http';
import react from '@vitejs/plugin-react';
import { defineConfig, type Plugin } from 'vite';

const EDITOR_ASSET_ROOT = 'editor/assets';
const EDITOR_ASSET_URL_PREFIX = '/editor/assets/';
const SOURCE_ASSET_ROOT = 'src/assets';
const OPTIONAL_RUNTIME_ASSET_URLS = [
  '/src/assets/protected/characters/synty_sidekick/manifest.json',
  '/src/assets/protected/characters/SM_Chr_ScifiWorlds_AlienArmor_01.glb',
  '/src/assets/protected/characters/SM_Chr_ScifiWorlds_AlienChef_01.gltf',
  '/src/assets/protected/characters/SM_Chr_ScifiWorlds_AlienCombat_01.gltf',
  '/src/assets/protected/characters/SM_Chr_ScifiWorlds_AlienRock_01.gltf',
  '/src/assets/protected/characters/SM_Chr_ScifiWorlds_Soldier_Male_01.glb',
  '/src/assets/protected/characters/SM_Chr_ScifiWorlds_SpaceSuit_Male_01.glb',
  '/src/assets/protected/characters/SM_Chr_ScifiWorlds_Strider_Male_01.glb',
];

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
  for (const [key, child] of Object.entries(record)) {
    if (
      typeof child === 'string' &&
      (key === 'soundUrl' ||
        key.endsWith('SoundUrl') ||
        key === 'textureUrl' ||
        key.endsWith('TextureUrl')) &&
      child.startsWith('/')
    ) {
      urls.add(child);
      continue;
    }
    collectPrefabAssetUrls(child, urls);
  }
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

async function listExistingOptionalAssets(
  projectRoot: string,
  outDir: string,
): Promise<ResolvedAsset[]> {
  const assets: ResolvedAsset[] = [];
  for (const url of OPTIONAL_RUNTIME_ASSET_URLS) {
    const asset = resolveAssetUrl(projectRoot, outDir, url);
    if (!asset) continue;
    try {
      const fileStat = await stat(asset.sourcePath);
      if (fileStat.isFile()) assets.push(asset);
    } catch {
      // Optional protected runtime assets are allowed to be absent in public checkouts.
    }
  }
  return assets;
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

async function enqueueSidekickJsonDependencies(
  asset: ResolvedAsset,
  queue: ResolvedAsset[],
  missing: string[],
): Promise<void> {
  const isSidekickManifest = asset.sourcePath.endsWith('/characters/synty_sidekick/manifest.json');
  const isSidekickMaterialConfig = asset.sourcePath.endsWith('/characters/synty_sidekick/materials/base-material.json');
  if (!isSidekickManifest && !isSidekickMaterialConfig)
    return;

  let parsed: Record<string, unknown>;
  try {
    parsed = JSON.parse(await readFile(asset.sourcePath, 'utf8')) as Record<string, unknown>;
  } catch {
    return;
  }

  const relativePaths: string[] = [];
  if (isSidekickManifest) {
    const assets = parsed.assets as Record<string, unknown> | undefined;
    for (const key of ['baseModelUrl', 'materialConfigUrl', 'availabilityReportUrl']) {
      if (typeof assets?.[key] === 'string')
        relativePaths.push(assets[key] as string);
    }
    if (Array.isArray(assets?.textureUrls)) {
      for (const textureUrl of assets.textureUrls) {
        if (typeof textureUrl === 'string')
          relativePaths.push(textureUrl);
      }
    }
    if (Array.isArray(parsed.parts)) {
      for (const part of parsed.parts) {
        if (!part || typeof part !== 'object') continue;
        const entry = part as Record<string, unknown>;
        for (const key of ['meshUrl', 'thumbnailUrl']) {
          if (typeof entry[key] === 'string')
            relativePaths.push(entry[key] as string);
        }
      }
    }
    if (Array.isArray(parsed.partImages)) {
      for (const partImage of parsed.partImages) {
        if (!partImage || typeof partImage !== 'object') continue;
        const thumbnailUrl = (partImage as Record<string, unknown>).thumbnailUrl;
        if (typeof thumbnailUrl === 'string')
          relativePaths.push(thumbnailUrl);
      }
    }
  } else if (parsed.maps && typeof parsed.maps === 'object') {
    for (const textureUrl of Object.values(parsed.maps as Record<string, unknown>)) {
      if (typeof textureUrl === 'string')
        relativePaths.push(textureUrl);
    }
  }

  const assetBaseDirectory = isSidekickMaterialConfig
    ? resolve(dirname(asset.sourcePath), '..')
    : dirname(asset.sourcePath);
  const outputBaseDirectory = isSidekickMaterialConfig
    ? resolve(dirname(asset.outputPath), '..')
    : dirname(asset.outputPath);
  for (const relativePath of relativePaths) {
    const sourcePath = resolve(assetBaseDirectory, relativePath);
    const outputPath = resolve(outputBaseDirectory, relativePath);
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

      const queue = [
        ...(await listPrefabAssetUrls(root))
          .map((url) => resolveAssetUrl(root, outDir, url))
          .filter((asset): asset is ResolvedAsset => asset !== null),
        ...(await listExistingOptionalAssets(root, outDir)),
      ];
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
        await enqueueSidekickJsonDependencies(asset, queue, missing);
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
 *   GET  /__editor/assets?root=src/assets                — recursive source asset listing
 *   GET  /__editor/prefabs                               — saved prefab metadata (id, kind, name)
 *   GET  /__editor/prefab?id=<id>                        — prefab JSON
 *   POST /__editor/prefab                                — save prefab JSON
 *   GET  /__editor/base-characters                       — base character equipment JSON
 *   POST /__editor/base-characters                       — save base character equipment JSON
 *   GET  /__editor/character-settings                    — character locomotion settings JSON
 *   POST /__editor/character-settings                    — save character locomotion settings JSON
 *   GET  /__editor/animation-controllers                 — list animation controllers
 *   GET  /__editor/animation-controllers?id=<id>         — animation controller JSON
 *   POST /__editor/animation-controllers                 — save animation controller JSON
 *   GET  /__editor/planets                               — saved planet metadata (id, name)
 *   GET  /__editor/planet?id=<id>                        — planet JSON
 *   POST /__editor/planet                                — save planet JSON
 *   GET  /__editor/systems                               — saved system metadata (id, name)
 *   GET  /__editor/system?id=<id>                        — system JSON
 *   POST /__editor/system                                — save system JSON
 *
 * Prefabs are written to src/world/prefabs/data/<id>.prefab.json so the game
 * bundles them via import.meta.glob. Planets write to
 * src/world/planets/data/<id>.planet.json. Systems write to
 * src/world/systems/data/<id>.system.json.
 */
function editorDevApi(): Plugin {
  const ASSET_ROOTS = [EDITOR_ASSET_ROOT, SOURCE_ASSET_ROOT];
  const LISTED_EXTENSIONS = new Set([
    '.glb',
    '.gltf',
    '.png',
    '.jpg',
    '.jpeg',
    '.webp',
    '.bmp',
    '.ogg',
    '.mp3',
    '.wav',
    '.m4a',
  ]);
  const MIME_TYPES = new Map<string, string>([
    ['.bin', 'application/octet-stream'],
    ['.bmp', 'image/bmp'],
    ['.glb', 'model/gltf-binary'],
    ['.gltf', 'model/gltf+json'],
    ['.jpeg', 'image/jpeg'],
    ['.jpg', 'image/jpeg'],
    ['.m4a', 'audio/mp4'],
    ['.mp3', 'audio/mpeg'],
    ['.ogg', 'audio/ogg'],
    ['.png', 'image/png'],
    ['.wav', 'audio/wav'],
    ['.webp', 'image/webp'],
  ]);
  const PREFAB_ID_PATTERN = /^[a-z0-9][a-z0-9-]{0,63}$/;
  const PREFAB_KINDS = new Set(['station', 'ship', 'site', 'prop', 'item']);
  const MAX_LISTING_ENTRIES = 20_000;
  const MAX_BODY_BYTES = 8 * 1024 * 1024;

  let projectRoot = process.cwd();

  function prefabDataDir(): string {
    return resolve(projectRoot, 'src/world/prefabs/data');
  }

  function planetDataDir(): string {
    return resolve(projectRoot, 'src/world/planets/data');
  }

  function systemDataDir(): string {
    return resolve(projectRoot, 'src/world/systems/data');
  }

  function baseCharacterEquipmentPath(): string {
    return resolve(projectRoot, 'src/player/equipment/data/base-characters.json');
  }

  function characterSettingsPath(): string {
    return resolve(projectRoot, 'src/player/data/character-settings.json');
  }

  function animationControllerDataDir(): string {
    return resolve(projectRoot, 'src/player/animation/data');
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
      const modifiedAtMs = Math.trunc(fileStat.mtimeMs);
      const etag = `W/"${fileStat.size.toString(16)}-${modifiedAtMs.toString(16)}"`;
      const ifNoneMatch = req.headers['if-none-match'];
      const hasIfNoneMatch = typeof ifNoneMatch === 'string';
      const hasMatchingEtag =
        hasIfNoneMatch
        && ifNoneMatch
          .split(',')
          .some((candidate) => candidate.trim() === '*' || candidate.trim() === etag);
      const ifModifiedSince = req.headers['if-modified-since'];
      const modifiedSinceMs =
        typeof ifModifiedSince === 'string' ? Date.parse(ifModifiedSince) : Number.NaN;
      const hasMatchingModifiedDate =
        !hasIfNoneMatch
        && Number.isFinite(modifiedSinceMs)
        && Math.trunc(fileStat.mtimeMs / 1000) <= Math.trunc(modifiedSinceMs / 1000);
      res.setHeader('Content-Type', contentTypeFor(filePath));
      res.setHeader('Cache-Control', 'private, max-age=0, must-revalidate');
      res.setHeader('ETag', etag);
      res.setHeader('Last-Modified', fileStat.mtime.toUTCString());
      if (hasMatchingEtag || hasMatchingModifiedDate) {
        res.statusCode = 304;
        res.end();
        return;
      }
      res.statusCode = 200;
      res.setHeader('Content-Length', String(fileStat.size));
      if (req.method === 'HEAD') {
        res.end();
        return;
      }
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
    modifiedAtMs?: number;
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
        let modifiedAtMs = 0;
        try {
          const fileStat = await stat(absolute);
          size = fileStat.size;
          modifiedAtMs = Math.trunc(fileStat.mtimeMs);
        } catch {
          // Metadata stays 0 when stat races a deletion.
        }
        entries.push({ path: relativePath, kind: 'file', size, modifiedAtMs });
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
    const prefabs: { id: string; kind: string; name: string }[] = [];
    try {
      const filenames = (await readdir(prefabDataDir())).filter((name) => name.endsWith('.prefab.json'));
      for (const filename of filenames) {
        const id = filename.replace('.prefab.json', '');
        try {
          const contents = await readFile(join(prefabDataDir(), filename), 'utf8');
          const doc = JSON.parse(contents) as { kind?: unknown; name?: unknown };
          const kind =
            typeof doc.kind === 'string' && PREFAB_KINDS.has(doc.kind) ? doc.kind : 'station';
          const name = typeof doc.name === 'string' && doc.name.trim() ? doc.name.trim() : id;
          prefabs.push({ id, kind, name });
        } catch {
          prefabs.push({ id, kind: 'station', name: id });
        }
      }
    } catch {
      // Missing data dir means no prefabs yet.
    }
    prefabs.sort((left, right) => left.name.localeCompare(right.name) || left.id.localeCompare(right.id));
    sendJson(res, 200, { prefabs });
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

  async function handleGetBaseCharacters(res: ServerResponse): Promise<void> {
    try {
      const contents = await readFile(baseCharacterEquipmentPath(), 'utf8');
      sendJson(res, 200, { document: JSON.parse(contents) });
    } catch {
      sendJson(res, 404, { error: 'base character equipment document not found' });
    }
  }

  async function handleSaveBaseCharacters(
    req: IncomingMessage,
    res: ServerResponse,
  ): Promise<void> {
    let document: Record<string, unknown>;
    try {
      const parsed = JSON.parse(await readBody(req)) as { document?: unknown };
      if (typeof parsed.document !== 'object' || parsed.document === null) {
        throw new Error('missing document');
      }
      document = parsed.document as Record<string, unknown>;
      if (document.schemaVersion !== 1 || !Array.isArray(document.slots)) {
        throw new Error('invalid base character equipment document');
      }
    } catch (error) {
      sendJson(res, 400, { error: `invalid request body: ${(error as Error).message}` });
      return;
    }
    const filePath = baseCharacterEquipmentPath();
    await mkdir(dirname(filePath), { recursive: true });
    await writeFile(filePath, `${JSON.stringify(document, null, 2)}\n`, 'utf8');
    sendJson(res, 200, { saved: true, path: relative(projectRoot, filePath) });
  }

  async function handleGetCharacterSettings(res: ServerResponse): Promise<void> {
    try {
      const contents = await readFile(characterSettingsPath(), 'utf8');
      sendJson(res, 200, { document: JSON.parse(contents) });
    } catch {
      sendJson(res, 404, { error: 'character settings document not found' });
    }
  }

  async function handleSaveCharacterSettings(
    req: IncomingMessage,
    res: ServerResponse,
  ): Promise<void> {
    let document: Record<string, unknown>;
    try {
      const parsed = JSON.parse(await readBody(req)) as { document?: unknown };
      if (typeof parsed.document !== 'object' || parsed.document === null) {
        throw new Error('missing document');
      }
      document = parsed.document as Record<string, unknown>;
      const speeds = [
        document.walkSpeedMetersPerSecond,
        document.sprintSpeedMetersPerSecond,
        document.jumpSpeedMetersPerSecond,
      ];
      if (
        document.schemaVersion !== 1
        || speeds.some((value) => typeof value !== 'number' || !Number.isFinite(value))
      ) {
        throw new Error('invalid character settings document');
      }
    } catch (error) {
      sendJson(res, 400, { error: `invalid request body: ${(error as Error).message}` });
      return;
    }
    const filePath = characterSettingsPath();
    await mkdir(dirname(filePath), { recursive: true });
    await writeFile(filePath, `${JSON.stringify(document, null, 2)}\n`, 'utf8');
    sendJson(res, 200, { saved: true, path: relative(projectRoot, filePath) });
  }

  async function handleListAnimationControllers(res: ServerResponse): Promise<void> {
    const controllers: { id: string; label: string }[] = [];
    try {
      const filenames = (await readdir(animationControllerDataDir())).filter((name) =>
        name.endsWith('.controller.json'),
      );
      for (const filename of filenames) {
        const id = filename.replace(/\.controller\.json$/, '');
        try {
          const contents = await readFile(join(animationControllerDataDir(), filename), 'utf8');
          const doc = JSON.parse(contents) as { label?: unknown };
          const label = typeof doc.label === 'string' && doc.label.trim() ? doc.label.trim() : id;
          controllers.push({ id, label });
        } catch {
          controllers.push({ id, label: id });
        }
      }
    } catch {
      // Directory may not exist yet.
    }
    controllers.sort((a, b) => a.id.localeCompare(b.id));
    sendJson(res, 200, { controllers });
  }

  async function handleGetAnimationController(
    url: URL,
    res: ServerResponse,
  ): Promise<void> {
    const id = url.searchParams.get('id')?.trim() ?? '';
    if (!PREFAB_ID_PATTERN.test(id)) {
      sendJson(res, 400, { error: 'id must be a lowercase slug (a-z, 0-9, -)' });
      return;
    }
    try {
      const contents = await readFile(
        join(animationControllerDataDir(), `${id}.controller.json`),
        'utf8',
      );
      sendJson(res, 200, { document: JSON.parse(contents) });
    } catch {
      sendJson(res, 404, { error: `animation controller "${id}" not found` });
    }
  }

  async function handleSaveAnimationController(
    req: IncomingMessage,
    res: ServerResponse,
  ): Promise<void> {
    let document: { id?: unknown; schemaVersion?: unknown; stances?: unknown; states?: unknown };
    try {
      const parsed = JSON.parse(await readBody(req)) as { document?: unknown };
      if (typeof parsed.document !== 'object' || parsed.document === null) {
        throw new Error('missing document');
      }
      document = parsed.document as {
        id?: unknown;
        schemaVersion?: unknown;
        stances?: unknown;
        states?: unknown;
      };
      if (
        document.schemaVersion !== 1 ||
        !Array.isArray(document.stances) ||
        !Array.isArray(document.states)
      ) {
        throw new Error('invalid animation controller document');
      }
    } catch (error) {
      sendJson(res, 400, { error: `invalid request body: ${(error as Error).message}` });
      return;
    }
    const id = typeof document.id === 'string' ? document.id : '';
    if (!PREFAB_ID_PATTERN.test(id)) {
      sendJson(res, 400, { error: 'document.id must be a lowercase slug (a-z, 0-9, -)' });
      return;
    }
    await mkdir(animationControllerDataDir(), { recursive: true });
    const filePath = join(animationControllerDataDir(), `${id}.controller.json`);
    await writeFile(filePath, `${JSON.stringify(document, null, 2)}\n`, 'utf8');
    sendJson(res, 200, { saved: true, id, path: relative(projectRoot, filePath) });
  }

  async function handleListPlanets(res: ServerResponse): Promise<void> {
    const planets: { id: string; name: string }[] = [];
    try {
      const filenames = (await readdir(planetDataDir())).filter((name) =>
        name.endsWith('.planet.json'),
      );
      for (const filename of filenames) {
        const id = filename.replace('.planet.json', '');
        try {
          const contents = await readFile(join(planetDataDir(), filename), 'utf8');
          const doc = JSON.parse(contents) as { name?: unknown };
          const name = typeof doc.name === 'string' && doc.name.trim() ? doc.name.trim() : id;
          planets.push({ id, name });
        } catch {
          planets.push({ id, name: id });
        }
      }
    } catch {
      // Missing data dir means no planets yet.
    }
    planets.sort(
      (left, right) => left.name.localeCompare(right.name) || left.id.localeCompare(right.id),
    );
    sendJson(res, 200, { planets });
  }

  async function handleGetPlanet(url: URL, res: ServerResponse): Promise<void> {
    const id = url.searchParams.get('id') ?? '';
    if (!PREFAB_ID_PATTERN.test(id)) {
      sendJson(res, 400, { error: 'invalid planet id' });
      return;
    }
    try {
      const contents = await readFile(join(planetDataDir(), `${id}.planet.json`), 'utf8');
      sendJson(res, 200, { document: JSON.parse(contents) });
    } catch {
      sendJson(res, 404, { error: `planet "${id}" not found` });
    }
  }

  async function handleSavePlanet(req: IncomingMessage, res: ServerResponse): Promise<void> {
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
    await mkdir(planetDataDir(), { recursive: true });
    const filePath = join(planetDataDir(), `${id}.planet.json`);
    await writeFile(filePath, `${JSON.stringify(document, null, 2)}\n`, 'utf8');
    sendJson(res, 200, { saved: true, id, path: relative(projectRoot, filePath) });
  }

  async function handleListSystems(res: ServerResponse): Promise<void> {
    const systems: { id: string; name: string }[] = [];
    try {
      const filenames = (await readdir(systemDataDir())).filter((name) =>
        name.endsWith('.system.json'),
      );
      for (const filename of filenames) {
        const id = filename.replace('.system.json', '');
        try {
          const contents = await readFile(join(systemDataDir(), filename), 'utf8');
          const doc = JSON.parse(contents) as { name?: unknown };
          const name = typeof doc.name === 'string' && doc.name.trim() ? doc.name.trim() : id;
          systems.push({ id, name });
        } catch {
          systems.push({ id, name: id });
        }
      }
    } catch {
      // Missing data dir means no systems yet.
    }
    systems.sort(
      (left, right) => left.name.localeCompare(right.name) || left.id.localeCompare(right.id),
    );
    sendJson(res, 200, { systems });
  }

  async function handleGetSystem(url: URL, res: ServerResponse): Promise<void> {
    const id = url.searchParams.get('id') ?? '';
    if (!PREFAB_ID_PATTERN.test(id)) {
      sendJson(res, 400, { error: 'invalid system id' });
      return;
    }
    try {
      const contents = await readFile(join(systemDataDir(), `${id}.system.json`), 'utf8');
      sendJson(res, 200, { document: JSON.parse(contents) });
    } catch {
      sendJson(res, 404, { error: `system "${id}" not found` });
    }
  }

  async function handleSaveSystem(req: IncomingMessage, res: ServerResponse): Promise<void> {
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
    await mkdir(systemDataDir(), { recursive: true });
    const filePath = join(systemDataDir(), `${id}.system.json`);
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
          if (route === 'GET /base-characters') return handleGetBaseCharacters(res);
          if (route === 'POST /base-characters') return handleSaveBaseCharacters(req, res);
          if (route === 'GET /character-settings') return handleGetCharacterSettings(res);
          if (route === 'POST /character-settings') {
            return handleSaveCharacterSettings(req, res);
          }
          if (route === 'GET /animation-controllers') {
            return url.searchParams.has('id')
              ? handleGetAnimationController(url, res)
              : handleListAnimationControllers(res);
          }
          if (route === 'POST /animation-controllers') {
            return handleSaveAnimationController(req, res);
          }
          if (route === 'GET /planets') return handleListPlanets(res);
          if (route === 'GET /planet') return handleGetPlanet(url, res);
          if (route === 'POST /planet') return handleSavePlanet(req, res);
          if (route === 'GET /systems') return handleListSystems(res);
          if (route === 'GET /system') return handleGetSystem(url, res);
          if (route === 'POST /system') return handleSaveSystem(req, res);
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
  plugins: [react(), copyReferencedGameAssets(), editorDevApi()],
  // Keep a single React copy (docs/takram also pull react) so Vite's
  // rolldown prebundle of react-dom/client doesn't import a mismatched chunk.
  resolve: {
    dedupe: ['react', 'react-dom'],
  },
  optimizeDeps: {
    include: ['react', 'react-dom', 'react-dom/client', 'react/jsx-runtime', 'react/jsx-dev-runtime'],
  },
  server: {
    watch: {
      // Editor saves write prefab JSON that the game imports via
      // import.meta.glob. Without this, every save triggers a full page
      // reload that races (and cancels) the editor's jump into Play preview.
      // Dev builds read prefabs through /__editor/prefab instead, so no HMR
      // is needed for these files.
      ignored: [
        '**/src/world/prefabs/data/**',
        '**/src/world/planets/data/**',
        '**/src/world/systems/data/**',
        '**/src/player/equipment/data/base-characters.json',
        '**/src/player/animation/data/**',
        '**/src/player/data/**',
      ],
    },
  },
});
