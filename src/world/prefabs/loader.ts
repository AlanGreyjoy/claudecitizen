import { parsePrefabDocument, type PrefabDocument } from './schema';
import { AUTHORING_ENABLED } from '../../build-mode';

/**
 * Prefab JSON files are project assets: they live in any folder under
 * `<project>/assets/` (or `src/assets/`) and their identity is the document
 * `id`, not the file path. Moving a prefab therefore breaks no references.
 *
 * Public game builds bundle the files via import.meta.glob. Authoring builds
 * fetch through /__editor so freshly saved prefabs load without going through
 * Vite's module graph (HMR reloads there would race editor -> Play navigation).
 */
const prefabModules = import.meta.glob('/{assets,src/assets}/**/*.prefab.json', {
  import: 'default',
}) as Record<string, () => Promise<unknown>>;

/**
 * Fast path. `savePrefab` always names a prefab file `<id>.prefab.json`, so the
 * filename resolves an id with a single dynamic import instead of loading every
 * prefab in the project. A hand-renamed file falls back to the full index.
 */
const modulesByFileName = new Map<string, () => Promise<unknown>>();
for (const [path, load] of Object.entries(prefabModules)) {
  const fileName = path.slice(path.lastIndexOf('/') + 1);
  if (!modulesByFileName.has(fileName)) modulesByFileName.set(fileName, load);
}

let indexPromise: Promise<Map<string, PrefabDocument>> | null = null;

async function buildIndex(): Promise<Map<string, PrefabDocument>> {
  const index = new Map<string, PrefabDocument>();
  for (const [path, load] of Object.entries(prefabModules)) {
    let document: PrefabDocument;
    try {
      document = parsePrefabDocument(await load());
    } catch (error) {
      console.error(`ClaudeCitizen prefab "${path}" failed to parse.`, error);
      continue;
    }
    if (index.has(document.id)) {
      console.warn(`ClaudeCitizen prefab id "${document.id}" is duplicated; ${path} was ignored.`);
      continue;
    }
    index.set(document.id, document);
  }
  return index;
}

function bundledIndex(): Promise<Map<string, PrefabDocument>> {
  indexPromise ??= buildIndex();
  return indexPromise;
}

/**
 * Every bundled prefab document. This loads and parses all of them, so prefer
 * `loadPrefabDocument` when a specific id is known.
 */
export async function listBundledPrefabs(): Promise<PrefabDocument[]> {
  return [...(await bundledIndex()).values()];
}

async function loadFromDevApi(id: string): Promise<PrefabDocument | null> {
  const response = await fetch(`/__editor/prefab?id=${encodeURIComponent(id)}`);
  if (!response.ok) return null;
  const payload = (await response.json()) as { document?: unknown };
  return parsePrefabDocument(payload.document);
}

async function loadFromBundle(id: string): Promise<PrefabDocument | null> {
  const byFileName = modulesByFileName.get(`${id}.prefab.json`);
  if (byFileName) {
    const document = parsePrefabDocument(await byFileName());
    if (document.id === id) return document;
  }
  return (await bundledIndex()).get(id) ?? null;
}

/** Loads and validates a prefab document; returns null when missing. */
export async function loadPrefabDocument(id: string): Promise<PrefabDocument | null> {
  try {
    if (AUTHORING_ENABLED) {
      const fresh = await loadFromDevApi(id).catch(() => null);
      if (fresh) return fresh;
      // Fall through to the bundled copy (e.g. `vite preview` without the dev API).
    }
    return await loadFromBundle(id);
  } catch (error) {
    console.error(`ClaudeCitizen prefab "${id}" failed to parse.`, error);
    return null;
  }
}
