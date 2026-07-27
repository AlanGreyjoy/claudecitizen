import {
  resolveMenuAdvanceSceneId,
  resolveSceneEntryFlow,
  resolveScenePlayConfig,
  type SceneEntryFlow,
} from '../world/scenes/scene-runtime';
import type { SceneDocument } from '../world/scenes/schema';
import type { SceneUiScreen } from '../world/prefabs/schema';
import type { SceneExitTarget } from '../game/station/scene-exit';
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

/**
 * Menu kinds often omit an explicit `ui-screen` when GameManager already owns
 * the handoff. Infer the surface from `scene.kind` so Title still shows Play.
 */
export function impliedUiScreensForScene(scene: SceneDocument): SceneUiScreen[] {
  const authored = resolveScenePlayConfig(scene).uiScreens.map((entry) => entry.screen);
  if (authored.length > 0) return authored;
  if (scene.kind === 'title') return ['title'];
  if (scene.kind === 'loading') return ['loading'];
  if (scene.kind === 'character-creator') return ['character-create'];
  return [];
}

/** Title Game Manager world knobs applied when the hab scene lacks its own. */
export function playOverridesFromEntryFlow(
  entryFlow: SceneEntryFlow | null,
): Parameters<typeof playWorldParamsFromScene>[1] {
  if (!entryFlow) return {};
  return {
    ...(entryFlow.planetId ? { planetId: entryFlow.planetId } : {}),
    ...(entryFlow.systemId ? { systemId: entryFlow.systemId } : {}),
    spawnSurface: entryFlow.spawn === 'surface',
  };
}

/**
 * After Title auth: character-create scene when needed, else starting hab,
 * else scene-link / resume deep-link.
 */
export async function resolvePostAuthSceneId(options: {
  scene: SceneDocument;
  entryFlow: SceneEntryFlow | null;
  resumeSceneId?: string | null;
}): Promise<string | null> {
  if (options.resumeSceneId) return options.resumeSceneId;
  const flow = options.entryFlow ?? resolveSceneEntryFlow(options.scene);
  if (flow?.characterCreateSceneId || flow?.startingSceneId) {
    try {
      const bootstrap = await fetchGameBootstrap();
      if (!bootstrap.player.characterAppearance && flow.characterCreateSceneId) {
        return flow.characterCreateSceneId;
      }
      if (flow.startingSceneId) return flow.startingSceneId;
    } catch (error) {
      console.warn('AsteronEngine could not load citizen record for entry flow.', error);
      if (flow.startingSceneId) return flow.startingSceneId;
    }
  }
  return resolveMenuAdvanceSceneId(options.scene);
}

export async function mountSceneUiScreens(options: {
  screens: SceneUiScreen[];
  scene: SceneDocument;
  disposed: () => boolean;
  setLoading: (handle: LoadingScreenHandle | null) => void;
  loadScene: (sceneId: string, session?: AuthSession | null) => Promise<void>;
  startGameplay: (scene: SceneDocument, session: AuthSession | null) => Promise<void>;
  entryFlow: SceneEntryFlow | null;
  getEntryFlow: () => SceneEntryFlow | null;
  /**
   * Gameplay scene a deep link asked for before sign-in. Signing in returns
   * there instead of following this scene's authored link, so the URL the
   * player opened is the one they end up in.
   */
  resumeSceneId?: string | null;
  onResumeConsumed?: () => void;
}): Promise<void> {
  const advanceFromCreate = (): void => {
    const flow = options.getEntryFlow();
    const target =
      options.resumeSceneId
      ?? flow?.startingSceneId
      ?? resolveMenuAdvanceSceneId(options.scene);
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
          void (async () => {
            if (options.resumeSceneId) {
              const target = options.resumeSceneId;
              options.onResumeConsumed?.();
              await options.loadScene(target, session);
              return;
            }
            options.setLoading(showLoadingScreen());
            try {
              const target = await resolvePostAuthSceneId({
                scene: options.scene,
                entryFlow: options.getEntryFlow() ?? options.entryFlow,
              });
              if (target) {
                await options.loadScene(target, session);
                return;
              }
              await options.startGameplay(options.scene, session);
            } finally {
              options.setLoading(null);
            }
          })();
        },
      });
      continue;
    }
    if (screen === 'character-create') {
      const appearance = await showCharacterCreationScreen();
      if (appearance) advanceFromCreate();
      continue;
    }
    // `menu` screens are authored documents previewed by the Menu Manager;
    // in play they are opened by gameplay, not mounted by the scene itself.
  }
}

export type SceneBootstrapResult =
  | { status: 'ready'; bootstrap: GameBootstrap | null }
  | { status: 'redirect-character-create' }
  | { status: 'cancelled' };

/**
 * Signed-in players need a citizen record. When Game Manager names a create
 * scene and appearance is missing, redirect there instead of the inline UI.
 */
export async function resolveSceneBootstrap(
  requireAuth: boolean,
  session: AuthSession | null,
  screen: LoadingScreenHandle,
  entryFlow: SceneEntryFlow | null,
): Promise<SceneBootstrapResult> {
  if (!requireAuth || !session) return { status: 'ready', bootstrap: null };
  screen.setStatus('Loading citizen record...');
  const bootstrap = await fetchGameBootstrap();
  if (bootstrap.player.characterAppearance) {
    return { status: 'ready', bootstrap };
  }
  if (entryFlow?.characterCreateSceneId) {
    return { status: 'redirect-character-create' };
  }

  screen.hide();
  const appearance = await showCharacterCreationScreen();
  if (!appearance) return { status: 'cancelled' };
  bootstrap.player.characterAppearance = appearance;
  return { status: 'ready', bootstrap };
}

export async function startSceneGameplay(options: {
  scene: SceneDocument;
  session: AuthSession | null;
  requireAuth: boolean;
  fromEditor: boolean;
  entryFlow: SceneEntryFlow | null;
  getLoading: () => LoadingScreenHandle | null;
  setLoading: (handle: LoadingScreenHandle | null) => void;
  onRedirectCharacterCreate: (session: AuthSession) => void;
  onRequestScene: (target: SceneExitTarget) => void;
  networkTarget?: SceneExitTarget | null;
}): Promise<void> {
  if (isPlaySessionRunning()) stopPlaySession({ restoreTitle: false });
  let screen = options.getLoading() ?? showLoadingScreen();
  options.setLoading(screen);
  try {
    const result = await resolveSceneBootstrap(
      options.requireAuth,
      options.session,
      screen,
      options.entryFlow,
    );
    if (result.status === 'redirect-character-create') {
      if (options.session) options.onRedirectCharacterCreate(options.session);
      return;
    }
    if (result.status === 'cancelled') {
      // Character creation was cancelled; hand control back to the entry scene.
      options.setLoading(null);
      showTitleScreen({
        onPlay: (next) => void startSceneGameplay({ ...options, session: next }),
      });
      return;
    }
    const bootstrap = result.bootstrap;
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
        ...playOverridesFromEntryFlow(options.entryFlow),
      }),
      onRequestScene: options.onRequestScene,
      networkTarget: options.networkTarget ?? null,
    });
  } finally {
    options.setLoading(null);
  }
}
