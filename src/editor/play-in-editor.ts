import { createSceneHost, type SceneHostHandle } from '../app/scene-host';
import { mountPlayChrome, unmountPlayChrome } from '../app/play-chrome';
import type { PrefabComponent } from '../world/prefabs/schema';
import type { SceneDocument } from '../world/scenes/schema';
import { SCENE_SCHEMA_VERSION } from '../world/scenes/schema';
import type { EditorStore } from './document';
import { createEditorPlayHost } from './play-host';
import { toSceneDocument } from './serialize';

export interface EditorPlaySession {
  setPaused: (paused: boolean) => void;
  isPaused: () => boolean;
  stop: () => void;
}

export interface EditorPlayOptions {
  /**
   * Where a ship stage drops the player. `surface` parks the hull at the
   * landing site and spawns the player on foot beside it — the ship playtest
   * loop (walk up the ramp, sit, fly). Stations ignore this.
   */
  shipSpawn?: 'station' | 'surface';
}

/**
 * Wraps the open prefab in a throwaway scene so prefabs are playable without
 * authoring a scene for each one.
 *
 * The stage declares the smallest world the prefab needs. A ship gets a
 * `game-manager` because it has to fly somewhere; a station interior does not,
 * and adding one used to make every station prefab Play boot the entire planet
 * stack it never referenced.
 */
function prefabStageScene(store: EditorStore, options: EditorPlayOptions): SceneDocument {
  const state = store.getState();
  const prefabId = state.prefabId || 'untitled';
  const isShip = state.kind === 'ship';
  const components: PrefabComponent[] = [
    { type: 'prefab-instance', prefabId, prefabKind: isShip ? 'ship' : 'station' },
  ];
  if (isShip) {
    const spawn = options.shipSpawn ?? 'station';
    // `player-start` is what `resolveScenePlayConfig` reads for the spawn mode;
    // the game-manager spawn field alone leaves a surface stage in the station.
    if (spawn === 'surface') components.unshift({ type: 'player-start', spawn });
    components.unshift({
      type: 'game-manager',
      systemId: 'default',
      planetId: 'asteron',
      spawn,
    });
  }
  return {
    schemaVersion: SCENE_SCHEMA_VERSION,
    id: `${prefabId}-stage`,
    name: `${state.prefabName} (Stage)`,
    kind: 'prefab-stage',
    gameObjects: [
      {
        id: 'prefab-stage-root',
        name: state.prefabName || prefabId,
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

/**
 * Unity-style Play: run the document that is open in the editor, unsaved edits
 * included, inside a Game host layered over the editor workspace.
 *
 * The host carries a CSS transform so the HUD's fixed-position elements are
 * contained by the Game region instead of escaping to the whole window.
 */
export function startEditorPlay(
  store: EditorStore,
  options: EditorPlayOptions = {},
): EditorPlaySession {
  const state = store.getState();
  const scene =
    state.documentType === 'scene'
      ? toSceneDocument(state)
      : prefabStageScene(store, options);

  const host = createEditorPlayHost();
  mountPlayChrome(host.element).classList.remove('is-hidden');

  let sceneHost: SceneHostHandle | null = createSceneHost({
    initialScene: scene,
    // Editor Play never blocks on login — same offline contract as Planet Test
    // Play. Player-scoped habs still run; apartment bootstrap is simply absent
    // until the editor already holds a session from elsewhere. Shipping auth
    // belongs to the boot/title flow, not F6.
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
