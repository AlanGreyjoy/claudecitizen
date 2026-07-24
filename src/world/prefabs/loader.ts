import { parsePrefabDocument, type PrefabDocument } from './schema';
import { AUTHORING_ENABLED } from '../../build_mode';

/**
 * Prefab JSON files live in src/world/prefabs/data/<id>.prefab.json.
 *
 * Public game builds bundle files via import.meta.glob. Authoring builds fetch
 * through /__editor so freshly saved prefabs
 * load without going through Vite's module graph (the data folder is excluded
 * from the dev watcher — HMR reloads there would race editor → Play
 * navigation).
 */
const prefabModules = import.meta.glob('./data/*.prefab.json', { import: 'default' }) as Record<
  string,
  () => Promise<unknown>
>;

function modulePathForId(id: string): string {
  return `./data/${id}.prefab.json`;
}

export function listBundledPrefabIds(): string[] {
  return Object.keys(prefabModules)
    .map((path) => path.replace('./data/', '').replace('.prefab.json', ''))
    .sort();
}

async function loadFromDevApi(id: string): Promise<PrefabDocument | null> {
  const response = await fetch(`/__editor/prefab?id=${encodeURIComponent(id)}`);
  if (!response.ok) return null;
  const payload = (await response.json()) as { document?: unknown };
  return parsePrefabDocument(payload.document);
}

/** Loads and validates a prefab document; returns null when missing. */
export async function loadPrefabDocument(id: string): Promise<PrefabDocument | null> {
  try {
    if (AUTHORING_ENABLED) {
      const fresh = await loadFromDevApi(id).catch(() => null);
      if (fresh) return fresh;
      // Fall through to the bundled copy (e.g. `vite preview` without the dev API).
    }
    const load = prefabModules[modulePathForId(id)];
    if (!load) return null;
    return parsePrefabDocument(await load());
  } catch (error) {
    console.error(`ClaudeCitizen prefab "${id}" failed to parse.`, error);
    return null;
  }
}
