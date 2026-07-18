import { parsePlanetDocument, type PlanetDocument } from './schema';

/**
 * Planet JSON files live in src/world/planets/data/<id>.planet.json.
 *
 * Production: bundled via import.meta.glob.
 * Dev: prefer /__editor/planet so freshly saved planets load without HMR.
 */
const planetModules = import.meta.glob('./data/*.planet.json', { import: 'default' }) as Record<
  string,
  () => Promise<unknown>
>;

function modulePathForId(id: string): string {
  return `./data/${id}.planet.json`;
}

export function listBundledPlanetIds(): string[] {
  return Object.keys(planetModules)
    .map((path) => path.replace('./data/', '').replace('.planet.json', ''))
    .sort();
}

export function listPlanetDocumentsMeta(): Array<{ id: string; name: string }> {
  return listBundledPlanetIds().map((id) => ({ id, name: id }));
}

async function loadFromDevApi(id: string): Promise<PlanetDocument | null> {
  const response = await fetch(`/__editor/planet?id=${encodeURIComponent(id)}`);
  if (!response.ok) return null;
  const payload = (await response.json()) as { document?: unknown };
  return parsePlanetDocument(payload.document);
}

/** Loads and validates a planet document; returns null when missing. */
export async function loadPlanetDocument(id: string): Promise<PlanetDocument | null> {
  try {
    if (import.meta.env.DEV) {
      const fresh = await loadFromDevApi(id).catch(() => null);
      if (fresh) return fresh;
    }
    const load = planetModules[modulePathForId(id)];
    if (!load) return null;
    return parsePlanetDocument(await load());
  } catch (error) {
    console.error(`ClaudeCitizen planet "${id}" failed to parse.`, error);
    return null;
  }
}

export async function listPlanetDocuments(): Promise<Array<{ id: string; name: string }>> {
  if (import.meta.env.DEV) {
    try {
      const response = await fetch('/__editor/planets');
      if (response.ok) {
        const payload = (await response.json()) as {
          planets?: Array<{ id: string; name: string }>;
        };
        if (Array.isArray(payload.planets)) return payload.planets;
      }
    } catch {
      // Fall through to bundled ids.
    }
  }
  const ids = listBundledPlanetIds();
  const docs = await Promise.all(ids.map((id) => loadPlanetDocument(id)));
  return docs
    .filter((doc): doc is PlanetDocument => doc != null)
    .map((doc) => ({ id: doc.id, name: doc.name }));
}
