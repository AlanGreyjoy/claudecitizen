import type { PrefabEntity, PrefabTransform } from '../prefabs/schema';
import { parsePrefabEntity } from '../prefabs/schema';

function identityTransform(): PrefabTransform {
  return {
    position: { x: 0, y: 0, z: 0 },
    rotation: { x: 0, y: 0, z: 0, w: 1 },
    scale: { x: 1, y: 1, z: 1 },
  };
}

export const SCENE_SCHEMA_VERSION = 3 as const;
export const SCENE_ID_PATTERN = /^[a-z0-9][a-z0-9-]{0,63}$/;

/** Versions accepted on read and migrated forward to the current version. */
const MIGRATABLE_VERSIONS = new Set([1, 2, SCENE_SCHEMA_VERSION]);

export const SCENE_KINDS = [
  'title',
  'boot',
  'loading',
  'character-creator',
  'main-game',
  'instance',
  'prefab-stage',
] as const;

export type SceneKind = (typeof SCENE_KINDS)[number];
export type SceneSpawnMode = 'station' | 'surface';
export type ScenePrefabKind = 'station' | 'ship';

/**
 * A scene is a launchable project document. Its GameObject tree owns everything
 * the runtime needs: `game-manager` for system/planet/spawn, `planet` for the
 * planet document, `player-start` for the spawn pose, `prefab-instance` for
 * placed content, and `ui-screen` / `scene-link` for menu flow.
 *
 * `kind: 'boot'` is the entry document: it never runs gameplay. Its
 * `game-manager` names every hop (Title, Character Create, Starting Hab, Open
 * Space, Loading) and the scene host follows that authored pipeline, so the
 * order of the menu flow is a project decision rather than an engine constant.
 */
export interface SceneDocument {
  schemaVersion: typeof SCENE_SCHEMA_VERSION;
  id: string;
  name: string;
  kind: SceneKind;
  gameObjects: PrefabEntity[];
}

function readSlug(value: unknown, fallback = ''): string {
  return typeof value === 'string' && SCENE_ID_PATTERN.test(value.trim())
    ? value.trim()
    : fallback;
}

function readRecord(value: unknown): Record<string, unknown> | null {
  return value && typeof value === 'object' && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : null;
}

function readSceneKind(value: unknown): SceneKind | null {
  return SCENE_KINDS.includes(value as SceneKind) ? (value as SceneKind) : null;
}

function readGameObjects(value: unknown): PrefabEntity[] {
  if (!Array.isArray(value)) return [];
  const out: PrefabEntity[] = [];
  for (let i = 0; i < value.length; i += 1) {
    try {
      out.push(parsePrefabEntity(value[i], `$.gameObjects[${i}]`));
    } catch (error) {
      console.warn(`Scene gameObject[${i}] failed to parse and was skipped.`, error);
    }
  }
  return out;
}

function sceneObject(
  id: string,
  name: string,
  components: PrefabEntity['components'],
): PrefabEntity {
  return { id, name, transform: identityTransform(), components };
}

/**
 * Pre-v3 scenes stored startup config in a `settings` object. Rebuild that as
 * the GameObjects the runtime now reads so old documents keep launching.
 */
function migrateLegacySettings(raw: Record<string, unknown>): PrefabEntity[] {
  const settings = readRecord(raw.settings) ?? {};
  const systemId = readSlug(settings.systemId, 'default');
  const planetId = readSlug(settings.planetId, 'asteron');
  const spawn: SceneSpawnMode = settings.spawn === 'surface' ? 'surface' : 'station';
  const prefabId = readSlug(settings.prefabId);
  const prefabKind: ScenePrefabKind | undefined =
    settings.prefabKind === 'ship' || settings.prefabKind === 'station'
      ? settings.prefabKind
      : undefined;

  const objects: PrefabEntity[] = [
    sceneObject('game-manager', 'Game Manager', [
      { type: 'game-manager', systemId, planetId, spawn },
    ]),
    sceneObject('planet', 'Planet', [{ type: 'planet', planetId }]),
    sceneObject('player-start', 'Player Start', [{ type: 'player-start', spawn }]),
  ];
  if (prefabId) {
    objects.push(
      sceneObject(`prefab-${prefabId}`, prefabId, [
        { type: 'prefab-instance', prefabId, ...(prefabKind ? { prefabKind } : {}) },
      ]),
    );
  }
  return objects;
}

export function parseSceneDocument(raw: unknown): SceneDocument | null {
  const source = readRecord(raw);
  if (!source) return null;

  const version = source.schemaVersion;
  if (typeof version !== 'number' || !MIGRATABLE_VERSIONS.has(version)) return null;

  const id = readSlug(source.id);
  const name = typeof source.name === 'string' ? source.name.trim() : '';
  const kind = readSceneKind(source.kind);
  if (!id || !name || !kind) return null;

  const parsed = readGameObjects(source.gameObjects);
  // Legacy documents either had no GameObjects at all (v1) or kept authoritative
  // config in `settings` alongside them (v2).
  const gameObjects =
    version === SCENE_SCHEMA_VERSION || parsed.length > 0
      ? parsed
      : migrateLegacySettings(source);

  return {
    schemaVersion: SCENE_SCHEMA_VERSION,
    id,
    name,
    kind,
    gameObjects,
  };
}
