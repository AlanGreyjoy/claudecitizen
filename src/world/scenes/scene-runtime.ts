import type { PrefabComponent, PrefabDocument, PrefabEntity } from '../prefabs/schema';
import { loadPrefabDocument } from '../prefabs/loader';
import type { SceneDocument, SceneSettings } from './schema';

export interface ScenePlayConfig {
  systemId: string;
  planetId: string;
  spawn: 'station' | 'surface';
  /** First authoritative station prefab instance in the scene, if any. */
  stationPrefabId: string | null;
  /** First ship prefab instance in the scene, if any. */
  shipPrefabId: string | null;
  /** All prefab-instance references in document order. */
  prefabInstances: Array<{
    entityId: string;
    prefabId: string;
    prefabKind?: 'station' | 'ship' | 'site' | 'prop' | 'item';
    transform: PrefabEntity['transform'];
  }>;
}

function walkEntities(
  entities: PrefabEntity[],
  visit: (entity: PrefabEntity) => void,
): void {
  for (const entity of entities) {
    visit(entity);
    if (entity.children?.length) walkEntities(entity.children, visit);
  }
}

function findComponent<T extends PrefabComponent['type']>(
  entity: PrefabEntity,
  type: T,
): Extract<PrefabComponent, { type: T }> | null {
  for (const component of entity.components ?? []) {
    if (component.type === type) {
      return component as Extract<PrefabComponent, { type: T }>;
    }
  }
  return null;
}

/**
 * Resolve Unity-style scene GameObject components into play config.
 * Falls back to SceneDocument.settings when components are absent (v1 migration).
 */
export function resolveScenePlayConfig(scene: SceneDocument): ScenePlayConfig {
  const settings: SceneSettings = scene.settings;
  let systemId = settings.systemId;
  let planetId = settings.planetId;
  let spawn = settings.spawn;
  let stationPrefabId: string | null = settings.prefabKind === 'station'
    ? (settings.prefabId ?? null)
    : null;
  let shipPrefabId: string | null = settings.prefabKind === 'ship'
    ? (settings.prefabId ?? null)
    : null;
  const prefabInstances: ScenePlayConfig['prefabInstances'] = [];

  walkEntities(scene.gameObjects ?? [], (entity) => {
    const gameManager = findComponent(entity, 'game-manager');
    if (gameManager) {
      systemId = gameManager.systemId;
      planetId = gameManager.planetId;
      spawn = gameManager.spawn;
    }
    const planet = findComponent(entity, 'planet');
    if (planet) {
      planetId = planet.planetId;
    }
    const playerStart = findComponent(entity, 'player-start');
    if (playerStart) {
      spawn = playerStart.spawn;
    }
    const instance = findComponent(entity, 'prefab-instance');
    if (instance) {
      prefabInstances.push({
        entityId: entity.id,
        prefabId: instance.prefabId,
        prefabKind: instance.prefabKind,
        transform: entity.transform,
      });
      if (
        !stationPrefabId
        && (instance.prefabKind === 'station' || instance.prefabKind === undefined)
      ) {
        stationPrefabId = instance.prefabId;
      }
      if (!shipPrefabId && instance.prefabKind === 'ship') {
        shipPrefabId = instance.prefabId;
      }
    }
  });

  return {
    systemId,
    planetId,
    spawn,
    stationPrefabId,
    shipPrefabId,
    prefabInstances,
  };
}

/**
 * Load the first station prefab instance referenced by the scene (authoritative
 * walkable station for Phase 4 — one station per scene).
 */
export async function loadSceneStationPrefab(
  scene: SceneDocument,
): Promise<PrefabDocument | null> {
  const config = resolveScenePlayConfig(scene);
  if (!config.stationPrefabId) return null;
  return loadPrefabDocument(config.stationPrefabId);
}

/**
 * Resolve all prefab-instance documents in the scene (for render / Phase 5).
 */
export async function loadScenePrefabInstances(
  scene: SceneDocument,
): Promise<Array<{ entityId: string; prefab: PrefabDocument; transform: PrefabEntity['transform'] }>> {
  const config = resolveScenePlayConfig(scene);
  const out: Array<{
    entityId: string;
    prefab: PrefabDocument;
    transform: PrefabEntity['transform'];
  }> = [];
  for (const entry of config.prefabInstances) {
    const prefab = await loadPrefabDocument(entry.prefabId);
    if (!prefab) {
      console.warn(`Scene prefab-instance "${entry.prefabId}" not found; skipping.`);
      continue;
    }
    out.push({
      entityId: entry.entityId,
      prefab,
      transform: entry.transform,
    });
  }
  return out;
}
