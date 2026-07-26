import { loadPrefabDocument } from '../prefabs/loader';
import type { PrefabDocument } from '../prefabs/schema';
import { loadSceneDocument } from '../scenes/loader';
import { buildSceneStationDocument } from '../scenes/scene-station';
import type { SystemStationEntry } from './schema';

/**
 * Loads the geometry a system-map station entry points at. Prefab-backed and
 * scene-backed stations both resolve to a `PrefabDocument`, so orbital
 * rendering and walk layouts stay on one code path.
 */
export async function loadStationEntryDocument(
  entry: SystemStationEntry,
): Promise<PrefabDocument | null> {
  if (entry.sceneId) {
    const scene = await loadSceneDocument(entry.sceneId);
    if (!scene) {
      console.warn(`Station scene "${entry.sceneId}" not found; skipping.`);
      return null;
    }
    const document = await buildSceneStationDocument(scene);
    if (!document) {
      console.warn(`Station scene "${entry.sceneId}" authors no station content; skipping.`);
    }
    return document;
  }
  if (!entry.stationPrefabId) return null;
  return loadPrefabDocument(entry.stationPrefabId);
}
