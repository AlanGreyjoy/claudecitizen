import type { PrefabEntity } from '../prefabs/schema';
import { parsePrefabEntity } from '../prefabs/schema';

export const SCENE_SCHEMA_VERSION = 2 as const;
export const SCENE_SCHEMA_VERSION_V1 = 1 as const;
export const SCENE_ID_PATTERN = /^[a-z0-9][a-z0-9-]{0,63}$/;

export const SCENE_KINDS = [
  'title',
  'loading',
  'character-creator',
  'main-game',
  'instance',
  'prefab-stage',
  'sidekick-preview',
] as const;

export type SceneKind = (typeof SCENE_KINDS)[number];
export type SceneSpawnMode = 'station' | 'surface';
export type ScenePrefabKind = 'station' | 'ship';

export interface SceneSettings {
  systemId: string;
  planetId: string;
  spawn: SceneSpawnMode;
  prefabId?: string;
  prefabKind?: ScenePrefabKind;
}

/**
 * A scene is a launchable project document. It owns a GameObject tree
 * (`gameObjects`) plus startup settings (kept during migration until
 * GameManager / Planet / PlayerStart components fully own config).
 */
export interface SceneDocument {
  schemaVersion: typeof SCENE_SCHEMA_VERSION;
  id: string;
  name: string;
  kind: SceneKind;
  settings: SceneSettings;
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

function readSceneSettings(value: unknown): SceneSettings {
  const source = readRecord(value) ?? {};
  const prefabKind =
    source.prefabKind === 'ship' || source.prefabKind === 'station'
      ? source.prefabKind
      : undefined;
  return {
    systemId: readSlug(source.systemId, 'default'),
    planetId: readSlug(source.planetId, 'asteron'),
    spawn: source.spawn === 'surface' ? 'surface' : 'station',
    ...(readSlug(source.prefabId) ? { prefabId: readSlug(source.prefabId) } : {}),
    ...(prefabKind ? { prefabKind } : {}),
  };
}

function readGameObjects(value: unknown): PrefabEntity[] {
  if (value === undefined) return [];
  if (!Array.isArray(value)) return [];
  const out: PrefabEntity[] = [];
  for (let i = 0; i < value.length; i += 1) {
    try {
      out.push(parsePrefabEntity(value[i], `$.gameObjects[${i}]`));
    } catch (error) {
      console.warn(
        `Scene gameObject[${i}] failed to parse and was skipped.`,
        error,
      );
    }
  }
  return out;
}

export function parseSceneDocument(raw: unknown): SceneDocument | null {
  const source = readRecord(raw);
  if (!source) return null;

  const version = source.schemaVersion;
  if (version !== SCENE_SCHEMA_VERSION && version !== SCENE_SCHEMA_VERSION_V1) {
    return null;
  }

  const id = readSlug(source.id);
  const name = typeof source.name === 'string' ? source.name.trim() : '';
  const kind = readSceneKind(source.kind);
  if (!id || !name || !kind) return null;

  const settings = readSceneSettings(source.settings);
  if (
    (kind === 'prefab-stage' || kind === 'instance')
    && (!settings.prefabId || !settings.prefabKind)
  ) {
    return null;
  }

  const gameObjects =
    version === SCENE_SCHEMA_VERSION_V1 ? [] : readGameObjects(source.gameObjects);

  return {
    schemaVersion: SCENE_SCHEMA_VERSION,
    id,
    name,
    kind,
    settings,
    gameObjects,
  };
}

export function createDefaultSceneDocument(
  id = 'new-scene',
  name = 'New Scene',
): SceneDocument {
  return {
    schemaVersion: SCENE_SCHEMA_VERSION,
    id,
    name,
    kind: 'main-game',
    settings: {
      systemId: 'default',
      planetId: 'asteron',
      spawn: 'station',
    },
    gameObjects: [],
  };
}
