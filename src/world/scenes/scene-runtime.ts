import type {
  PrefabComponent,
  PrefabEntity,
  SceneInstanceScope,
  SceneUiScreen,
} from '../prefabs/schema';
import type { SceneDocument } from './schema';
import { sceneHasStationContent } from './scene-station';

/**
 * What a scene's GameObjects actually ask the runtime to boot.
 *
 * Play used to start the same monolithic world for every gameplay scene, so an
 * interior scene still paid for planet streaming and a default player ship it
 * never referenced. These flags let `play-session` boot only the subsystems the
 * author placed in the scene.
 */
export interface ScenePlayContent {
  /** Scene names a planet (`game-manager` / `planet`) or spawns on the surface. */
  planet: boolean;
  /** Scene places a ship prefab instance. */
  ship: boolean;
  /** Scene authors a station: inline geometry/markers or a placed prefab. */
  station: boolean;
}

export interface ScenePlayConfig {
  /** Null when the scene never authored a `game-manager`. */
  systemId: string | null;
  /** Null when the scene authored neither `game-manager` nor `planet`. */
  planetId: string | null;
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
  /** Subsystems the scene's GameObjects actually reference. */
  content: ScenePlayContent;
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
  let systemId: string | null = null;
  let planetId: string | null = null;
  let spawn: ScenePlayConfig['spawn'] = 'station';
  let stationPrefabId: string | null = null;
  let shipPrefabId: string | null = null;
  let instanceScope: SceneInstanceScope | null = null;
  // Naming a planet or spawning on the surface is what makes a scene need the
  // terrain stack; placing a station in orbit on its own does not.
  let requiresPlanet = false;
  const prefabInstances: ScenePlayConfig['prefabInstances'] = [];
  const uiScreens: ScenePlayConfig['uiScreens'] = [];
  const sceneLinks: ScenePlayConfig['sceneLinks'] = [];

  walkEntities(scene.gameObjects ?? [], (entity) => {
    const gameManager = findComponent(entity, 'game-manager');
    if (gameManager) {
      systemId = gameManager.systemId;
      planetId = gameManager.planetId;
      spawn = gameManager.spawn;
      requiresPlanet = true;
    }
    const planet = findComponent(entity, 'planet');
    if (planet) {
      planetId = planet.planetId;
      requiresPlanet = true;
    }
    const playerStart = findComponent(entity, 'player-start');
    if (playerStart) {
      spawn = playerStart.spawn;
      if (playerStart.spawn === 'surface') requiresPlanet = true;
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
    content: {
      planet: requiresPlanet,
      ship: shipPrefabId !== null,
      // A scene can author its station inline (GLB GameObjects, colliders,
      // spawn point) instead of placing a station prefab.
      station: stationPrefabId !== null || sceneHasStationContent(scene),
    },
  };
}
