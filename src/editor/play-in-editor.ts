import { createSceneHost, type SceneHostHandle } from '../app/scene-host';
import { mountPlayChrome, unmountPlayChrome } from '../app/play-chrome';
import type { SceneDocument } from '../world/scenes/schema';
import { SCENE_SCHEMA_VERSION } from '../world/scenes/schema';
import type { EditorStore } from './document';
import { toSceneDocument } from './serialize';

const PLAY_HOST_ID = 'editor-play-host';

export interface EditorPlaySession {
  setPaused: (paused: boolean) => void;
  isPaused: () => boolean;
  stop: () => void;
}

/**
 * Wraps the open prefab in a throwaway scene so prefabs are playable without
 * authoring a scene for each one.
 */
function prefabStageScene(store: EditorStore): SceneDocument {
  const state = store.getState();
  const prefabId = state.prefabId || 'untitled';
  return {
    schemaVersion: SCENE_SCHEMA_VERSION,
    id: `${prefabId}-stage`,
    name: `${state.prefabName} (Stage)`,
    kind: 'prefab-stage',
    gameObjects: [
      {
        id: 'game-manager',
        name: 'Game Manager',
        transform: {
          position: { x: 0, y: 0, z: 0 },
          rotation: { x: 0, y: 0, z: 0, w: 1 },
          scale: { x: 1, y: 1, z: 1 },
        },
        components: [
          {
            type: 'game-manager',
            systemId: 'default',
            planetId: 'asteron',
            spawn: 'station',
          },
          {
            type: 'prefab-instance',
            prefabId,
            prefabKind: state.kind === 'ship' ? 'ship' : 'station',
          },
        ],
      },
    ],
  };
}

/**
 * Unity-style Play: run the document that is open in the editor, unsaved edits
 * included, inside a Game host layered over the editor workspace.
 *
 * The host carries a CSS transform so the HUD's fixed-position elements are
 * contained by the Game region instead of escaping to the whole window.
 */
export function startEditorPlay(store: EditorStore): EditorPlaySession {
  const state = store.getState();
  const scene =
    state.documentType === 'scene' ? toSceneDocument(state) : prefabStageScene(store);

  const host = document.createElement('div');
  host.id = PLAY_HOST_ID;
  document.body.append(host);

  const chrome = mountPlayChrome(host);
  chrome.classList.remove('is-hidden');

  document.getElementById('editor-root')?.classList.add('is-playing');

  let sceneHost: SceneHostHandle | null = createSceneHost({
    initialScene: scene,
    requireAuth: false,
    fromEditor: true,
  });
  let paused = false;

  return {
    setPaused(next) {
      paused = next;
      sceneHost?.setPaused(next);
      host.classList.toggle('is-paused', next);
    },
    isPaused: () => paused,
    stop() {
      sceneHost?.dispose();
      sceneHost = null;
      unmountPlayChrome();
      host.remove();
      document.getElementById('editor-root')?.classList.remove('is-playing');
    },
  };
}
