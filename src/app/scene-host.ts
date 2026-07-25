import { loadSceneDocument } from '../world/scenes/loader';
import { resolveScenePlayConfig } from '../world/scenes/scene-runtime';
import type { SceneDocument } from '../world/scenes/schema';
import type { SceneUiScreen } from '../world/prefabs/schema';
import {
  fetchGameBootstrap,
  getSession,
  type AuthSession,
  type GameBootstrap,
} from '../net/api';
import { showLoadingScreen, type LoadingScreenHandle } from './loading-screen';
import { showTitleScreen } from './title-screen';
import { showCharacterCreationScreen } from './character-creation-screen';
import {
  isPlaySessionRunning,
  setPlaySessionPaused,
  startPlaySession,
  stopPlaySession,
} from './play-session';
import { playWorldParamsFromScene } from './play-session-world';

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

  async function mountUiScreens(
    screens: SceneUiScreen[],
    scene: SceneDocument,
  ): Promise<void> {
    const next = resolveScenePlayConfig(scene).sceneLinks.find((link) => !link.auto);
    const advance = (): void => {
      if (next) void loadScene(next.sceneId);
    };

    for (const screen of screens) {
      if (disposed) return;
      if (screen === 'loading') {
        loading = showLoadingScreen();
        continue;
      }
      if (screen === 'title' || screen === 'login') {
        showTitleScreen({
          onPlay: (session) => {
            if (next) void loadScene(next.sceneId, session);
            else void startGameplay(scene, session);
          },
        });
        continue;
      }
      if (screen === 'character-create') {
        const appearance = await showCharacterCreationScreen();
        if (appearance) advance();
        continue;
      }
      // `menu` screens are authored documents previewed by the Menu Manager;
      // in play they are opened by gameplay, not mounted by the scene itself.
    }
  }

  /**
   * A signed-in player without a saved appearance has to build one before the
   * world loads. This is the only hard gate in the scene flow; everything else
   * is authored with `scene-link`.
   */
  async function resolveBootstrap(
    session: AuthSession | null,
    screen: LoadingScreenHandle,
  ): Promise<GameBootstrap | null> {
    if (!options.requireAuth || !session) return null;
    screen.setStatus('Loading citizen record...');
    const bootstrap = await fetchGameBootstrap();
    if (bootstrap.player.characterAppearance) return bootstrap;

    screen.hide();
    const appearance = await showCharacterCreationScreen();
    if (!appearance) return null;
    bootstrap.player.characterAppearance = appearance;
    return bootstrap;
  }

  async function startGameplay(
    scene: SceneDocument,
    session: AuthSession | null,
  ): Promise<void> {
    if (isPlaySessionRunning()) stopPlaySession({ restoreTitle: false });
    let screen = loading ?? showLoadingScreen();
    loading = screen;
    try {
      const bootstrap = await resolveBootstrap(session, screen);
      if (options.requireAuth && session && !bootstrap) {
        // Character creation was cancelled; hand control back to the entry scene.
        loading = null;
        showTitleScreen({ onPlay: (next) => void startGameplay(scene, next) });
        return;
      }
      if (bootstrap && !screen.isVisible()) {
        screen = showLoadingScreen();
        loading = screen;
      }
      await startPlaySession(screen, {
        requireAuth: options.requireAuth ?? false,
        session,
        ...(bootstrap ? { bootstrap } : {}),
        worldParams: playWorldParamsFromScene(scene, {
          fromEditor: options.fromEditor ?? false,
        }),
      });
    } finally {
      loading = null;
    }
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

    await mountUiScreens(screens, scene);
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
