import { access, mkdir, readFile, rm, stat, writeFile } from 'node:fs/promises';
import { basename, dirname, join, resolve } from 'node:path';

export const MAX_RECENT_PROJECTS = 20;

const PROJECT_NAME_PATTERN = /^[A-Za-z0-9][A-Za-z0-9._ -]{0,63}$/;

/** Keep in sync with SCENE_SCHEMA_VERSION in src/world/scenes/schema.ts. */
const SCENE_SCHEMA_VERSION = 3;

function identityTransform() {
  return {
    position: { x: 0, y: 0, z: 0 },
    rotation: { x: 0, y: 0, z: 0, w: 1 },
    scale: { x: 1, y: 1, z: 1 },
  };
}

function sceneObject(id, name, components) {
  return { id, name, transform: identityTransform(), components };
}

function sceneDocument(id, name, kind, gameObjects) {
  return { schemaVersion: SCENE_SCHEMA_VERSION, id, name, kind, gameObjects };
}

function identityMount(bone = 'spine_01') {
  return {
    bone,
    position: { x: 0, y: 0, z: 0 },
    rotation: { x: 0, y: 0, z: 0, w: 1 },
    scale: { x: 1, y: 1, z: 1 },
  };
}

async function pathExists(candidate) {
  try {
    await access(candidate);
    return true;
  } catch {
    return false;
  }
}

/**
 * A project is a package.json plus the `assets/` library that holds its
 * prefabs and models. Prefabs are no longer pinned to a fixed data directory,
 * so `assets/` is what identifies the project.
 */
export async function isAsteronEngineProject(candidate) {
  if (!candidate) return false;
  try {
    const root = resolve(candidate);
    const [packageStat, assetsStat] = await Promise.all([
      stat(join(root, 'package.json')),
      stat(join(root, 'assets')),
    ]);
    return packageStat.isFile() && assetsStat.isDirectory();
  } catch {
    return false;
  }
}

