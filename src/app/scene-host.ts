import { loadSceneDocument } from '../world/scenes/loader';
import { resolveScenePlayConfig } from '../world/scenes/scene-runtime';
import type { SceneDocument } from '../world/scenes/schema';
import type { AuthSession } from '../net/api';
import { getSession } from '../net/api';
import type { LoadingScreenHandle } from './loading-screen';
import {
  isPlaySessionRunning,
  setPlaySessionPaused,
  stopPlaySession,
} from './play-session';
import {
  mountSceneUiScreens,
  startSceneGameplay,
} from './scene-host-helpers';

/**
 * Scene host — the runtime counterpart to a scene document.
 *
 * Scenes own their content, so switching scenes happens in-process here rather
 * than by reloading the page with new URL params. A scene either mounts UI
 * surfaces (`ui-screen`) or starts 3D play from its GameObjects, and
 * `scene-link` components drive the transitions between them.
 */
export interface SceneHostOptions {
  /** Scene loaded first, by project id. */
  initialSceneId?: string;
  /**
   * Scene loaded first, already in memory. The editor uses this to play the
   * open document including unsaved edits.
   */
  initialScene?: SceneDocument;
  /** Require a signed-in player before gameplay scenes start. */
  requireAuth?: boolean;
  /** Marks play as editor-driven (enables the in-play debug affordances). */
  fromEditor?: boolean;
}

export interface SceneHostHandle {
  loadScene: (sceneId: string) => Promise<void>;
  getActiveScene: () => SceneDocument | null;
  setPaused: (paused: boolean) => void;
  isPaused: () => boolean;
  dispose: () => void;
}

const GAMEPLAY_KINDS = new Set(['main-game', 'instance', 'prefab-stage']);

export function createSceneHost(options: SceneHostOptions): SceneHostHandle {
  let activeScene: SceneDocument | null = null;
  let paused = false;
  let disposed = false;
  let pendingTransition = 0;
  let loading: LoadingScreenHandle | null = null;

  function clearPendingTransition(): void {
    if (!pendingTransition) return;
    window.clearTimeout(pendingTransition);
    pendingTransition = 0;
  }

  function scheduleAutoLinks(scene: SceneDocument): void {
    const autoLink = resolveScenePlayConfig(scene).sceneLinks.find((link) => link.auto);
    if (!autoLink) return;
    pendingTransition = window.setTimeout(
      () => {
        pendingTransition = 0;
        void loadScene(autoLink.sceneId);
      },
      Math.max(0, autoLink.delaySeconds) * 1000,
    );
  }

  async function startGameplay(
    scene: SceneDocument,
    session: AuthSession | null,
  ): Promise<void> {
    await startSceneGameplay({
      scene,
      session,
      requireAuth: options.requireAuth ?? false,
      fromEditor: options.fromEditor ?? false,
      getLoading: () => loading,
      setLoading: (handle) => { loading = handle; },
    });
  }

  async function loadScene(sceneId: string, session?: AuthSession | null): Promise<void> {
    const scene = await loadSceneDocument(sceneId);
    if (!scene) {
      console.error(`AsteronEngine scene "${sceneId}" was not found or is invalid.`);
      return;
    }
    await enterScene(scene, session);
  }

  async function enterScene(
    scene: SceneDocument,
    session?: AuthSession | null,
  ): Promise<void> {
    if (disposed) return;
    clearPendingTransition();
    activeScene = scene;

    const config = resolveScenePlayConfig(scene);
    const screens = config.uiScreens.map((entry) => entry.screen);

    if (GAMEPLAY_KINDS.has(scene.kind)) {
      const resolved = session ?? (options.requireAuth ? await getSession() : null);
      await startGameplay(scene, resolved);
      scheduleAutoLinks(scene);
      return;
    }

    await mountSceneUiScreens({
      screens,
      scene,
      disposed: () => disposed,
      setLoading: (handle) => { loading = handle; },
      loadScene,
      startGameplay,
    });
    scheduleAutoLinks(scene);
  }

  if (options.initialScene) void enterScene(options.initialScene);
  else if (options.initialSceneId) void loadScene(options.initialSceneId);
  else console.error('Scene host needs initialScene or initialSceneId.');

  return {
    loadScene: (sceneId) => loadScene(sceneId),
    getActiveScene: () => activeScene,
    setPaused(next) {
      paused = next;
      setPlaySessionPaused(next);
    },
    isPaused: () => paused,
    dispose() {
      disposed = true;
      clearPendingTransition();
      loading?.hide();
      loading = null;
      if (isPlaySessionRunning()) stopPlaySession({ restoreTitle: false });
      activeScene = null;
    },
  };
}
