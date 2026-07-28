import { copyFile, mkdir, readdir, readFile, rm, stat } from 'node:fs/promises';
import { existsSync, readFileSync } from 'node:fs';
import { dirname, extname, isAbsolute, join, relative, resolve, sep } from 'node:path';
import react from '@vitejs/plugin-react';
import { defineConfig, type Plugin } from 'vite';

const PROJECT_ASSET_ROOT = 'assets';
const PROJECT_ASSET_URL_PREFIX = '/assets/';
/** Asset root searched for `*.prefab.json`. Mirrors PROJECT_ASSET_ROOTS in editor-desktop/repository.mjs. */
const PREFAB_SEARCH_ROOTS = ['assets'];
/**
 * Document trees under the Vite root that can name a runtime asset. Scenes were
 * the gap: an entity can carry a mesh/collider `asset.url` with no prefab in
 * between, so a prefab-only scan shipped a scene whose colliders 404 and whose
 * player falls through the floor. `src/world/prefabs/data` is here too — a
 * project may author prefabs there rather than under `assets/`.
 */
const DOCUMENT_SEARCH_ROOTS = [
  'src/world/scenes/data',
  'src/world/prefabs/data',
  'src/world/planets/data',
  'src/world/systems/data',
];
const DOCUMENT_SUFFIXES = ['.scene.json', '.prefab.json', '.planet.json', '.system.json'];
/** Stable runtime URL for the configured Sidekick pack. */
const SIDEKICK_VIRTUAL_URL_PREFIX = '/asteron/content/synty-sidekick/';
/**
 * Referenced by the engine's character catalog rather than by any prefab, so
 * the prefab scan cannot discover them. Absent in projects that do not license
 * the pack, hence "optional".
 */
const OPTIONAL_RUNTIME_ASSET_URLS = [
  `${SIDEKICK_VIRTUAL_URL_PREFIX}manifest.json`,
  // Both layouts the engine tries at runtime (UNIVERSAL_ANIMATION_LIBRARY_URLS).
  '/assets/protected/animations/universal-animation-library/UAL1_Standard.glb',
  '/assets/animations/universal-animation-library-1/UAL1_Standard.glb',
  '/assets/protected/characters/SM_Chr_ScifiWorlds_AlienArmor_01.glb',
  '/assets/protected/characters/SM_Chr_ScifiWorlds_AlienChef_01.gltf',
  '/assets/protected/characters/SM_Chr_ScifiWorlds_AlienCombat_01.gltf',
  '/assets/protected/characters/SM_Chr_ScifiWorlds_AlienRock_01.gltf',
  '/assets/protected/characters/SM_Chr_ScifiWorlds_Soldier_Male_01.glb',
  '/assets/protected/characters/SM_Chr_ScifiWorlds_SpaceSuit_Male_01.glb',
  '/assets/protected/characters/SM_Chr_ScifiWorlds_Strider_Male_01.glb',
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
];

function isInsidePath(child: string, parent: string): boolean {
  const path = relative(parent, child);
  return path === '' || (!path.startsWith(`..${sep}`) && path !== '..' && !isAbsolute(path));
}

function normalizeContentPackRelativePath(value: unknown): string {
  if (typeof value !== 'string') return '';
  const trimmed = value.trim().replace(/\\/g, '/').replace(/^\/+|\/+$/g, '');
  if (!trimmed || trimmed.includes('\0')) return '';
  if (/^[a-zA-Z]:/.test(trimmed) || trimmed.startsWith('/')) return '';
  const segments = trimmed.split('/');
  if (segments.some((segment) => !segment || segment === '.' || segment === '..')) return '';
  return segments.join('/');
}

function readConfiguredSidekickPackRelative(projectRoot: string): string {
  try {
    const raw = JSON.parse(readFileSync(resolve(projectRoot, 'asteron.project.json'), 'utf8')) as {
      contentPacks?: { syntySidekick?: unknown };
    };
    return normalizeContentPackRelativePath(raw.contentPacks?.syntySidekick);
  } catch {
    return '';
  }
}

