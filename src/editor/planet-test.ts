import { createSceneHost, type SceneHostHandle } from '../app/scene-host';
import { mountPlayChrome, unmountPlayChrome } from '../app/play-chrome';
import type { PrefabComponent } from '../world/prefabs/schema';
import { SCENE_SCHEMA_VERSION, type SceneDocument } from '../world/scenes/schema';
import { createEditorPlayHost } from './play-host';
import type { EditorPlaySession } from './play-in-editor';

/**
 * Throwaway scene that boots surface play for one planet document — same
 * outcome as the old `?boot=play&spawn=surface` URL, but inside the editor
 * Game host so Play / Pause / Stop stay reachable.
 */
function planetSurfaceStageScene(planetId: string): SceneDocument {
  const components: PrefabComponent[] = [
    {
      type: 'game-manager',
      systemId: 'default',
      planetId,
      spawn: 'surface',
      requireAuth: false,
    },
    { type: 'player-start', spawn: 'surface' },
    { type: 'planet', planetId },
  ];
  return {
    schemaVersion: SCENE_SCHEMA_VERSION,
    id: `${planetId}-surface-stage`,
    name: `${planetId} (Surface Test)`,
    kind: 'prefab-stage',
    gameObjects: [
      {
        id: 'planet-surface-stage-root',
        name: planetId,
        transform: {
          position: { x: 0, y: 0, z: 0 },
          rotation: { x: 0, y: 0, z: 0, w: 1 },
          scale: { x: 1, y: 1, z: 1 },
        },
        components,
      },
    ],
  };
}

/** In-editor planet surface playtest (Planet Authoring → Test Play / F6). */
export function startPlanetSurfaceTest(planetId: string): EditorPlaySession {
  const host = createEditorPlayHost();
  mountPlayChrome(host.element).classList.remove('is-hidden');

  let sceneHost: SceneHostHandle | null = createSceneHost({
    initialScene: planetSurfaceStageScene(planetId),
    requireAuth: false,
    fromEditor: true,
  });
  let paused = false;

  return {
    setPaused(next) {
      paused = next;
      sceneHost?.setPaused(next);
      host.setPaused(next);
    },
    isPaused: () => paused,
    stop() {
      sceneHost?.dispose();
      sceneHost = null;
      unmountPlayChrome();
      host.dispose();
    },
  };
}
