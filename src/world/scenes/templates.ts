import type { PrefabEntity, PrefabTransform } from '../prefabs/schema';
import {
  SCENE_SCHEMA_VERSION,
  type SceneDocument,
  type SceneKind,
  type SceneRuntime,
} from './schema';

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

export const SCENE_TEMPLATE_IDS = [
  'empty',
  'boot',
  'gameplay',
  'ui-screen',
  'station',
  'hangar',
] as const;

export type SceneTemplateId = (typeof SCENE_TEMPLATE_IDS)[number];

export interface SceneTemplate {
  id: SceneTemplateId;
  label: string;
  description: string;
  /** Scene `kind` a document built from this template starts with. */
  kind: SceneKind;
  /** Scene `runtime` a document built from this template starts with. */
  runtime: SceneRuntime;
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
    runtime: 'open-space',
    gameObjects: () => [],
  },
  {
    id: 'boot',
    label: 'Boot',
    description:
      'The game entry point: Game Manager owns the flow (Title, Character Create, Starting Scene, Open Space), plus Planet and Player Start as the world defaults it hands down.',
    kind: 'boot',
    runtime: 'flow',
    gameObjects: () => [
      sceneObject('game-manager', 'Game Manager', [
        {
          type: 'game-manager',
          systemId: 'default',
          planetId: 'asteron',
          spawn: 'station',
          titleSceneId: 'title',
        },
      ]),
      sceneObject('planet', 'Planet', [{ type: 'planet', planetId: 'asteron' }]),
      sceneObject('player-start', 'Player Start', [{ type: 'player-start', spawn: 'station' }]),
    ],
  },
  {
    id: 'gameplay',
    label: 'Gameplay',
    description: 'Game Manager, Planet and Player Start — playable immediately.',
    kind: 'main-game',
    runtime: 'open-space',
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
    runtime: 'flow',
    gameObjects: () => [
      sceneObject('ui-screen', 'UI Screen', [{ type: 'ui-screen', screen: 'login' }]),
      sceneObject('next-scene', 'Next Scene', [{ type: 'scene-link', sceneId: '' }]),
    ],
  },
  {
    id: 'station',
    label: 'Station Body',
    description:
      'A giant-prefab station placed into Open Space by the System Map: the bay mouth pose ships fly out to, and the volume they fly through to reach the hangar.',
    kind: 'instance',
    runtime: 'station',
    gameObjects: () => [
      sceneObject('spawn-point', 'Spawn Point', [
        { type: 'spawn-point', floorId: 'lobby' },
      ]),
      sceneObject('bay-mouth', 'Bay Mouth', [{ type: 'hangar-open-space-exit' }]),
      sceneObject('enter-station', 'Enter Station', [{ type: 'enter-station' }]),
    ],
  },
  {
    id: 'hangar',
    label: 'Hangar',
    description:
      'A per-player hangar cell: pads for the parked hull, and the Exit Hangar volume that launches back to Open Space at the owning station body.',
    kind: 'instance',
    runtime: 'hangar',
    gameObjects: () => [
      sceneObject('instanced-scene', 'Instanced Scene', [
        { type: 'instanced-scene', scope: 'player' },
      ]),
      sceneObject('spawn-point', 'Spawn Point', [
        { type: 'spawn-point', floorId: 'hangar' },
      ]),
      sceneObject('hangar-pad', 'Hangar Pad', [
        { type: 'hangar-pad', hangarId: 'bay-1', padIndex: 1, floorId: 'hangar' },
      ]),
      sceneObject('exit-hangar', 'Exit Hangar', [{ type: 'exit-hangar' }]),
    ],
  },
];

export function findSceneTemplate(id: SceneTemplateId): SceneTemplate {
  // Fall back to `empty` by name, not by index: template order is a UI concern
  // and reordering the list must not silently change what an unknown id builds.
  return (
    SCENE_TEMPLATES.find((template) => template.id === id)
    ?? SCENE_TEMPLATES.find((template) => template.id === 'empty')
    ?? SCENE_TEMPLATES[0]
  );
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
    runtime: template.runtime,
    gameObjects: template.gameObjects(),
  };
}
