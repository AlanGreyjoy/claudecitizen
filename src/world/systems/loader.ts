import { parseSystemDocument, type SystemDocument } from './schema';

/**
 * System JSON files live in src/world/systems/data/<id>.system.json.
 *
 * Production: bundled via import.meta.glob.
 * Dev: prefer /__editor/system so freshly saved systems load without HMR.
 */
const systemModules = import.meta.glob('./data/*.system.json', { import: 'default' }) as Record<
  string,
  () => Promise<unknown>
>;

function modulePathForId(id: string): string {
  return `./data/${id}.system.json`;
}

export function listBundledSystemIds(): string[] {
  return Object.keys(systemModules)
    .map((path) => path.replace('./data/', '').replace('.system.json', ''))
    .sort();
}

export function listSystemDocumentsMeta(): Array<{ id: string; name: string }> {
  return listBundledSystemIds().map((id) => ({ id, name: id }));
}

async function loadFromDevApi(id: string): Promise<SystemDocument | null> {
  const response = await fetch(`/__editor/system?id=${encodeURIComponent(id)}`);
  if (!response.ok) return null;
  const payload = (await response.json()) as { document?: unknown };
  return parseSystemDocument(payload.document);
}

/** Loads and validates a system document; returns null when missing. */
export async function loadSystemDocument(id: string): Promise<SystemDocument | null> {
  try {
    if (import.meta.env.DEV) {
      const fresh = await loadFromDevApi(id).catch(() => null);
      if (fresh) return fresh;
    }
    const load = systemModules[modulePathForId(id)];
    if (!load) return null;
    return parseSystemDocument(await load());
  } catch (error) {
    console.error(`ClaudeCitizen system "${id}" failed to parse.`, error);
    return null;
  }
}

export function listSystemDocumentIds(): string[] {
  return listBundledSystemIds();
}

export async function listSystemDocuments(): Promise<Array<{ id: string; name: string }>> {
  if (import.meta.env.DEV) {
    try {
      const response = await fetch('/__editor/systems');
      if (response.ok) {
        const payload = (await response.json()) as {
          systems?: Array<{ id: string; name: string }>;
        };
        if (Array.isArray(payload.systems)) return payload.systems;
      }
    } catch {
      // Fall through to bundled ids.
    }
  }
  const ids = listBundledSystemIds();
  const docs = await Promise.all(ids.map((id) => loadSystemDocument(id)));
  return docs
    .filter((doc): doc is SystemDocument => doc != null)
    .map((doc) => ({ id: doc.id, name: doc.name }));
}