export function createProjectHub({ settingsPath }) {
  async function readSettings() {
    try {
      const value = JSON.parse(await readFile(settingsPath(), 'utf8'));
      const recent = Array.isArray(value.recentProjects) ? value.recentProjects : [];
      const legacyRoot =
        typeof value.projectRoot === 'string' && value.projectRoot.trim()
          ? value.projectRoot.trim()
          : null;
      const recentProjects = [];
      const seen = new Set();
      for (const entry of recent) {
        if (!entry || typeof entry !== 'object') continue;
        const path = typeof entry.path === 'string' ? resolve(entry.path) : '';
        if (!path || seen.has(path)) continue;
        seen.add(path);
        recentProjects.push({
          path,
          name:
            typeof entry.name === 'string' && entry.name.trim()
              ? entry.name.trim()
              : basename(path),
          openedAt:
            typeof entry.openedAt === 'number' && Number.isFinite(entry.openedAt)
              ? entry.openedAt
              : 0,
        });
      }
      if (legacyRoot) {
        const path = resolve(legacyRoot);
        if (!seen.has(path)) {
          recentProjects.push({ path, name: basename(path), openedAt: 0 });
        }
      }
      recentProjects.sort((left, right) => right.openedAt - left.openedAt);
      return { recentProjects: recentProjects.slice(0, MAX_RECENT_PROJECTS) };
    } catch {
      return { recentProjects: [] };
    }
  }

  async function writeSettings(settings) {
    await writeFile(
      settingsPath(),
      `${JSON.stringify({ recentProjects: settings.recentProjects }, null, 2)}\n`,
      'utf8',
    );
  }

  async function listRecentProjects() {
    const settings = await readSettings();
    const projects = [];
    for (const entry of settings.recentProjects) {
      if (!(await isAsteronEngineProject(entry.path))) continue;
      projects.push({
        path: entry.path,
        name: entry.name || basename(entry.path),
        openedAt: entry.openedAt,
      });
    }
    if (projects.length !== settings.recentProjects.length) {
      await writeSettings({ recentProjects: projects });
    }
    return { projects };
  }

  /** Display name comes from `asteron.project.json`; folder basename is the fallback. */
  async function readProjectDisplayName(projectRoot) {
    try {
      const raw = JSON.parse(
        await readFile(join(projectRoot, 'asteron.project.json'), 'utf8'),
      );
      if (typeof raw.name === 'string' && raw.name.trim()) return raw.name.trim();
    } catch {
      // Projects created before project settings existed have no settings file.
    }
    return basename(projectRoot);
  }

  async function rememberProject(projectRoot) {
    const root = resolve(projectRoot);
    const settings = await readSettings();
    const next = [
      {
        path: root,
        name: await readProjectDisplayName(root),
        openedAt: Date.now(),
      },
      ...settings.recentProjects.filter((entry) => entry.path !== root),
    ].slice(0, MAX_RECENT_PROJECTS);
    await writeSettings({ recentProjects: next });
    return root;
  }

  /**
   * Rename the project's display name. Writes `asteron.project.json` and the
   * recent-projects entry; the folder on disk is intentionally untouched
   * (path is the project's identity in recents and open flows).
   */
  async function renameProject(projectRoot, rawName) {
    const root = resolve(projectRoot);
    const name = sanitizeProjectName(rawName);
    if (!(await isAsteronEngineProject(root))) {
      throw new Error(`${root} is not an AsteronEngine project.`);
    }
    const settingsFile = join(root, 'asteron.project.json');
    let document = {};
    try {
      const raw = JSON.parse(await readFile(settingsFile, 'utf8'));
      if (raw && typeof raw === 'object') document = raw;
    } catch {
      // Older projects get a minimal settings file created on rename.
    }
    await writeJson(settingsFile, { schemaVersion: 1, ...document, name });

    const settings = await readSettings();
    await writeSettings({
      recentProjects: settings.recentProjects.map((entry) =>
        entry.path === root ? { ...entry, name } : entry,
      ),
    });
    return listRecentProjects();
  }

  async function removeRecentProject(projectRoot) {
    const root = resolve(projectRoot);
    const settings = await readSettings();
    await writeSettings({
      recentProjects: settings.recentProjects.filter((entry) => entry.path !== root),
    });
    return listRecentProjects();
  }

  /**
   * Permanently delete an AsteronEngine project folder and drop it from
   * recents. Caller must confirm with the user first — this is irreversible.
   */
  async function deleteProject(projectRoot) {
    const root = resolve(projectRoot);
    if (!(await isAsteronEngineProject(root))) {
      throw new Error(`${root} is not an AsteronEngine project.`);
    }
    await rm(root, { recursive: true, force: false });
    return removeRecentProject(root);
  }

  async function writeJson(filePath, document) {
    await mkdir(dirname(filePath), { recursive: true });
    await writeFile(filePath, `${JSON.stringify(document, null, 2)}\n`, 'utf8');
  }

  function sanitizeProjectName(rawName) {
    const name = typeof rawName === 'string' ? rawName.trim() : '';
    if (!PROJECT_NAME_PATTERN.test(name)) {
      throw new Error(
        'Project name must start with a letter or digit and use only letters, digits, spaces, dots, underscores, or hyphens.',
      );
    }
    return name;
  }

  async function createProject({ name: rawName, parentDir }) {
    const name = sanitizeProjectName(rawName);
    if (typeof parentDir !== 'string' || !parentDir.trim()) {
      throw new Error('Choose a location for the new project.');
    }
    const parent = resolve(parentDir);
    let parentStat;
    try {
      parentStat = await stat(parent);
    } catch {
      throw new Error('The selected location does not exist.');
    }
    if (!parentStat.isDirectory()) {
      throw new Error('The selected location must be a folder.');
    }

    const projectRoot = resolve(parent, name);
    if (await pathExists(projectRoot)) {
      throw new Error(`A folder already exists at ${projectRoot}.`);
    }

    const dirs = [
      'src/world/scenes/data',
      'src/world/planets/data',
      'src/world/systems/data',
      'src/player/animation/data',
      'src/player/equipment/data',
      'src/player/data',
      'assets',
      'assets/Prefabs',
    ];
    for (const relativeDir of dirs) {
      await mkdir(join(projectRoot, relativeDir), { recursive: true });
    }

    await writeJson(join(projectRoot, 'package.json'), {
      name: name
        .toLowerCase()
        .replace(/[^a-z0-9]+/g, '-')
        .replace(/^-+|-+$/g, '') || 'asteron-project',
      private: true,
      asteronEngine: { projectVersion: 1 },
    });

    await writeJson(join(projectRoot, 'asteron.project.json'), {
      schemaVersion: 1,
      name,
      backendUrl: 'http://localhost:3000',
      defaultScene: 'title',
      build: { outDir: 'dist' },
      contentPacks: { syntySidekick: '' },
    });

    await writeJson(join(projectRoot, 'assets/Prefabs/untitled-prefab.prefab.json'), {
      id: 'untitled-prefab',
      name: 'Untitled Prefab',
      version: 1,
      kind: 'station',
      root: {
        id: 'root',
        name: 'Untitled Prefab',
        transform: {
          position: { x: 0, y: 0, z: 0 },
          rotation: { x: 0, y: 0, z: 0, w: 1 },
          scale: { x: 1, y: 1, z: 1 },
        },
        components: [{ type: 'station-frame' }],
        children: [],
      },
    });

    await writeJson(
      join(projectRoot, 'src/world/scenes/data/title.scene.json'),
      sceneDocument('title', 'Title', 'title', [
        sceneObject('title-screen', 'Title Screen', [
          { type: 'ui-screen', screen: 'title' },
          { type: 'scene-link', sceneId: 'main-game' },
        ]),
      ]),
    );
    await writeJson(
      join(projectRoot, 'src/world/scenes/data/character-creation.scene.json'),
      sceneDocument('character-creation', 'Character Creation', 'character-creator', [
        sceneObject('character-create-screen', 'Character Create Screen', [
          { type: 'ui-screen', screen: 'character-create' },
          { type: 'scene-link', sceneId: 'main-game' },
        ]),
      ]),
    );
    await writeJson(
      join(projectRoot, 'src/world/scenes/data/main-game.scene.json'),
      sceneDocument('main-game', 'Main Game', 'main-game', [
        sceneObject('game-manager', 'Game Manager', [
          {
            type: 'game-manager',
            systemId: 'default',
            planetId: 'asteron',
            spawn: 'station',
          },
        ]),
        sceneObject('planet', 'Planet', [{ type: 'planet', planetId: 'asteron' }]),
        sceneObject('player-start', 'Player Start', [
          { type: 'player-start', spawn: 'station' },
        ]),
      ]),
    );

    await writeJson(join(projectRoot, 'src/world/planets/data/asteron.planet.json'), {
      id: 'asteron',
      name: 'Asteron',
      seed: 20061,
    });

    await writeJson(join(projectRoot, 'src/world/systems/data/default.system.json'), {
      id: 'default',
      name: 'Asteron System',
      star: { name: 'Asteron Prime' },
      planets: [
        {
          id: 'asteron',
          planetId: 'asteron',
          name: 'Asteron',
          positionMeters: { x: 10_000_000_000, z: 0 },
        },
      ],
      stations: [],
    });

    await writeJson(join(projectRoot, 'src/player/data/character-settings.json'), {
      schemaVersion: 1,
      walkSpeedMetersPerSecond: 1.5,
      runSpeedMetersPerSecond: 3.5,
      sprintSpeedMetersPerSecond: 5.3,
      jumpSpeedMetersPerSecond: 5.2,
    });

    const backpackMount = identityMount('spine_01');
    await writeJson(join(projectRoot, 'src/player/equipment/data/base-characters.json'), {
      schemaVersion: 1,
      slots: [{ id: 'backpack', label: 'Backpack', kind: 'backpack' }],
      variants: {
        '1': {
          type: 1,
          label: 'Character 1',
          mounts: { backpack: backpackMount },
        },
        '2': {
          type: 2,
          label: 'Character 2',
          mounts: { backpack: { ...backpackMount } },
        },
      },
    });

    // Keep empty asset dirs discoverable in Project panel listings.
    await writeFile(join(projectRoot, 'assets/.gitkeep'), '');
    await writeFile(
      join(projectRoot, 'assets/README.md'),
      [
        '# Project assets',
        '',
        'Drop importable GLBs, textures, and audio here. AsteronEngine serves',
        'them at `/assets/...` for the open project only. Organize folders',
        'however you like — use New Folder from the Project panel.',
        '',
        'Prefabs (`*.prefab.json`) live here too and may sit in any folder.',
        'Drag a GameObject from the Hierarchy onto a folder to save one.',
        '',
      ].join('\n'),
    );

    if (!(await isAsteronEngineProject(projectRoot))) {
      throw new Error('Failed to create a valid AsteronEngine project.');
    }
    return { projectRoot };
  }

  return Object.freeze({
    listRecentProjects,
    rememberProject,
    removeRecentProject,
    renameProject,
    deleteProject,
    createProject,
    isAsteronEngineProject,
  });
}
