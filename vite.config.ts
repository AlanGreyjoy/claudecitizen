import { copyFile, mkdir, readdir, readFile, rm, stat } from 'node:fs/promises';
import { existsSync } from 'node:fs';
import { dirname, extname, isAbsolute, join, relative, resolve, sep } from 'node:path';
import react from '@vitejs/plugin-react';
import { defineConfig, type Plugin } from 'vite';

const PROJECT_ASSET_ROOT = 'assets';
const PROJECT_ASSET_URL_PREFIX = '/assets/';
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
    urlPrefix: PROJECT_ASSET_URL_PREFIX,
    sourceRoot: PROJECT_ASSET_ROOT,
    outputRoot: PROJECT_ASSET_ROOT,
  },
  {
    // Legacy checkout layout: protected packs under public/ before projects owned assets/.
    urlPrefix: PROJECT_ASSET_URL_PREFIX,
    sourceRoot: 'public/assets',
    outputRoot: PROJECT_ASSET_ROOT,
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
    if (!relativeUrlPath || relativeUrlPath.includes('\0')) continue;

    const sourceRoot = resolve(projectRoot, mount.sourceRoot);
    const outputRoot = resolve(projectRoot, outDir, mount.outputRoot);
    const sourcePath = resolve(sourceRoot, relativeUrlPath);
    const outputPath = resolve(outputRoot, relativeUrlPath);
    if (!isInsidePath(sourcePath, sourceRoot) || !isInsidePath(outputPath, outputRoot)) {
      continue;
    }
    // Prefer project `assets/` over legacy `public/assets/` when both claim `/assets/`.
    if (!existsSync(sourcePath)) continue;
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
      // Vite copies public/ wholesale; protected packs are project-local and
      // should be re-added only when a prefab actually references one.
      await rm(resolve(root, outDir, 'assets/protected'), { recursive: true, force: true });

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

const editorBridgePort = process.env.CLAUDECITIZEN_EDITOR_BRIDGE_PORT?.trim();
const editorBridgeTarget = editorBridgePort
  ? `http://127.0.0.1:${editorBridgePort}`
  : null;

export default defineConfig({
  plugins: [react(), copyReferencedGameAssets()],
  build: {
    rollupOptions: {
      // `index.html` is the shipped game; `editor.html` is the AsteronEngine
      // renderer that Electron loads. Both ship in the editor bundle so
      // in-editor Play can open the game entry from the same origin.
      input: {
        index: resolve(process.cwd(), 'index.html'),
        editor: resolve(process.cwd(), 'editor.html'),
      },
    },
  },
  // Electron `--dev` starts Vite and proxies editor APIs + project asset mounts
  // through a main-process HTTP bridge. Do not proxy `/src/assets`: Vite must
  // own those for `?import` transforms (e.g. the brand logo PNG). Runtime GLB
  // URLs under `/src/assets` are served from the engine checkout by Vite.
  // Project library files live under the open project's `assets/` and are
  // served via the bridge at `/assets/...`.
  server: editorBridgeTarget
    ? {
        host: '127.0.0.1',
        proxy: {
          '/__editor': editorBridgeTarget,
          '/assets': editorBridgeTarget,
        },
      }
    : undefined,
  // Keep a single React copy (docs/takram also pull react) so Vite's
  // rolldown prebundle of react-dom/client doesn't import a mismatched chunk.
  resolve: {
    dedupe: ['react', 'react-dom'],
  },
  optimizeDeps: {
    include: ['react', 'react-dom', 'react-dom/client', 'react/jsx-runtime', 'react/jsx-dev-runtime'],
  },
});
