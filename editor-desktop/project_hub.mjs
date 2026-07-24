import { access, mkdir, readFile, stat, writeFile } from 'node:fs/promises';
import { basename, dirname, join, resolve } from 'node:path';

export const MAX_RECENT_PROJECTS = 20;

const PROJECT_NAME_PATTERN = /^[A-Za-z0-9][A-Za-z0-9._ -]{0,63}$/;

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

export async function isAsteronEngineProject(candidate) {
  if (!candidate) return false;
  try {
    const root = resolve(candidate);
    const [packageStat, prefabStat] = await Promise.all([
      stat(join(root, 'package.json')),
      stat(join(root, 'src/world/prefabs/data')),
    ]);
    return packageStat.isFile() && prefabStat.isDirectory();
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

  async function rememberProject(projectRoot) {
    const root = resolve(projectRoot);
    const settings = await readSettings();
    const next = [
      {
        path: root,
        name: basename(root),
        openedAt: Date.now(),
      },
      ...settings.recentProjects.filter((entry) => entry.path !== root),
    ].slice(0, MAX_RECENT_PROJECTS);
    await writeSettings({ recentProjects: next });
    return root;
  }

  async function removeRecentProject(projectRoot) {
    const root = resolve(projectRoot);
    const settings = await readSettings();
    await writeSettings({
      recentProjects: settings.recentProjects.filter((entry) => entry.path !== root),
    });
    return listRecentProjects();
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
      'src/world/prefabs/data',
      'src/world/scenes/data',
      'src/world/planets/data',
      'src/world/systems/data',
      'src/player/animation/data',
      'src/player/equipment/data',
      'src/player/data',
      'editor/assets',
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

    await writeJson(join(projectRoot, 'src/world/prefabs/data/untitled-prefab.prefab.json'), {
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

    const sceneSettings = {
      systemId: 'default',
      planetId: 'asteron',
      spawn: 'station',
    };
    await writeJson(join(projectRoot, 'src/world/scenes/data/title.scene.json'), {
      schemaVersion: 1,
      id: 'title',
      name: 'Title',
      kind: 'title',
      settings: sceneSettings,
    });
    await writeJson(join(projectRoot, 'src/world/scenes/data/main-game.scene.json'), {
      schemaVersion: 1,
      id: 'main-game',
      name: 'Main Game',
      kind: 'main-game',
      settings: sceneSettings,
    });

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
    await writeFile(join(projectRoot, 'editor/assets/.gitkeep'), '');

    if (!(await isAsteronEngineProject(projectRoot))) {
      throw new Error('Failed to create a valid AsteronEngine project.');
    }
    return { projectRoot };
  }

  return Object.freeze({
    listRecentProjects,
    rememberProject,
    removeRecentProject,
    createProject,
    isAsteronEngineProject,
  });
}
