import { loadPrefabDocument } from '../prefabs/loader';
import type { PrefabDocument } from '../prefabs/schema';
import { hangarsFromPrefabDocument } from '../prefabs/station-runtime';
import { loadSceneDocument } from '../scenes/loader';
import { buildSceneStationDocument } from '../scenes/scene-station';
import type { HangarSpec } from '../station';
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

/**
 * Hangar pads authored on a hangar scene (or any station-content scene).
 * Does not touch the active walk layout — AVMS deliver reads family pads
 * while the player is still on the Station concourse.
 */
export async function loadHangarsFromSceneId(sceneId: string): Promise<HangarSpec[]> {
  const id = sceneId.trim();
  if (!id) return [];
  const scene = await loadSceneDocument(id);
  if (!scene) {
    console.warn(`Hangar scene "${id}" not found; no pads for AVMS deliver.`);
    return [];
  }
  const document = await buildSceneStationDocument(scene);
  if (!document) {
    console.warn(`Hangar scene "${id}" authors no station content; no pads.`);
    return [];
  }
  return hangarsFromPrefabDocument(document);
}