function resolveSidekickVirtualAsset(
  projectRoot: string,
  outDir: string,
  pathname: string,
): ResolvedAsset | null {
  if (!pathname.startsWith(SIDEKICK_VIRTUAL_URL_PREFIX)) return null;
  const packRelative = readConfiguredSidekickPackRelative(projectRoot);
  if (!packRelative) return null;

  const packSourceRoot = resolve(projectRoot, packRelative);
  const packOutputRoot = resolve(projectRoot, outDir, SIDEKICK_VIRTUAL_URL_PREFIX.slice(1, -1));
  if (!isInsidePath(packSourceRoot, projectRoot)) return null;

  const suffix = pathname.slice(SIDEKICK_VIRTUAL_URL_PREFIX.length);
  if (!suffix || suffix.includes('\0') || suffix.split('/').includes('..')) return null;

  const sourcePath = resolve(packSourceRoot, suffix);
  const outputPath = resolve(packOutputRoot, suffix);
  if (!isInsidePath(sourcePath, packSourceRoot) || !isInsidePath(outputPath, packOutputRoot)) {
    return null;
  }
  return {
    sourcePath,
    outputPath,
    sourceRoot: packSourceRoot,
    outputRoot: packOutputRoot,
  };
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

  const sidekick = resolveSidekickVirtualAsset(projectRoot, outDir, pathname);
  if (sidekick) return sidekick;

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

/**
 * Walks `searchRoots` under the Vite root and collects every asset URL named by
 * a JSON document whose filename ends in one of `suffixes`. Prefabs live in any
 * folder under the project asset roots and scenes live under `src/world`, so
 * the release build has to read both to learn which GLBs/textures/audio to copy.
 */
async function listDocumentAssetUrls(
  projectRoot: string,
  searchRoots: readonly string[],
  suffixes: readonly string[],
): Promise<string[]> {
  const urls = new Set<string>();
  for (const root of searchRoots) {
    const queue = [resolve(projectRoot, root)];
    while (queue.length > 0) {
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
        if (dirent.isDirectory()) {
          queue.push(absolute);
          continue;
        }
        if (!dirent.isFile() || !suffixes.some((suffix) => dirent.name.endsWith(suffix))) continue;
        try {
          collectPrefabAssetUrls(JSON.parse(await readFile(absolute, 'utf8')), urls);
        } catch (error) {
          console.warn(
            `[claudecitizen-assets] Could not scan ${relative(projectRoot, absolute)}:`,
            error,
          );
        }
      }
    }
  }
  return [...urls].sort();
}

/**
 * Animation clip GLBs are referenced by animation-controller documents, never by
 * a prefab, so the prefab scan cannot see them. Without this the release ships
 * an avatar with zero clips and every character stands in T-pose.
 *
 * Read from the Vite root, which is the staged engine+project overlay during a
 * project build — so a project-authored controller wins over the bundled one,
 * exactly as it does at runtime.
 */
const ANIMATION_CONTROLLER_DIRECTORY = 'src/player/animation/data';

async function listAnimationControllerAssetUrls(root: string): Promise<string[]> {
  const directory = resolve(root, ANIMATION_CONTROLLER_DIRECTORY);
  let dirents;
  try {
    dirents = await readdir(directory, { withFileTypes: true });
  } catch {
    return [];
  }

  const urls = new Set<string>();
  for (const dirent of dirents) {
    if (!dirent.isFile() || !dirent.name.endsWith('.controller.json')) continue;
    const absolute = join(directory, dirent.name);
    let parsed: { sources?: { url?: unknown }[] };
    try {
      parsed = JSON.parse(await readFile(absolute, 'utf8')) as typeof parsed;
    } catch (error) {
      console.warn(`[claudecitizen-assets] Could not scan ${relative(root, absolute)}:`, error);
      continue;
    }
    for (const source of parsed.sources ?? []) {
      if (typeof source?.url === 'string' && source.url.startsWith('/')) urls.add(source.url);
    }
  }
  return [...urls].sort();
}

