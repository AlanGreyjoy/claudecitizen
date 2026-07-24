import { mkdir, readdir, readFile, stat, writeFile } from 'node:fs/promises';
import { dirname, extname, isAbsolute, join, relative, resolve, sep } from 'node:path';

export const EDITOR_ASSET_ROOTS = Object.freeze(['editor/assets', 'src/assets']);

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
      if (!dirent.isFile() || !LISTED_EXTENSIONS.has(extname(dirent.name).toLowerCase())) {
        continue;
      }
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

export function createEditorRepository(rawProjectRoot) {
  const projectRoot = resolve(rawProjectRoot);
  const prefabDataDir = () => resolve(projectRoot, 'src/world/prefabs/data');
  const sceneDataDir = () => resolve(projectRoot, 'src/world/scenes/data');
  const planetDataDir = () => resolve(projectRoot, 'src/world/planets/data');
  const systemDataDir = () => resolve(projectRoot, 'src/world/systems/data');
  const animationControllerDataDir = () => resolve(projectRoot, 'src/player/animation/data');
  const baseCharacterEquipmentPath = () =>
    resolve(projectRoot, 'src/player/equipment/data/base-characters.json');
  const characterSettingsPath = () =>
    resolve(projectRoot, 'src/player/data/character-settings.json');

  function resolveAssetRoot(root) {
    if (!EDITOR_ASSET_ROOTS.includes(root)) {
      throw new EditorRepositoryError(`root must be one of: ${EDITOR_ASSET_ROOTS.join(', ')}`);
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

  async function listPrefabs() {
    const prefabs = [];
    try {
      const filenames = (await readdir(prefabDataDir())).filter((name) =>
        name.endsWith('.prefab.json'),
      );
      for (const filename of filenames) {
        const id = filename.replace('.prefab.json', '');
        try {
          const document = JSON.parse(await readFile(join(prefabDataDir(), filename), 'utf8'));
          const kind =
            typeof document.kind === 'string' && PREFAB_KINDS.has(document.kind)
              ? document.kind
              : 'station';
          const name =
            typeof document.name === 'string' && document.name.trim()
              ? document.name.trim()
              : id;
          prefabs.push({ id, kind, name });
        } catch {
          prefabs.push({ id, kind: 'station', name: id });
        }
      }
    } catch {
      // A new project may not have a prefab directory yet.
    }
    prefabs.sort(
      (left, right) => left.name.localeCompare(right.name) || left.id.localeCompare(right.id),
    );
    return { prefabs };
  }

  async function getPrefab(idValue) {
    const id = requireSlugId(idValue, 'prefab id');
    const document = await readJson(
      join(prefabDataDir(), `${id}.prefab.json`),
      `prefab "${id}" not found`,
    );
    return { document };
  }

  async function savePrefab(value) {
    const document = requireDocument(value);
    const id = requireSlugId(document.id);
    const path = await writeJson(
      projectRoot,
      join(prefabDataDir(), `${id}.prefab.json`),
      document,
    );
    return { saved: true, id, path };
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
      // A new project may not have controller data yet.
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
      projectRoot,
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

  return Object.freeze({
    projectRoot,
    resolveAssetPath,
    listAssets: async (root) => ({
      root,
      entries: await listAssetsRecursive(resolveAssetRoot(root)),
    }),
    listPrefabs,
    getPrefab,
    savePrefab,
    listScenes: () => listNamedDocuments(sceneDataDir(), '.scene.json', 'scenes'),
    getScene: (id) => getNamedDocument(sceneDataDir(), '.scene.json', 'scene', id),
    saveScene: (document) => saveNamedDocument(sceneDataDir(), '.scene.json', document),
    getBaseCharacters,
    saveBaseCharacters,
    getCharacterSettings,
    saveCharacterSettings,
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
