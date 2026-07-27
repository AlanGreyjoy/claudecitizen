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
  /**
   * Character-creator scene when the signed-in player has no appearance.
   * Null when unset — callers may use the inline create gate.
   */
  characterCreateSceneId: string | null;
  /**
   * Hab / gameplay scene `game-manager` sends the player to after a menu
   * surface (Title Play). Null when unset — callers fall back to `scene-link`.
   */
  startingSceneId: string | null;
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

interface ScenePlayAccum {
  systemId: string | null;
  planetId: string | null;
  spawn: ScenePlayConfig['spawn'];
  characterCreateSceneId: string | null;
  startingSceneId: string | null;
  stationPrefabId: string | null;
  shipPrefabId: string | null;
  instanceScope: SceneInstanceScope | null;
  requiresPlanet: boolean;
  prefabInstances: ScenePlayConfig['prefabInstances'];
  uiScreens: ScenePlayConfig['uiScreens'];
  sceneLinks: ScenePlayConfig['sceneLinks'];
}

function collectGameManagerFields(
  entity: PrefabEntity,
  out: ScenePlayAccum,
): void {
  const gameManager = findComponent(entity, 'game-manager');
  if (!gameManager) return;
  out.systemId = gameManager.systemId;
  out.planetId = gameManager.planetId;
  out.spawn = gameManager.spawn;
  if (gameManager.characterCreateSceneId) {
    out.characterCreateSceneId = gameManager.characterCreateSceneId;
  }
  if (gameManager.startingSceneId) out.startingSceneId = gameManager.startingSceneId;
  out.requiresPlanet = true;
}

function collectPrefabInstanceFields(
  entity: PrefabEntity,
  out: ScenePlayAccum,
): void {
  const instance = findComponent(entity, 'prefab-instance');
  if (!instance) return;
  out.prefabInstances.push({
    entityId: entity.id,
    prefabId: instance.prefabId,
    prefabKind: instance.prefabKind,
    transform: entity.transform,
  });
  if (
    !out.stationPrefabId
    && (instance.prefabKind === 'station' || instance.prefabKind === undefined)
  ) {
    out.stationPrefabId = instance.prefabId;
  }
  if (!out.shipPrefabId && instance.prefabKind === 'ship') {
    out.shipPrefabId = instance.prefabId;
  }
}

function collectScenePlayEntity(entity: PrefabEntity, out: ScenePlayAccum): void {
  collectGameManagerFields(entity, out);
  const planet = findComponent(entity, 'planet');
  if (planet) {
    out.planetId = planet.planetId;
    out.requiresPlanet = true;
  }
  const playerStart = findComponent(entity, 'player-start');
  if (playerStart) {
    out.spawn = playerStart.spawn;
    if (playerStart.spawn === 'surface') out.requiresPlanet = true;
  }
  collectPrefabInstanceFields(entity, out);
  const uiScreen = findComponent(entity, 'ui-screen');
  if (uiScreen) {
    out.uiScreens.push({
      screen: uiScreen.screen,
      ...(uiScreen.menuId ? { menuId: uiScreen.menuId } : {}),
    });
  }
  const sceneLink = findComponent(entity, 'scene-link');
  // An unset target is a placeholder the author has not filled in yet.
  if (sceneLink?.sceneId) {
    out.sceneLinks.push({
      entityId: entity.id,
      sceneId: sceneLink.sceneId,
      auto: sceneLink.auto === true,
      delaySeconds: sceneLink.delaySeconds ?? 0,
    });
  }
  const instanced = findComponent(entity, 'instanced-scene');
  if (instanced) out.instanceScope = instanced.scope;
}

/** Resolve Unity-style scene GameObject components into play config. */
export function resolveScenePlayConfig(scene: SceneDocument): ScenePlayConfig {
  const out: ScenePlayAccum = {
    systemId: null,
    planetId: null,
    spawn: 'station',
    characterCreateSceneId: null,
    startingSceneId: null,
    stationPrefabId: null,
    shipPrefabId: null,
    instanceScope: null,
    // Naming a planet or spawning on the surface is what makes a scene need the
    // terrain stack; placing a station in orbit on its own does not.
    requiresPlanet: false,
    prefabInstances: [],
    uiScreens: [],
    sceneLinks: [],
  };

  walkEntities(scene.gameObjects ?? [], (entity) => collectScenePlayEntity(entity, out));

  return {
    systemId: out.systemId,
    planetId: out.planetId,
    spawn: out.spawn,
    characterCreateSceneId: out.characterCreateSceneId,
    startingSceneId: out.startingSceneId,
    stationPrefabId: out.stationPrefabId,
    shipPrefabId: out.shipPrefabId,
    prefabInstances: out.prefabInstances,
    uiScreens: out.uiScreens,
    sceneLinks: out.sceneLinks,
    instanceScope: out.instanceScope,
    content: {
      planet: out.requiresPlanet,
      ship: out.shipPrefabId !== null,
      // A scene can author its station inline (GLB GameObjects, colliders,
      // spawn point) instead of placing a station prefab.
      station: out.stationPrefabId !== null || sceneHasStationContent(scene),
    },
  };
}

/** Entry hop targets + world knobs carried from Title's `game-manager`. */
export interface SceneEntryFlow {
  characterCreateSceneId: string | null;
  startingSceneId: string | null;
  systemId: string | null;
  planetId: string | null;
  spawn: 'station' | 'surface';
}

/** Snapshot Game Manager entry fields when the scene authors any of them. */
export function resolveSceneEntryFlow(scene: SceneDocument): SceneEntryFlow | null {
  const config = resolveScenePlayConfig(scene);
  if (!config.characterCreateSceneId && !config.startingSceneId) return null;
  return {
    characterCreateSceneId: config.characterCreateSceneId,
    startingSceneId: config.startingSceneId,
    systemId: config.systemId,
    planetId: config.planetId,
    spawn: config.spawn,
  };
}

/**
 * Next scene after a menu surface. `game-manager.startingSceneId` wins so Title
 * can pick a starting hab without also authoring a `scene-link`.
 */
export function resolveMenuAdvanceSceneId(scene: SceneDocument): string | null {
  const config = resolveScenePlayConfig(scene);
  if (config.startingSceneId) return config.startingSceneId;
  return config.sceneLinks.find((link) => !link.auto)?.sceneId ?? null;
}
