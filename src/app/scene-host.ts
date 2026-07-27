import { loadSceneDocument } from '../world/scenes/loader';
import type { SceneExitTarget } from '../game/station/scene-exit';
import {
  resolveSceneEntryFlow,
  resolveScenePlayConfig,
  type SceneEntryFlow,
} from '../world/scenes/scene-runtime';
import type { SceneDocument } from '../world/scenes/schema';
import type { AuthSession } from '../net/api';
import { getSession } from '../net/api';
import { runtimeConfig } from '../net/runtime-config';
import type { LoadingScreenHandle } from './loading-screen';
import {
  isPlaySessionRunning,
  setPlaySessionPaused,
  stopPlaySession,
} from './play-session';
import {
  impliedUiScreensForScene,
  mountSceneUiScreens,
  startSceneGameplay,
} from './scene-host-helpers';

/**
 * Scene host — the runtime counterpart to a scene document.
 *
 * Scenes own their content, so switching scenes happens in-process here rather
 * than by reloading the page with new URL params. A scene either mounts UI
 * surfaces (`ui-screen`) or starts 3D play from its GameObjects, and
 * `scene-link` / Game Manager entry fields drive the transitions between them.
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

interface SceneHostState {
  options: SceneHostOptions;
  getEntryFlow: () => SceneEntryFlow | null;
  setEntryFlow: (flow: SceneEntryFlow | null) => void;
  getLoading: () => LoadingScreenHandle | null;
  setLoading: (handle: LoadingScreenHandle | null) => void;
  getResumeSceneId: () => string | null;
  setResumeSceneId: (id: string | null) => void;
  isDisposed: () => boolean;
  loadScene: (
    sceneId: string,
    session?: AuthSession | null,
    networkTarget?: SceneExitTarget | null,
  ) => Promise<void>;
  scheduleAutoLinks: (scene: SceneDocument) => void;
}

async function startHostGameplay(
  state: SceneHostState,
  scene: SceneDocument,
  session: AuthSession | null,
  networkTarget: SceneExitTarget | null = null,
): Promise<void> {
  const requireAuth = state.options.requireAuth ?? false;
  await startSceneGameplay({
    scene,
    session,
    requireAuth,
    fromEditor: state.options.fromEditor ?? false,
    entryFlow: state.getEntryFlow(),
    getLoading: state.getLoading,
    setLoading: state.setLoading,
    onRedirectCharacterCreate: (authSession) => {
      const createId = state.getEntryFlow()?.characterCreateSceneId;
      if (createId) void state.loadScene(createId, authSession);
    },
    // A scene-exit carries the destination cell with it. Passing it through
    // the swap is what keeps the scene the player sees and the cell they are
    // simulated in from disagreeing.
    onRequestScene: (target) => {
      void (async () => {
        const resolved = session ?? (requireAuth ? await getSession() : null);
        await state.loadScene(target.sceneId, resolved, target);
      })();
    },
    networkTarget,
  });
}

async function enterGameplayScene(
  state: SceneHostState,
  scene: SceneDocument,
  session?: AuthSession | null,
  networkTarget: SceneExitTarget | null = null,
): Promise<void> {
  const requireAuth = state.options.requireAuth ?? false;
  const resolved = session ?? (requireAuth ? await getSession() : null);
  if (requireAuth && !resolved) {
    // Deep link into gameplay before sign-in: park the target and open boot/title.
    state.setResumeSceneId(scene.id);
    state.getLoading()?.hide();
    state.setLoading(null);
    await state.loadScene(runtimeConfig().bootScene || 'title');
    return;
  }
  await startHostGameplay(state, scene, resolved, networkTarget);
  state.scheduleAutoLinks(scene);
}

export function createSceneHost(options: SceneHostOptions): SceneHostHandle {
  let activeScene: SceneDocument | null = null;
  let paused = false;
  let disposed = false;
  let pendingTransition = 0;
  let loading: LoadingScreenHandle | null = null;
  let resumeSceneId: string | null = null;
  let entryFlow: SceneEntryFlow | null = null;

  function clearPendingTransition(): void {
    if (!pendingTransition) return;
    window.clearTimeout(pendingTransition);
    pendingTransition = 0;
  }

  const state: SceneHostState = {
    options,
    getEntryFlow: () => entryFlow,
    setEntryFlow: (flow) => { entryFlow = flow; },
    getLoading: () => loading,
    setLoading: (handle) => { loading = handle; },
    getResumeSceneId: () => resumeSceneId,
    setResumeSceneId: (id) => { resumeSceneId = id; },
    isDisposed: () => disposed,
    loadScene: async () => {},
    scheduleAutoLinks: () => {},
  };

  state.scheduleAutoLinks = (scene: SceneDocument): void => {
    const autoLink = resolveScenePlayConfig(scene).sceneLinks.find((link) => link.auto);
    if (!autoLink) return;
    pendingTransition = window.setTimeout(
      () => {
        pendingTransition = 0;
        void state.loadScene(autoLink.sceneId);
      },
      Math.max(0, autoLink.delaySeconds) * 1000,
    );
  };

  async function enterScene(
    scene: SceneDocument,
    session?: AuthSession | null,
    networkTarget: SceneExitTarget | null = null,
  ): Promise<void> {
    if (disposed) return;
    clearPendingTransition();
    activeScene = scene;
    const nextFlow = resolveSceneEntryFlow(scene);
    if (nextFlow) entryFlow = nextFlow;

    if (GAMEPLAY_KINDS.has(scene.kind)) {
      await enterGameplayScene(state, scene, session, networkTarget);
      return;
    }

    await mountSceneUiScreens({
      screens: impliedUiScreensForScene(scene),
      scene,
      disposed: () => disposed,
      setLoading: (handle) => { loading = handle; },
      loadScene: state.loadScene,
      startGameplay: (next, auth) => startHostGameplay(state, next, auth),
      entryFlow,
      getEntryFlow: () => entryFlow,
      resumeSceneId,
      onResumeConsumed: () => { resumeSceneId = null; },
    });
    state.scheduleAutoLinks(scene);
  }

  state.loadScene = async (sceneId, session, networkTarget) => {
    const scene = await loadSceneDocument(sceneId);
    if (!scene) {
      console.error(`AsteronEngine scene "${sceneId}" was not found or is invalid.`);
      return;
    }
    await enterScene(scene, session, networkTarget);
  };

  function reportBootFailure(error: unknown): void {
    console.error('AsteronEngine scene host failed to start.', error);
    loading?.setStatus('Could not start this scene. Check the console.');
  }

  if (options.initialScene) void enterScene(options.initialScene).catch(reportBootFailure);
  else if (options.initialSceneId) void state.loadScene(options.initialSceneId).catch(reportBootFailure);
  else console.error('Scene host needs initialScene or initialSceneId.');

  return {
    loadScene: (sceneId) => state.loadScene(sceneId),
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
      entryFlow = null;
    },
  };
}
