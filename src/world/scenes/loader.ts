import { AUTHORING_ENABLED } from '../../build_mode';
import { parseSceneDocument, type SceneDocument } from './schema';

const sceneModules = import.meta.glob('./data/*.scene.json', { import: 'default' }) as Record<
  string,
  () => Promise<unknown>
>;

function modulePathForId(id: string): string {
  return `./data/${id}.scene.json`;
}

async function loadFromEditorApi(id: string): Promise<SceneDocument | null> {
  const response = await fetch(`/__editor/scene?id=${encodeURIComponent(id)}`);
  if (!response.ok) return null;
  const payload = (await response.json()) as { document?: unknown };
  return parseSceneDocument(payload.document);
}

export async function loadSceneDocument(id: string): Promise<SceneDocument | null> {
  try {
    if (AUTHORING_ENABLED) {
      const fresh = await loadFromEditorApi(id).catch(() => null);
      if (fresh) return fresh;
    }
    const load = sceneModules[modulePathForId(id)];
    return load ? parseSceneDocument(await load()) : null;
  } catch (error) {
    console.error(`ClaudeCitizen scene "${id}" failed to parse.`, error);
    return null;
  }
}

export async function listSceneDocuments(): Promise<Array<{ id: string; name: string }>> {
  if (AUTHORING_ENABLED) {
    try {
      const response = await fetch('/__editor/scenes');
      if (response.ok) {
        const payload = (await response.json()) as {
          scenes?: Array<{ id: string; name: string }>;
        };
        if (Array.isArray(payload.scenes)) return payload.scenes;
      }
    } catch {
      // Fall through to bundled scenes.
    }
  }

  const ids = Object.keys(sceneModules)
    .map((path) => path.replace('./data/', '').replace('.scene.json', ''))
    .sort();
  const documents = await Promise.all(ids.map((id) => loadSceneDocument(id)));
  return documents
    .filter((document): document is SceneDocument => document !== null)
    .map(({ id, name }) => ({ id, name }));
}
