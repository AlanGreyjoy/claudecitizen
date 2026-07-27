import { mkdir, readdir, readFile, rename, rm, stat, writeFile } from 'node:fs/promises';
import { basename, dirname, extname, isAbsolute, join, relative, resolve, sep } from 'node:path';

/**
 * The single project asset library, resolved under the open project root and
 * served at `/assets/`. `src/assets/` belongs to the engine checkout and is
 * owned by Vite, so it is never a project root.
 */
export const PROJECT_ASSET_ROOTS = Object.freeze(['assets']);

/** Matches the client fallback in src/net/api.ts. */
const DEFAULT_BACKEND_URL = 'http://localhost:3000';

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
const PREFAB_ID_PATTERN = /^[a-z0-9][a-z0-9-]{0,63}$/;
const PREFAB_KINDS = new Set(['station', 'ship', 'site', 'prop', 'item']);
const MAX_LISTING_ENTRIES = 20_000;

/** Prefabs are project assets: they live anywhere under an asset root. */
export const PREFAB_FILE_SUFFIX = '.prefab.json';

/** Where a prefab lands when the author did not pick a folder. */
const DEFAULT_PREFAB_FOLDER = 'Prefabs';

export class EditorRepositoryError extends Error {
  constructor(message, status = 400) {
    super(message);
    this.name = 'EditorRepositoryError';
    this.status = status;
  }
}

export function isInsidePath(child, parent) {
  const path = relative(parent, child);
  return path === '' || (!path.startsWith(`..${sep}`) && path !== '..' && !isAbsolute(path));
}

async function readJson(path, notFoundMessage) {
  try {
    return JSON.parse(await readFile(path, 'utf8'));
  } catch {
    throw new EditorRepositoryError(notFoundMessage, 404);
  }
}

function requireDocument(value) {
  if (typeof value !== 'object' || value === null || Array.isArray(value)) {
    throw new EditorRepositoryError('missing document');
  }
  return value;
}

/** Normalizes an asset-root-relative path and rejects traversal attempts. */
function normalizeRelativePath(value, label = 'path') {
  const path =
    typeof value === 'string'
      ? value
          .trim()
          .replace(/\\/g, '/')
          .replace(/^\/+|\/+$/g, '')
      : '';
  if (path.includes('\0') || path.split('/').includes('..')) {
    throw new EditorRepositoryError(`invalid ${label}`);
  }
  return path;
}

/**
 * Project-relative content-pack folder (e.g. contentPacks.syntySidekick).
 * Empty string = unset. Absolute paths and `..` are rejected.
 */
function normalizeContentPackPath(value, label) {
  if (value == null) return '';
  if (typeof value !== 'string') {
    throw new EditorRepositoryError(`${label} must be a string`);
  }
  const trimmed = value.trim().replace(/\\/g, '/').replace(/^\/+|\/+$/g, '');
  if (!trimmed) return '';
  if (trimmed.includes('\0')) {
    throw new EditorRepositoryError(`invalid ${label}`);
  }
  if (/^[a-zA-Z]:/.test(trimmed) || trimmed.startsWith('/')) {
    throw new EditorRepositoryError(`${label} must be project-relative (not absolute)`);
  }
  const segments = trimmed.split('/');
  if (segments.some((segment) => !segment || segment === '.' || segment === '..')) {
    throw new EditorRepositoryError(`invalid ${label}`);
  }
  return segments.join('/');
}

function requireSlugId(value, label = 'document.id') {
  const id = typeof value === 'string' ? value : '';
  if (!PREFAB_ID_PATTERN.test(id)) {
    throw new EditorRepositoryError(`${label} must be a lowercase slug (a-z, 0-9, -)`);
  }
  return id;
}

async function writeJson(projectRoot, filePath, document) {
  await mkdir(dirname(filePath), { recursive: true });
  await writeFile(filePath, `${JSON.stringify(document, null, 2)}\n`, 'utf8');
  return relative(projectRoot, filePath).split(sep).join('/');
}

