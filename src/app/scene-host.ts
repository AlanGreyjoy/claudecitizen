import { loadSceneDocument } from '../world/scenes/loader';
import type { SceneExitTarget } from '../game/station/scene-exit';
import {
  resolveSceneEntryFlow,
  resolveScenePlayConfig,
  type SceneEntryFlow,
} from '../world/scenes/scene-runtime';
import {
  bootReturnSceneId,
  resolveExitTargetScene,
  runBootScene,
} from './scene-flow';
import type { SceneDocument } from '../world/scenes/schema';
import type { SceneUiScreen } from '../world/prefabs/schema';
import type { AuthSession, SessionLostReason } from '../net/api';
import { getSession, setUnauthorizedHandler } from '../net/api';
import type { LoadingScreenHandle } from './loading-screen';
import {
  isPlaySessionRunning,
  setPlaySessionPaused,
  stopPlaySession,
} from './play-session';
import { restoreTitleScreen, setPendingLoginMessage } from './title-screen';
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
        // `@space` and friends are Game Manager hops, not documents; resolve
        // before the swap so a token never reaches the scene loader.
        const sceneId = resolveExitTargetScene(target, state.getEntryFlow());
        if (!sceneId) return;
        const resolved = session ?? (requireAuth ? await getSession() : null);
        await state.loadScene(sceneId, resolved, { ...target, sceneId });
      })();
    },
    onExitToTitle: () => {
      if (state.isDisposed()) return;
      // Tear down play without the orphan #title-screen HTML overlay, then
      // remount the entry surface so ui-screen / auth run again.
      stopPlaySession({ restoreTitle: false });
      state.setResumeSceneId(null);
      void state.loadScene(bootReturnSceneId(state.getEntryFlow()));
    },
    networkTarget,
  });
}

/**
 * Mounts a scene's UI surfaces (title / loading / character create).
 *
 * The boot driver passes an explicit surface: a boot scene implies none of its
 * own, so hosting the title inline is a decision the flow makes, not the kind.
 */
async function mountEntrySurfaces(
  state: SceneHostState,
  scene: SceneDocument,
  screens: SceneUiScreen[] = impliedUiScreensForScene(scene),
): Promise<void> {
  await mountSceneUiScreens({
    screens,
    scene,
    disposed: state.isDisposed,
    setLoading: state.setLoading,
    loadScene: state.loadScene,
    startGameplay: (next, auth) => startHostGameplay(state, next, auth),
    entryFlow: state.getEntryFlow(),
    getEntryFlow: state.getEntryFlow,
    resumeSceneId: state.getResumeSceneId(),
    onResumeConsumed: () => state.setResumeSceneId(null),
  });
}

/** Runs the authored pipeline on a `boot` scene. Never starts gameplay. */
async function enterBootScene(
  state: SceneHostState,
  scene: SceneDocument,
  flow: SceneEntryFlow,
): Promise<void> {
  await runBootScene({
    scene,
    flow,
    loadScene: state.loadScene,
    mountEntryUi: (next, screen) => mountEntrySurfaces(state, next, [screen]),
    resumeSceneId: state.getResumeSceneId(),
    onResumeConsumed: () => state.setResumeSceneId(null),
    disposed: state.isDisposed,
  });
}

async function enterGameplayScene(
  state: SceneHostState,
  scene: SceneDocument,
  session?: AuthSession | null,
  networkTarget: SceneExitTarget | null = null,
): Promise<void> {
  const requireAuth = state.options.requireAuth ?? false;
  const fromEditor = state.options.fromEditor ?? false;
  // Editor Play is offline-capable, but reuse a live cookie session when one
  // already exists so habs can still resolve apartment bootstrap without a
  // forced login gate.
  const resolved =
    session
    ?? (requireAuth || fromEditor ? await getSession() : null);
  if (requireAuth && !resolved) {
    // Deep link into gameplay before sign-in: park the target and open the
    // entry surface the flow named.
    state.setResumeSceneId(scene.id);
    state.getLoading()?.hide();
    state.setLoading(null);
    await state.loadScene(bootReturnSceneId(state.getEntryFlow()));
    return;
  }
  await startHostGameplay(state, scene, resolved, networkTarget);
  state.scheduleAutoLinks(scene);
}

function sessionLostLoginMessage(reason: SessionLostReason): string {
  return reason === 'unavailable'
    ? 'Server unavailable. Please sign in again when it is back.'
    : 'Session expired. Please sign in again.';
}

function returnToBootOnSessionLost(options: {
  disposed: () => boolean;
  clearPendingTransition: () => void;
  getLoading: () => LoadingScreenHandle | null;
  setLoading: (handle: LoadingScreenHandle | null) => void;
  getActiveScene: () => SceneDocument | null;
  getEntryFlow: () => SceneEntryFlow | null;
  loadScene: (sceneId: string) => Promise<void>;
  reason: SessionLostReason;
}): void {
  if (options.disposed()) return;
  options.clearPendingTransition();
  if (isPlaySessionRunning()) stopPlaySession({ restoreTitle: false });
  options.getLoading()?.hide();
  options.setLoading(null);
  const bootSceneId = bootReturnSceneId(options.getEntryFlow());
  const message = sessionLostLoginMessage(options.reason);
  const active = options.getActiveScene();
  // Already on the entry surface: show login without remounting (avoids a
  // getSession↔reload loop).
  if (
    active?.id === bootSceneId
    || active?.kind === 'title'
    || active?.kind === 'boot'
  ) {
    restoreTitleScreen(null, message);
    return;
  }
  setPendingLoginMessage(message);
  void options.loadScene(bootSceneId);
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
    setLoading: (handle) => {
      // Dropping the handle must hide the overlay — callers that only null the
      // ref leave "Preparing Asteron..." covering the next UI (e.g. character create).
      if (!handle) loading?.hide();
      loading = handle;
    },
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

    // The boot scene is the authored pipeline, not a place: it resolves the
    // next hop and hands off, so it must be answered before the gameplay and
    // ui-screen branches ever see it.
    if (scene.kind === 'boot' && entryFlow) {
      await enterBootScene(state, scene, entryFlow);
      return;
    }

    if (GAMEPLAY_KINDS.has(scene.kind)) {
      await enterGameplayScene(state, scene, session, networkTarget);
      return;
    }

    await mountEntrySurfaces(state, scene);
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

  // Offline editor Play skips auth APIs; only wire the kick for real sessions.
  if (options.requireAuth) {
    setUnauthorizedHandler((reason) => {
      returnToBootOnSessionLost({
        disposed: () => disposed,
        clearPendingTransition,
        getLoading: state.getLoading,
        setLoading: state.setLoading,
        getActiveScene: () => activeScene,
        getEntryFlow: () => entryFlow,
        loadScene: (sceneId) => state.loadScene(sceneId),
        reason,
      });
    });
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
      if (options.requireAuth) setUnauthorizedHandler(null);
      if (isPlaySessionRunning()) stopPlaySession({ restoreTitle: false });
      activeScene = null;
      entryFlow = null;
    },
  };
}
