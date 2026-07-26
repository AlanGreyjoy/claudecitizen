import { startShipSandboxSession } from '../app/ship-play-session';
import type { EditorStore } from './document';
import { createEditorPlayHost } from './play-host';
import { startEditorPlay, type EditorPlaySession } from './play-in-editor';
import { toPrefabDocument } from './serialize';
import type { ShipTestEnv } from './react/panels/ship/types';

/**
 * Starts the ship playtest for the open ship prefab.
 *
 * Both environments hand back the same `EditorPlaySession`, so Play / Pause /
 * Stop, F6, and tab switching drive them identically:
 *
 * - `pad`    — the isolated sandbox: fast boot, no terrain, deck + flight only.
 * - `planet` — the full stage scene, spawning on foot beside the parked hull.
 */
export function startShipTest(store: EditorStore, env: ShipTestEnv): EditorPlaySession {
  if (env === 'planet') return startEditorPlay(store, { shipSpawn: 'surface' });

  const state = store.getState();
  const document = toPrefabDocument(state);
  const host = createEditorPlayHost();

  let stopped = false;
  let sandbox: Awaited<ReturnType<typeof startShipSandboxSession>> | null = null;
  let paused = false;

  const stop = (): void => {
    if (stopped) return;
    stopped = true;
    sandbox?.stop();
    sandbox = null;
    host.dispose();
  };

  // The sandbox boots async (prefab layout, colliders, character settings). A
  // Stop that lands mid-boot must still tear the session down once it arrives.
  void startShipSandboxSession({
    prefabId: document.id,
    document,
    onExit: stop,
  })
    .then((session) => {
      if (stopped) {
        session.stop();
        return;
      }
      sandbox = session;
      session.setPaused(paused);
    })
    .catch((error: unknown) => {
      console.error('Ship pad test failed to start.', error);
      stop();
    });

  return {
    setPaused(next) {
      paused = next;
      sandbox?.setPaused(next);
      host.setPaused(next);
    },
    isPaused: () => paused,
    stop,
  };
}