async function listAssetsRecursive(rootDir) {
  const entries = [];
  const queue = [rootDir];
  while (queue.length > 0 && entries.length < MAX_LISTING_ENTRIES) {
    const dir = queue.shift();
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
      // `extname('a.prefab.json')` is '.json', so prefabs need their own test
      // rather than an entry in LISTED_EXTENSIONS (which would list every JSON).
      const isListed =
        dirent.name.endsWith(PREFAB_FILE_SUFFIX)
        || LISTED_EXTENSIONS.has(extname(dirent.name).toLowerCase());
      if (!dirent.isFile() || !isListed) continue;
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
  entries.sort((left, right) => left.path.localeCompare(right.path));
  return entries;
}

/**
 * @param {string} rawProjectRoot Open Asteron project root (scenes, assets, …).
 * @param {{ engineRoot?: string }} [options]
 *   `engineRoot` is the AsteronEngine checkout. Animation controllers are
 *   engine-authored (stance → clip bindings); project only supplies the GLB
 *   files those controllers reference under `/assets/…`.
 */
export function createEditorRepository(rawProjectRoot, options = {}) {
  const projectRoot = resolve(rawProjectRoot);
  const engineRoot = resolve(
    typeof options.engineRoot === 'string' && options.engineRoot.trim()
      ? options.engineRoot
      : rawProjectRoot,
  );
  const sceneDataDir = () => resolve(projectRoot, 'src/world/scenes/data');
  const planetDataDir = () => resolve(projectRoot, 'src/world/planets/data');
  const systemDataDir = () => resolve(projectRoot, 'src/world/systems/data');
  /** Engine-owned: `*.controller.json` next to the bundled runtime default. */
  const animationControllerDataDir = () => resolve(engineRoot, 'src/player/animation/data');
  const baseCharacterEquipmentPath = () =>
    resolve(projectRoot, 'src/player/equipment/data/base-characters.json');
  const characterSettingsPath = () =>
    resolve(projectRoot, 'src/player/data/character-settings.json');
  const projectSettingsPath = () => resolve(projectRoot, 'asteron.project.json');
  const folderOrderPath = () => resolve(projectRoot, 'asteron.folder-order.json');
  const editorSessionPath = () => resolve(projectRoot, 'asteron.editor-session.json');

  function resolveAssetRoot(root) {
    if (!PROJECT_ASSET_ROOTS.includes(root)) {
      throw new EditorRepositoryError(`root must be one of: ${PROJECT_ASSET_ROOTS.join(', ')}`);
    }
    return resolve(projectRoot, root);
  }

  function resolveAssetPath(root, relativePath) {
    const assetRoot = resolveAssetRoot(root);
    const candidate = resolve(assetRoot, relativePath);
    if (!isInsidePath(candidate, assetRoot)) {
      throw new EditorRepositoryError('asset path escapes its allowed root', 403);
    }
    return candidate;
  }

  /**
   * Prefab identity is the document `id`, not the file location — the same
   * split Unity gets from `.meta` GUIDs. A prefab may live in any folder under
   * an asset root, so every lookup goes through a scan that maps id to path.
   * Moving a prefab file therefore breaks nothing.
   */
  async function scanPrefabFiles() {
    const found = new Map();
    const duplicates = [];
    for (const root of PROJECT_ASSET_ROOTS) {
      const rootDir = resolve(projectRoot, root);
      const queue = [rootDir];
      while (queue.length > 0) {
        const dir = queue.shift();
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
          if (!dirent.isFile() || !dirent.name.endsWith(PREFAB_FILE_SUFFIX)) continue;

          let document;
          try {
            document = JSON.parse(await readFile(absolute, 'utf8'));
          } catch {
            continue;
          }
          const id = typeof document?.id === 'string' ? document.id : '';
          if (!PREFAB_ID_PATTERN.test(id)) continue;

          const entry = {
            id,
            root,
            path: relative(resolve(projectRoot, root), absolute).split(sep).join('/'),
            absolute,
            kind: PREFAB_KINDS.has(document.kind) ? document.kind : 'station',
            name:
              typeof document.name === 'string' && document.name.trim()
                ? document.name.trim()
                : id,
          };
          const existing = found.get(id);
          if (existing) {
            duplicates.push({ id, paths: [existing.path, entry.path] });
            continue;
          }
          found.set(id, entry);
        }
      }
    }
    return { found, duplicates };
  }

  async function findPrefabFile(id) {
    const { found } = await scanPrefabFiles();
    return found.get(id) ?? null;
  }

  async function listPrefabs() {
    const { found, duplicates } = await scanPrefabFiles();
    for (const duplicate of duplicates) {
      console.warn(
        `[editor] duplicate prefab id "${duplicate.id}" in ${duplicate.paths.join(' and ')}; using the first.`,
      );
    }
    const prefabs = [...found.values()].map((entry) => ({
      id: entry.id,
      kind: entry.kind,
      name: entry.name,
      root: entry.root,
      path: entry.path,
    }));
    prefabs.sort(
      (left, right) => left.name.localeCompare(right.name) || left.id.localeCompare(right.id),
    );
    return { prefabs };
  }

  async function getPrefab(idValue) {
    const id = requireSlugId(idValue, 'prefab id');
    const entry = await findPrefabFile(id);
    if (!entry) throw new EditorRepositoryError(`prefab "${id}" not found`, 404);
    const document = await readJson(entry.absolute, `prefab "${id}" not found`);
    return { document };
  }

  /**
   * Writes back over the prefab's existing file when the id is already known,
   * so saving never silently duplicates or relocates a prefab. A brand new
   * prefab lands in `folder` (an asset-root-relative directory) or, absent
   * that, in the default prefab folder.
   */
  async function savePrefab(value, options = {}) {
    const document = requireDocument(value);
    const id = requireSlugId(document.id);
    const existing = await findPrefabFile(id);

    let absolute;
    if (existing) {
      absolute = existing.absolute;
    } else {
      const root = typeof options.root === 'string' && options.root ? options.root : 'assets';
      const folder = normalizeRelativePath(options.folder, 'prefab folder');
      const fileName = `${id}${PREFAB_FILE_SUFFIX}`;
      absolute = resolveAssetPath(root, folder ? `${folder}/${fileName}` : `${DEFAULT_PREFAB_FOLDER}/${fileName}`);
    }

    const path = await writeJson(projectRoot, absolute, document);
    return { saved: true, id, path };
  }

  /**
   * Rewrites `"prefabId": fromId` wherever it appears. Keyed on the field name
   * rather than the raw string so a prefab whose id collides with some label or
   * node name does not get its unrelated text mangled.
   */
  function rewritePrefabIdsInPlace(value, fromId, toId) {
    if (!value || typeof value !== 'object') return false;
    let changed = false;
    if (Array.isArray(value)) {
      for (const item of value) {
        if (rewritePrefabIdsInPlace(item, fromId, toId)) changed = true;
      }
      return changed;
    }
    for (const [key, item] of Object.entries(value)) {
      if (key === 'prefabId' && item === fromId) {
        value[key] = toId;
        changed = true;
      } else if (rewritePrefabIdsInPlace(item, fromId, toId)) {
        changed = true;
      }
    }
    return changed;
  }

  async function rewritePrefabIdReferences(fromId, toId, skipAbsolute) {
    const seen = new Set([skipAbsolute]);
    const rewritten = [];
    for (const dir of referenceDocumentDirs()) {
      for (const file of await listJsonFiles(dir)) {
        if (seen.has(file)) continue;
        seen.add(file);
        let document;
        try {
          document = JSON.parse(await readFile(file, 'utf8'));
        } catch {
          continue;
        }
        if (!rewritePrefabIdsInPlace(document, fromId, toId)) continue;
        rewritten.push(await writeJson(projectRoot, file, document));
      }
    }
    return rewritten;
  }

  /**
   * True rename: the document id, the file name, and every local `prefabId`
   * reference move together. Identity is the id, so this is the one operation
   * that can dangle a reference — anything holding the old id outside project
   * JSON (Postgres `Ship.prefabId`, saved player state) is NOT rewritten and is
   * reported back to the caller instead.
   */
  async function renamePrefab(fromIdValue, toIdValue, nameValue) {
    const fromId = requireSlugId(fromIdValue, 'prefab id');
    const toId = requireSlugId(toIdValue, 'new prefab id');
    const name = typeof nameValue === 'string' ? nameValue.trim() : '';
    if (!name) throw new EditorRepositoryError('prefab name is required');

    const existing = await findPrefabFile(fromId);
    if (!existing) throw new EditorRepositoryError(`prefab "${fromId}" not found`, 404);
    if (toId !== fromId && (await findPrefabFile(toId))) {
      throw new EditorRepositoryError(`prefab id "${toId}" is already taken`, 409);
    }

    const document = await readJson(existing.absolute, `prefab "${fromId}" not found`);
    document.id = toId;
    document.name = name;

    const destination = join(dirname(existing.absolute), `${toId}${PREFAB_FILE_SUFFIX}`);
    const path = await writeJson(projectRoot, destination, document);
    if (destination !== existing.absolute) {
      await rm(existing.absolute, { force: true });
    }

    const rewritten =
      toId === fromId ? [] : await rewritePrefabIdReferences(fromId, toId, destination);
    return { renamed: true, id: toId, path, rewritten };
  }

  async function getBaseCharacters() {
    const document = await readJson(
      baseCharacterEquipmentPath(),
      'base character equipment document not found',
    );
    return { document };
  }

  async function saveBaseCharacters(value) {
    const document = requireDocument(value);
    if (document.schemaVersion !== 1 || !Array.isArray(document.slots)) {
      throw new EditorRepositoryError('invalid base character equipment document');
    }
    const path = await writeJson(projectRoot, baseCharacterEquipmentPath(), document);
    return { saved: true, path };
  }

  async function getCharacterSettings() {
    const document = await readJson(
      characterSettingsPath(),
      'character settings document not found',
    );
    return { document };
  }

  async function saveCharacterSettings(value) {
    const document = requireDocument(value);
    const speeds = [
      document.walkSpeedMetersPerSecond,
      document.sprintSpeedMetersPerSecond,
      document.jumpSpeedMetersPerSecond,
    ];
    if (
      document.schemaVersion !== 1
      || speeds.some((speed) => typeof speed !== 'number' || !Number.isFinite(speed))
    ) {
      throw new EditorRepositoryError('invalid character settings document');
    }
    const path = await writeJson(projectRoot, characterSettingsPath(), document);
    return { saved: true, path };
  }

  /**
   * Project settings (`asteron.project.json`). `backendUrl` is the deployed
   * Rust API this project talks to; Build Web stamps it into the release so one
   * bundle can target any deployment. Players still authenticate normally, so
   * no secret lives in this file.
   */
  function normalizeProjectSettings(value) {
    const source = typeof value === 'object' && value !== null ? value : {};
    const backendUrl =
      typeof source.backendUrl === 'string' ? source.backendUrl.trim().replace(/\/$/, '') : '';
    const build =
      typeof source.build === 'object' && source.build !== null ? source.build : {};
    const contentPacks =
      typeof source.contentPacks === 'object' && source.contentPacks !== null
        ? source.contentPacks
        : {};
    const syntySidekick = normalizeContentPackPath(
      contentPacks.syntySidekick,
      'contentPacks.syntySidekick',
    );
    if (syntySidekick) {
      const absolute = resolve(projectRoot, syntySidekick);
      if (!isInsidePath(absolute, projectRoot)) {
        throw new EditorRepositoryError(
          'contentPacks.syntySidekick escapes the project root',
          403,
        );
      }
    }
    return {
      schemaVersion: 1,
      name: typeof source.name === 'string' && source.name.trim()
        ? source.name.trim()
        : basename(projectRoot),
      backendUrl: backendUrl || DEFAULT_BACKEND_URL,
      defaultScene: requireSlugId(
        typeof source.defaultScene === 'string' && source.defaultScene ? source.defaultScene : 'title',
        'defaultScene',
      ),
      build: {
        outDir: typeof build.outDir === 'string' && build.outDir.trim() ? build.outDir.trim() : 'dist',
      },
      contentPacks: {
        syntySidekick,
      },
    };
  }

  async function getProjectSettings() {
    let raw = {};
    try {
      raw = JSON.parse(await readFile(projectSettingsPath(), 'utf8'));
    } catch {
      // Projects created before project settings existed fall back to defaults.
    }
    return { document: normalizeProjectSettings(raw) };
  }

  async function saveProjectSettings(value) {
    const document = normalizeProjectSettings(requireDocument(value));
    if (!/^https?:\/\/[^\s]+$/.test(document.backendUrl)) {
      throw new EditorRepositoryError('backendUrl must be an http(s) URL');
    }
    const path = await writeJson(projectRoot, projectSettingsPath(), document);
    return { saved: true, path, document };
  }

  /**
   * Project folder sibling order (`asteron.folder-order.json`). Keys are parent
   * relative paths (`""` = Assets root); values are ordered child folder names.
   */
  function normalizeFolderOrder(value) {
    const source = typeof value === 'object' && value !== null && !Array.isArray(value) ? value : {};
    const orderSource =
      typeof source.order === 'object' && source.order !== null && !Array.isArray(source.order)
        ? source.order
        : {};
    const order = {};
    for (const [parentPath, names] of Object.entries(orderSource)) {
      if (typeof parentPath !== 'string') continue;
      if (parentPath.includes('\0') || parentPath.split('/').includes('..')) continue;
      if (!Array.isArray(names)) continue;
      const cleaned = [];
      const seen = new Set();
      for (const name of names) {
        if (typeof name !== 'string') continue;
        const trimmed = name.trim();
        if (!trimmed || trimmed.startsWith('.') || /[\\/\0]/.test(trimmed)) continue;
        if (seen.has(trimmed)) continue;
        seen.add(trimmed);
        cleaned.push(trimmed);
      }
      if (cleaned.length > 0) order[parentPath] = cleaned;
    }
    return { schemaVersion: 1, order };
  }

  async function getFolderOrder() {
    let raw = {};
    try {
      raw = JSON.parse(await readFile(folderOrderPath(), 'utf8'));
    } catch {
      // Projects without a saved order fall back to alphabetical.
    }
    return { document: normalizeFolderOrder(raw) };
  }

  async function saveFolderOrder(value) {
    const document = normalizeFolderOrder(requireDocument(value));
    const path = await writeJson(projectRoot, folderOrderPath(), document);
    return { saved: true, path, document };
  }

  /**
   * Local editor workspace state (`asteron.editor-session.json`). Remembers the
   * last scene opened in the Scene tab so cold start can restore it.
   */
  function normalizeEditorSession(value) {
    const source = typeof value === 'object' && value !== null && !Array.isArray(value) ? value : {};
    let lastOpenedSceneId = null;
    if (typeof source.lastOpenedSceneId === 'string' && source.lastOpenedSceneId.trim()) {
      try {
        lastOpenedSceneId = requireSlugId(source.lastOpenedSceneId.trim(), 'lastOpenedSceneId');
      } catch {
        lastOpenedSceneId = null;
      }
    }
    return { schemaVersion: 1, lastOpenedSceneId };
  }

  async function getEditorSession() {
    let raw = {};
    try {
      raw = JSON.parse(await readFile(editorSessionPath(), 'utf8'));
    } catch {
      // First open — cold start falls back to main-game.
    }
    return { document: normalizeEditorSession(raw) };
  }

  async function saveEditorSession(value) {
    const document = normalizeEditorSession(requireDocument(value));
    const path = await writeJson(projectRoot, editorSessionPath(), document);
    return { saved: true, path, document };
  }

  async function listAnimationControllers() {
    const controllers = [];
    try {
      const filenames = (await readdir(animationControllerDataDir())).filter((name) =>
        name.endsWith('.controller.json'),
      );
      for (const filename of filenames) {
        const id = filename.replace(/\.controller\.json$/, '');
        try {
          const document = JSON.parse(
            await readFile(join(animationControllerDataDir(), filename), 'utf8'),
          );
          const label =
            typeof document.label === 'string' && document.label.trim()
              ? document.label.trim()
              : id;
          controllers.push({ id, label });
        } catch {
          controllers.push({ id, label: id });
        }
      }
    } catch {
      // Engine checkout may lack the data dir in odd layouts; callers fall back.
    }
    controllers.sort((left, right) => left.id.localeCompare(right.id));
    return { controllers };
  }

  async function getAnimationController(idValue) {
    const id = requireSlugId(idValue, 'id');
    const document = await readJson(
      join(animationControllerDataDir(), `${id}.controller.json`),
      `animation controller "${id}" not found`,
    );
    return { document };
  }

  async function saveAnimationController(value) {
    const document = requireDocument(value);
    if (
      document.schemaVersion !== 1
      || !Array.isArray(document.stances)
      || !Array.isArray(document.states)
    ) {
      throw new EditorRepositoryError('invalid animation controller document');
    }
    const id = requireSlugId(document.id);
    const path = await writeJson(
      engineRoot,
      join(animationControllerDataDir(), `${id}.controller.json`),
      document,
    );
    return { saved: true, id, path };
  }

  async function listNamedDocuments(dataDir, suffix, key) {
    const documents = [];
    try {
      const filenames = (await readdir(dataDir)).filter((name) => name.endsWith(suffix));
      for (const filename of filenames) {
        const id = filename.slice(0, -suffix.length);
        try {
          const document = JSON.parse(await readFile(join(dataDir, filename), 'utf8'));
          const name =
            typeof document.name === 'string' && document.name.trim()
              ? document.name.trim()
              : id;
          documents.push({ id, name });
        } catch {
          documents.push({ id, name: id });
        }
      }
    } catch {
      // A new project may not have this data directory yet.
    }
    documents.sort(
      (left, right) => left.name.localeCompare(right.name) || left.id.localeCompare(right.id),
    );
    return { [key]: documents };
  }

  async function getNamedDocument(dataDir, suffix, kind, idValue) {
    const id = requireSlugId(idValue, `${kind} id`);
    const document = await readJson(join(dataDir, `${id}${suffix}`), `${kind} "${id}" not found`);
    return { document };
  }

  async function saveNamedDocument(dataDir, suffix, value) {
    const document = requireDocument(value);
    const id = requireSlugId(document.id);
    const path = await writeJson(projectRoot, join(dataDir, `${id}${suffix}`), document);
    return { saved: true, id, path };
  }

  /**
   * True when a JSON tree holds `sceneId` / `startingSceneId` equal to `id`.
   * Keyed on field names so a scene id that collides with a label is not a hit.
   */
  function documentReferencesSceneId(value, id) {
    if (!value || typeof value !== 'object') return false;
    if (Array.isArray(value)) {
      return value.some((item) => documentReferencesSceneId(item, id));
    }
    for (const [key, item] of Object.entries(value)) {
      if ((key === 'sceneId' || key === 'startingSceneId') && item === id) return true;
      if (documentReferencesSceneId(item, id)) return true;
    }
    return false;
  }

  async function collectSceneReferences(id) {
    const skip = join(sceneDataDir(), `${id}.scene.json`);
    const references = [];
    const seen = new Set([skip]);
    for (const dir of referenceDocumentDirs()) {
      for (const file of await listJsonFiles(dir)) {
        if (seen.has(file)) continue;
        seen.add(file);
        let document;
        try {
          document = JSON.parse(await readFile(file, 'utf8'));
        } catch {
          continue;
        }
        if (!documentReferencesSceneId(document, id)) continue;
        references.push(relative(projectRoot, file).split(sep).join('/'));
      }
    }
    references.sort();
    return references;
  }

  async function listSceneReferences(idValue) {
    const id = requireSlugId(idValue, 'scene id');
    const absolute = join(sceneDataDir(), `${id}.scene.json`);
    try {
      await stat(absolute);
    } catch {
      throw new EditorRepositoryError(`scene "${id}" not found`, 404);
    }
    return { id, references: await collectSceneReferences(id) };
  }

  /**
   * Removes `<sceneDataDir>/<id>.scene.json`. Blocks when the id is the project
   * `defaultScene` — change Project Settings first. Inbound sceneId /
   * startingSceneId refs are reported but not rewritten.
   */
  async function deleteScene(idValue) {
    const id = requireSlugId(idValue, 'scene id');
    const absolute = join(sceneDataDir(), `${id}.scene.json`);
    try {
      await stat(absolute);
    } catch {
      throw new EditorRepositoryError(`scene "${id}" not found`, 404);
    }

    const { document: settings } = await getProjectSettings();
    if (settings.defaultScene === id) {
      throw new EditorRepositoryError(
        `cannot delete "${id}": it is the project default scene. Change Project Settings first.`,
        400,
      );
    }

    const references = await collectSceneReferences(id);
    await rm(absolute, { force: true });
    return { deleted: true, id, references };
  }

  async function createAssetFolder(rootValue, parentPathValue, nameValue) {
    const root = typeof rootValue === 'string' ? rootValue : 'assets';
    if (!PROJECT_ASSET_ROOTS.includes(root)) {
      throw new EditorRepositoryError(`root must be one of: ${PROJECT_ASSET_ROOTS.join(', ')}`);
    }
    const parentPath = normalizeRelativePath(parentPathValue, 'parent folder path');
    const name = typeof nameValue === 'string' ? nameValue.trim() : '';
    if (!name) {
      throw new EditorRepositoryError('folder name is required');
    }
    if (name === '.' || name === '..' || /[\\/]/.test(name) || name.includes('\0')) {
      throw new EditorRepositoryError('folder name cannot contain path separators');
    }
    if (name.startsWith('.')) {
      throw new EditorRepositoryError('folder name cannot start with a dot');
    }

    const relativePath = parentPath ? `${parentPath}/${name}` : name;
    const absolute = resolveAssetPath(root, relativePath);
    try {
      const existing = await stat(absolute);
      if (existing.isDirectory()) {
        throw new EditorRepositoryError(`Folder already exists: ${relativePath}`, 409);
      }
      throw new EditorRepositoryError(`A file already exists at ${relativePath}`, 409);
    } catch (error) {
      if (error instanceof EditorRepositoryError) throw error;
      // Missing path — create it.
    }

    await mkdir(absolute, { recursive: true });
    return { root, path: relativePath, kind: 'dir' };
  }

  /**
   * Every project document that can hold an asset url. Prefabs and scenes store
   * urls as plain strings, so moving a model has to rewrite them or the
   * reference silently dangles — this is the bookkeeping Unity does with GUIDs.
   */
  function referenceDocumentDirs() {
    return [
      ...PROJECT_ASSET_ROOTS.map((root) => resolve(projectRoot, root)),
      sceneDataDir(),
      planetDataDir(),
      systemDataDir(),
      animationControllerDataDir(),
      dirname(baseCharacterEquipmentPath()),
    ];
  }

  async function listJsonFiles(rootDir) {
    const files = [];
    const queue = [rootDir];
    while (queue.length > 0) {
      const dir = queue.shift();
      let dirents;
      try {
        dirents = await readdir(dir, { withFileTypes: true });
      } catch {
        continue;
      }
      for (const dirent of dirents) {
        if (dirent.name.startsWith('.')) continue;
        const absolute = join(dir, dirent.name);
        if (dirent.isDirectory()) queue.push(absolute);
        else if (dirent.isFile() && dirent.name.endsWith('.json')) files.push(absolute);
      }
    }
    return files;
  }

  /** Rewrites every string that is `fromUrl` or sits under `fromUrl/`. */
  function rewriteUrlsInPlace(value, fromUrl, toUrl) {
    if (Array.isArray(value)) {
      let changed = false;
      for (let i = 0; i < value.length; i += 1) {
        const item = value[i];
        if (typeof item === 'string') {
          const next = rewriteUrl(item, fromUrl, toUrl);
          if (next !== item) {
            value[i] = next;
            changed = true;
          }
        } else if (rewriteUrlsInPlace(item, fromUrl, toUrl)) {
          changed = true;
        }
      }
      return changed;
    }
    if (!value || typeof value !== 'object') return false;

    let changed = false;
    for (const [key, item] of Object.entries(value)) {
      if (typeof item === 'string') {
        const next = rewriteUrl(item, fromUrl, toUrl);
        if (next !== item) {
          value[key] = next;
          changed = true;
        }
      } else if (rewriteUrlsInPlace(item, fromUrl, toUrl)) {
        changed = true;
      }
    }
    return changed;
  }

  function rewriteUrl(value, fromUrl, toUrl) {
    if (value === fromUrl) return toUrl;
    if (value.startsWith(`${fromUrl}/`)) return `${toUrl}${value.slice(fromUrl.length)}`;
    return value;
  }

  async function rewriteAssetReferences(fromUrl, toUrl) {
    const seen = new Set();
    let updated = 0;
    for (const dir of referenceDocumentDirs()) {
      for (const file of await listJsonFiles(dir)) {
        if (seen.has(file)) continue;
        seen.add(file);
        let document;
        let original;
        try {
          original = await readFile(file, 'utf8');
          document = JSON.parse(original);
        } catch {
          continue;
        }
        if (!rewriteUrlsInPlace(document, fromUrl, toUrl)) continue;
        await writeFile(file, `${JSON.stringify(document, null, 2)}\n`, 'utf8');
        updated += 1;
      }
    }
    return updated;
  }

  function assetUrlFor(root, relativePath) {
    const encoded = relativePath.split('/').map(encodeURIComponent).join('/');
    return `/${root}/${encoded}`;
  }

  /**
   * Moves or renames a file or folder within one asset root. `toPath` is the
   * full destination path, so this covers both drag-to-folder and rename.
   */
  async function moveAssetEntry(rootValue, fromPathValue, toPathValue) {
    const root = typeof rootValue === 'string' ? rootValue : 'assets';
    if (!PROJECT_ASSET_ROOTS.includes(root)) {
      throw new EditorRepositoryError(`root must be one of: ${PROJECT_ASSET_ROOTS.join(', ')}`);
    }
    const fromPath = normalizeRelativePath(fromPathValue, 'source path');
    const toPath = normalizeRelativePath(toPathValue, 'destination path');
    if (!fromPath) throw new EditorRepositoryError('source path is required');
    if (!toPath) throw new EditorRepositoryError('destination path is required');
    if (fromPath === toPath) {
      throw new EditorRepositoryError('source and destination are the same', 409);
    }
    if (toPath === fromPath || toPath.startsWith(`${fromPath}/`)) {
      throw new EditorRepositoryError('cannot move a folder into itself', 409);
    }

    const fromAbsolute = resolveAssetPath(root, fromPath);
    const toAbsolute = resolveAssetPath(root, toPath);

    let fromStat;
    try {
      fromStat = await stat(fromAbsolute);
    } catch {
      throw new EditorRepositoryError(`${fromPath} not found`, 404);
    }
    try {
      await stat(toAbsolute);
      throw new EditorRepositoryError(`${toPath} already exists`, 409);
    } catch (error) {
      if (error instanceof EditorRepositoryError) throw error;
      // Destination is free.
    }

    await mkdir(dirname(toAbsolute), { recursive: true });
    await rename(fromAbsolute, toAbsolute);

    const updatedReferences = await rewriteAssetReferences(
      assetUrlFor(root, fromPath),
      assetUrlFor(root, toPath),
    );
    return {
      root,
      path: toPath,
      kind: fromStat.isDirectory() ? 'dir' : 'file',
      updatedReferences,
    };
  }

  async function deleteAssetEntry(rootValue, pathValue) {
    const root = typeof rootValue === 'string' ? rootValue : 'assets';
    if (!PROJECT_ASSET_ROOTS.includes(root)) {
      throw new EditorRepositoryError(`root must be one of: ${PROJECT_ASSET_ROOTS.join(', ')}`);
    }
    const path = normalizeRelativePath(pathValue, 'path');
    if (!path) throw new EditorRepositoryError('path is required');

    const absolute = resolveAssetPath(root, path);
    let info;
    try {
      info = await stat(absolute);
    } catch {
      throw new EditorRepositoryError(`${path} not found`, 404);
    }
    if (info.isDirectory()) {
      const children = await readdir(absolute);
      if (children.length > 0) {
        throw new EditorRepositoryError(`${path} is not empty`, 409);
      }
      await rm(absolute, { recursive: false });
    } else {
      await rm(absolute, { force: true });
    }
    return { root, path };
  }

  return Object.freeze({
    projectRoot,
    engineRoot,
    resolveAssetPath,
    listAssets: async (root) => ({
      root,
      entries: await listAssetsRecursive(resolveAssetRoot(root)),
    }),
    createAssetFolder,
    moveAssetEntry,
    deleteAssetEntry,
    listPrefabs,
    getPrefab,
    savePrefab,
    renamePrefab,
    listScenes: () => listNamedDocuments(sceneDataDir(), '.scene.json', 'scenes'),
    getScene: (id) => getNamedDocument(sceneDataDir(), '.scene.json', 'scene', id),
    saveScene: (document) => saveNamedDocument(sceneDataDir(), '.scene.json', document),
    listSceneReferences,
    deleteScene,
    getBaseCharacters,
    saveBaseCharacters,
    getCharacterSettings,
    saveCharacterSettings,
    getProjectSettings,
    saveProjectSettings,
    getFolderOrder,
    saveFolderOrder,
    getEditorSession,
    saveEditorSession,
    listAnimationControllers,
    getAnimationController,
    saveAnimationController,
    listPlanets: () => listNamedDocuments(planetDataDir(), '.planet.json', 'planets'),
    getPlanet: (id) => getNamedDocument(planetDataDir(), '.planet.json', 'planet', id),
    savePlanet: (document) => saveNamedDocument(planetDataDir(), '.planet.json', document),
    listSystems: () => listNamedDocuments(systemDataDir(), '.system.json', 'systems'),
    getSystem: (id) => getNamedDocument(systemDataDir(), '.system.json', 'system', id),
    saveSystem: (document) => saveNamedDocument(systemDataDir(), '.system.json', document),
  });
}