async function listExistingOptionalAssets(
  projectRoot: string,
  outDir: string,
): Promise<ResolvedAsset[]> {
  const assets: ResolvedAsset[] = [];
  const configuredSidekick = readConfiguredSidekickPackRelative(projectRoot);
  for (const url of OPTIONAL_RUNTIME_ASSET_URLS) {
    const isSidekick = url.startsWith(SIDEKICK_VIRTUAL_URL_PREFIX);
    if (isSidekick && !configuredSidekick) continue;
    const asset = resolveAssetUrl(projectRoot, outDir, url);
    if (!asset) {
      if (isSidekick && configuredSidekick) {
        throw new Error(
          `Configured Sidekick pack "${configuredSidekick}" could not resolve ${url}.`,
        );
      }
      continue;
    }
    try {
      const fileStat = await stat(asset.sourcePath);
      if (fileStat.isFile()) assets.push(asset);
      else if (isSidekick) {
        throw new Error(
          `Configured Sidekick pack path is not a file: ${relative(projectRoot, asset.sourcePath)}`,
        );
      }
    } catch (error) {
      if (isSidekick) {
        throw error instanceof Error
          ? error
          : new Error(`Configured Sidekick pack missing: ${relative(projectRoot, asset.sourcePath)}`);
      }
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
  const isSidekickManifest = asset.outputPath.replace(/\\/g, '/').endsWith(
    '/asteron/content/synty-sidekick/manifest.json',
  );
  const isSidekickMaterialConfig = asset.outputPath.replace(/\\/g, '/').endsWith(
    '/asteron/content/synty-sidekick/materials/base-material.json',
  );
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

      const animationUrls = await listAnimationControllerAssetUrls(root);
      const unresolvedAnimationUrls = animationUrls.filter(
        (url) => resolveAssetUrl(root, outDir, url) === null,
      );
      const documentUrls = [
        ...(await listDocumentAssetUrls(root, PREFAB_SEARCH_ROOTS, ['.prefab.json'])),
        ...(await listDocumentAssetUrls(root, DOCUMENT_SEARCH_ROOTS, DOCUMENT_SUFFIXES)),
      ];
      const unresolvedDocumentUrls = [...new Set(documentUrls)].filter(
        (url) => resolveAssetUrl(root, outDir, url) === null,
      );
      const queue = [
        ...[...documentUrls, ...animationUrls]
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
      if (unresolvedDocumentUrls.length > 0) {
        // A scene/prefab names an asset the project does not have. Colliders
        // baked from it fail at runtime, so this is worth shouting about.
        console.warn(
          `[claudecitizen-assets] ${unresolvedDocumentUrls.length} document asset URL(s) do not ` +
            `resolve to a file: ${unresolvedDocumentUrls.slice(0, 8).join(', ')}`,
        );
      }
      if (unresolvedAnimationUrls.length > 0) {
        // Clips the controller points at but the project does not have. The
        // release still boots; those states just fall back to whatever loaded.
        console.warn(
          `[claudecitizen-assets] ${unresolvedAnimationUrls.length} animation clip(s) not in the ` +
            `project asset library: ${unresolvedAnimationUrls.slice(0, 8).join(', ')}`,
        );
      }
      if (missing.length > 0) {
        const shown = missing.slice(0, 8).join(', ');
        const remaining = missing.length > 8 ? `, +${missing.length - 8} more` : '';
        const configuredSidekick = readConfiguredSidekickPackRelative(root);
        const sidekickMissing = configuredSidekick
          ? missing.filter((entry) => {
              const absolute = resolve(root, entry);
              return isInsidePath(absolute, resolve(root, configuredSidekick));
            })
          : [];
        if (sidekickMissing.length > 0) {
          throw new Error(
            `Configured Sidekick pack "${configuredSidekick}" is missing files: ${sidekickMissing.slice(0, 8).join(', ')}`,
          );
        }
        console.warn(`[claudecitizen-assets] missing local asset(s): ${shown}${remaining}`);
      }
    },
  };
}

/**
 * Vendor buckets, most-specific first. Without these Rollup collapses every
 * module reachable from two entry points into one anonymous shared chunk — a
 * 1.7 MB blob that had to download whole before the first frame, and that got
 * named after an arbitrary member module (`entertainment-system-<hash>.js`),
 * which made every production stack trace point at the wrong subsystem.
 *
 * Split by package, not by feature: these change only when a dependency is
 * upgraded, so their content hashes stay put across engine edits and a returning
 * player re-downloads only the code that actually moved.
 */
const VENDOR_CHUNKS: { name: string; packages: string[] }[] = [
  // three-mesh-bvh before three: `three-mesh-bvh` contains `three` as a prefix.
  { name: 'vendor-three', packages: ['three-mesh-bvh', 'three'] },
  {
    name: 'vendor-postfx',
    packages: [
      'postprocessing',
      'n8ao',
      '@takram/three-atmosphere',
      '@takram/three-clouds',
      '@takram/three-geospatial',
    ],
  },
  { name: 'vendor-rapier', packages: ['@dimforge/rapier3d'] },
  { name: 'vendor-react', packages: ['react-dom', 'react', 'scheduler'] },
];

/** Package name a node_modules path belongs to, or '' for first-party source. */
function nodeModulesPackage(moduleId: string): string {
  const normalized = moduleId.replace(/\\/g, '/');
  const index = normalized.lastIndexOf('/node_modules/');
  if (index === -1) return '';
  const segments = normalized.slice(index + '/node_modules/'.length).split('/');
  if (!segments[0]) return '';
  return segments[0].startsWith('@') ? `${segments[0]}/${segments[1] ?? ''}` : segments[0];
}

/**
 * Only node_modules is bucketed. First-party source is left to Rollup: it
 * already splits per dynamic import, so a scene, a prefab, or the ship session
 * loads on demand. Naming a chunk for `src/**` here would undo that and pull
 * the whole engine back into one file.
 */
function manualChunks(moduleId: string): string | undefined {
  const packageName = nodeModulesPackage(moduleId);
  if (!packageName) return undefined;
  for (const bucket of VENDOR_CHUNKS) {
    if (bucket.packages.some((name) => packageName === name)) return bucket.name;
  }
  return 'vendor';
}

/**
 * Rollup names a chunk with no facade module after an arbitrary module inside
 * it. That is where `entertainment-system-<hash>.js` came from. Vendor buckets
 * carry an explicit name; anything else facadeless is genuinely shared engine
 * code, so label it as such instead of blaming one random module.
 */
function chunkFileNames(chunk: { facadeModuleId: string | null; name: string }): string {
  if (chunk.facadeModuleId || chunk.name.startsWith('vendor')) return 'assets/[name]-[hash].js';
  return 'assets/shared-[hash].js';
}

const editorBridgePort = process.env.CLAUDECITIZEN_EDITOR_BRIDGE_PORT?.trim();
const editorBridgeTarget = editorBridgePort
  ? `http://127.0.0.1:${editorBridgePort}`
  : null;

export default defineConfig(({ mode }) => ({
  plugins: [react(), copyReferencedGameAssets()],
  build: {
    // The engine is open source, so shipping maps leaks nothing, and a release
    // stack trace that reads `prefab-renderer.ts:214` instead of `RH @ index.js`
    // is worth the extra files. Netlify serves a `.map` only when DevTools asks
    // for one, so players never download them.
    sourcemap: true,
    rollupOptions: {
      output: { manualChunks, chunkFileNames },
      // `index.html` is the shipped game; `editor.html` is the AsteronEngine
      // renderer that Electron loads. The editor bundle ships both so in-editor
      // Play can open the game entry from the same origin. A public release
      // ships only the game — the editor chunk is dead weight there, and a
      // public build has no business serving an authoring surface at all.
      input:
        mode === 'editor'
          ? {
              index: resolve(process.cwd(), 'index.html'),
              editor: resolve(process.cwd(), 'editor.html'),
            }
          : { index: resolve(process.cwd(), 'index.html') },
    },
  },
  // Electron `--dev` starts Vite and proxies editor APIs + project asset mounts
  // through a main-process HTTP bridge. `/src/assets` is never proxied: it is
  // the engine checkout's own bundled assets (brand logo, atmosphere LUTs,
  // stars), reached only through ESM imports that Vite must own. All project
  // content lives under the open project's `assets/` and is served via the
  // bridge at `/assets/...`.
  //
  // `.asteron-build/` is watched out explicitly. `build:project-web` stages a
  // hardlinked copy of `src/` and `public/` there, inside this very root, then
  // deletes it — thousands of events the dev server would otherwise read as
  // source edits. Git ignores the directory; chokidar does not, and the reload
  // it triggers lands in the middle of a Build Web or a Deploy.
  server: {
    watch: { ignored: ['**/.asteron-build/**'] },
    ...(editorBridgeTarget
      ? {
          host: '127.0.0.1',
          proxy: {
            '/__editor': editorBridgeTarget,
            '/assets': editorBridgeTarget,
            '/asteron/content': editorBridgeTarget,
          },
        }
      : {}),
  },
  // Keep a single React copy (docs/takram also pull react) so Vite's
  // rolldown prebundle of react-dom/client doesn't import a mismatched chunk.
  resolve: {
    dedupe: ['react', 'react-dom'],
  },
  optimizeDeps: {
    include: ['react', 'react-dom', 'react-dom/client', 'react/jsx-runtime', 'react/jsx-dev-runtime'],
  },
}));
