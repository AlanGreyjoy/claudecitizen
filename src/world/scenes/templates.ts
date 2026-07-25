import type { PrefabEntity, PrefabTransform } from '../prefabs/schema';
import { SCENE_SCHEMA_VERSION, type SceneDocument, type SceneKind } from './schema';

function identityTransform(): PrefabTransform {
  return {
    position: { x: 0, y: 0, z: 0 },
    rotation: { x: 0, y: 0, z: 0, w: 1 },
    scale: { x: 1, y: 1, z: 1 },
  };
}

function sceneObject(
  id: string,
  name: string,
  components: PrefabEntity['components'],
): PrefabEntity {
  return { id, name, transform: identityTransform(), components };
}

export const SCENE_TEMPLATE_IDS = ['empty', 'gameplay', 'ui-screen'] as const;

export type SceneTemplateId = (typeof SCENE_TEMPLATE_IDS)[number];

export interface SceneTemplate {
  id: SceneTemplateId;
  label: string;
  description: string;
  /** Scene `kind` a document built from this template starts with. */
  kind: SceneKind;
  gameObjects: () => PrefabEntity[];
}

/**
 * Scene starting points offered by File -> New Scene. `empty` is the default so
 * a scene never arrives with GameObjects the author did not ask for; `gameplay`
 * reproduces the playable planet/station setup that used to be forced on every
 * new scene.
 */
export const SCENE_TEMPLATES: readonly SceneTemplate[] = [
  {
    id: 'empty',
    label: 'Empty',
    description: 'No GameObjects. Build the scene from scratch.',
    kind: 'main-game',
    gameObjects: () => [],
  },
  {
    id: 'gameplay',
    label: 'Gameplay',
    description: 'Game Manager, Planet and Player Start — playable immediately.',
    kind: 'main-game',
    gameObjects: () => [
      sceneObject('game-manager', 'Game Manager', [
        { type: 'game-manager', systemId: 'default', planetId: 'asteron', spawn: 'station' },
      ]),
      sceneObject('planet', 'Planet', [{ type: 'planet', planetId: 'asteron' }]),
      sceneObject('player-start', 'Player Start', [{ type: 'player-start', spawn: 'station' }]),
    ],
  },
  {
    id: 'ui-screen',
    label: 'UI Screen',
    description: 'A menu surface such as login or title, plus its next-scene link.',
    kind: 'title',
    gameObjects: () => [
      sceneObject('ui-screen', 'UI Screen', [{ type: 'ui-screen', screen: 'login' }]),
      sceneObject('next-scene', 'Next Scene', [{ type: 'scene-link', sceneId: '' }]),
    ],
  },
];

export function findSceneTemplate(id: SceneTemplateId): SceneTemplate {
  return SCENE_TEMPLATES.find((template) => template.id === id) ?? SCENE_TEMPLATES[0];
}

export function createSceneDocumentFromTemplate(
  templateId: SceneTemplateId,
  id = 'new-scene',
  name = 'New Scene',
): SceneDocument {
  const template = findSceneTemplate(templateId);
  return {
    schemaVersion: SCENE_SCHEMA_VERSION,
    id,
    name,
    kind: template.kind,
    gameObjects: template.gameObjects(),
  };
}
