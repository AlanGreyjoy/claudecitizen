import type {
  PrefabComponent,
  PrefabDocument,
  PrefabEntity,
  SceneInstanceScope,
  SceneUiScreen,
} from '../prefabs/schema';
import { loadPrefabDocument } from '../prefabs/loader';
import type { SceneDocument } from './schema';

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
  /** UI surfaces the scene mounts, in document order. */
  uiScreens: Array<{ screen: SceneUiScreen; menuId?: string }>;
  /** Scene transitions authored on this scene's GameObjects. */
  sceneLinks: Array<{
    entityId: string;
    sceneId: string;
    auto: boolean;
    delaySeconds: number;
  }>;
  /** Set when the scene is per-player instanced content (hab, hangar). */
  instanceScope: SceneInstanceScope | null;
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

/** Resolve Unity-style scene GameObject components into play config. */
export function resolveScenePlayConfig(scene: SceneDocument): ScenePlayConfig {
  let systemId = 'default';
  let planetId = 'asteron';
  let spawn: ScenePlayConfig['spawn'] = 'station';
  let stationPrefabId: string | null = null;
  let shipPrefabId: string | null = null;
  let instanceScope: SceneInstanceScope | null = null;
  const prefabInstances: ScenePlayConfig['prefabInstances'] = [];
  const uiScreens: ScenePlayConfig['uiScreens'] = [];
  const sceneLinks: ScenePlayConfig['sceneLinks'] = [];

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
    const uiScreen = findComponent(entity, 'ui-screen');
    if (uiScreen) {
      uiScreens.push({
        screen: uiScreen.screen,
        ...(uiScreen.menuId ? { menuId: uiScreen.menuId } : {}),
      });
    }
    const sceneLink = findComponent(entity, 'scene-link');
    // An unset target is a placeholder the author has not filled in yet.
    if (sceneLink?.sceneId) {
      sceneLinks.push({
        entityId: entity.id,
        sceneId: sceneLink.sceneId,
        auto: sceneLink.auto === true,
        delaySeconds: sceneLink.delaySeconds ?? 0,
      });
    }
    const instanced = findComponent(entity, 'instanced-scene');
    if (instanced) instanceScope = instanced.scope;
  });

  return {
    systemId,
    planetId,
    spawn,
    stationPrefabId,
    shipPrefabId,
    prefabInstances,
    uiScreens,
    sceneLinks,
    instanceScope,
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
