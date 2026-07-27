import { resolveScenePlayConfig } from '../world/scenes/scene-runtime';
import type { SceneDocument } from '../world/scenes/schema';
import type { SceneUiScreen } from '../world/prefabs/schema';
import {
  fetchGameBootstrap,
  type AuthSession,
  type GameBootstrap,
} from '../net/api';
import { showLoadingScreen, type LoadingScreenHandle } from './loading-screen';
import { showTitleScreen } from './title-screen';
import { showCharacterCreationScreen } from './character-creation-screen';
import {
  isPlaySessionRunning,
  startPlaySession,
  stopPlaySession,
} from './play-session';
import { playWorldParamsFromScene } from './play-session-world';

export async function mountSceneUiScreens(options: {
  screens: SceneUiScreen[];
  scene: SceneDocument;
  disposed: () => boolean;
  setLoading: (handle: LoadingScreenHandle | null) => void;
  loadScene: (sceneId: string, session?: AuthSession | null) => Promise<void>;
  startGameplay: (scene: SceneDocument, session: AuthSession | null) => Promise<void>;
  /**
   * Gameplay scene a deep link asked for before sign-in. Signing in returns
   * there instead of following this scene's authored link, so the URL the
   * player opened is the one they end up in.
   */
  resumeSceneId?: string | null;
  onResumeConsumed?: () => void;
}): Promise<void> {
  const next = resolveScenePlayConfig(options.scene).sceneLinks.find((link) => !link.auto);
  const advance = (): void => {
    const target = options.resumeSceneId ?? next?.sceneId;
    if (!target) return;
    if (options.resumeSceneId) options.onResumeConsumed?.();
    void options.loadScene(target);
  };

  for (const screen of options.screens) {
    if (options.disposed()) return;
    if (screen === 'loading') {
      options.setLoading(showLoadingScreen());
      continue;
    }
    if (screen === 'title' || screen === 'login') {
      showTitleScreen({
        onPlay: (session) => {
          const target = options.resumeSceneId ?? next?.sceneId;
          if (target) {
            if (options.resumeSceneId) options.onResumeConsumed?.();
            void options.loadScene(target, session);
            return;
          }
          void options.startGameplay(options.scene, session);
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
export async function resolveSceneBootstrap(
  requireAuth: boolean,
  session: AuthSession | null,
  screen: LoadingScreenHandle,
): Promise<GameBootstrap | null> {
  if (!requireAuth || !session) return null;
  screen.setStatus('Loading citizen record...');
  const bootstrap = await fetchGameBootstrap();
  if (bootstrap.player.characterAppearance) return bootstrap;

  screen.hide();
  const appearance = await showCharacterCreationScreen();
  if (!appearance) return null;
  bootstrap.player.characterAppearance = appearance;
  return bootstrap;
}

export async function startSceneGameplay(options: {
  scene: SceneDocument;
  session: AuthSession | null;
  requireAuth: boolean;
  fromEditor: boolean;
  getLoading: () => LoadingScreenHandle | null;
  setLoading: (handle: LoadingScreenHandle | null) => void;
}): Promise<void> {
  if (isPlaySessionRunning()) stopPlaySession({ restoreTitle: false });
  let screen = options.getLoading() ?? showLoadingScreen();
  options.setLoading(screen);
  try {
    const bootstrap = await resolveSceneBootstrap(
      options.requireAuth,
      options.session,
      screen,
    );
    if (options.requireAuth && options.session && !bootstrap) {
      // Character creation was cancelled; hand control back to the entry scene.
      options.setLoading(null);
      showTitleScreen({
        onPlay: (next) => void startSceneGameplay({ ...options, session: next }),
      });
      return;
    }
    if (bootstrap && !screen.isVisible()) {
      screen = showLoadingScreen();
      options.setLoading(screen);
    }
    await startPlaySession(screen, {
      requireAuth: options.requireAuth,
      session: options.session,
      ...(bootstrap ? { bootstrap } : {}),
      worldParams: playWorldParamsFromScene(options.scene, {
        fromEditor: options.fromEditor,
      }),
    });
  } finally {
    options.setLoading(null);
  }
}
