import { showLoadingScreen } from './loading_screen';
import { restoreTitleScreen, showTitleScreen } from './title_screen';
import { startPlaySession } from './play_session';
import { fetchGameBootstrap, type AuthSession } from '../net/api';
import { showCharacterCreationScreen } from './character_creation_screen';
import { mountPlayChromeIcons } from '../ui/icons';
import { AUTHORING_ENABLED } from '../build_mode';
import { sceneLaunchSearch } from './scene_launch';
import { loadSceneDocument } from '../world/scenes/loader';

/**
 * Boot dispatcher.
 *
 * Default: title screen with Play. Development and the dedicated Electron
 * editor build expose the authoring routes.
 *
 * Deep links skip the title:
 *   ?boot=play              — jump into the game
 *   ?boot=play&planetId=&spawn=surface — offline planet surface playtest
 *   ?boot=play&systemId=    — load a System Map document (default `default`)
 *   ?boot=projects          — AsteronEngine Projects hub (authoring builds only)
 *   ?boot=editor            — jump into the editor (authoring builds only)
 *   ?boot=editor&tab=planet&planetId= — Planet Authoring tab
 *   ?boot=editor&tab=system&systemId= — System Map tab
 *   ?boot=editor&tab=menu — Menu Manager (HaloBand / play menu preview)
 *   ?boot=editor&tab=menu&menu=haloband — open a specific menu id
 *   ?stationPrefab=<id>     — jump into the game previewing a station prefab
 *   ?shipPrefab=<id>        — jump into the ship sandbox (authoring builds only)
 *   ?boot=sidekickPreview   — Sidekick preview (authoring builds only)
 *   ?boot=characterCreator  — Character creator preview (authoring builds only)
 *   ?boot=scene&sceneId=    — resolve and launch a scene document
 */
function startPlayWithLoading(options: { requireAuth: boolean; session?: AuthSession | null }): void {
  const loading = showLoadingScreen();
  let activeLoading = loading;
  const start = async (): Promise<void> => {
    if (!options.requireAuth) {
      await startPlaySession(loading, options);
      return;
    }
    const session = options.session;
    if (!session) {
      await startPlaySession(loading, options);
      return;
    }
    loading.setStatus('Loading citizen record...');
    const gameBootstrap = await fetchGameBootstrap();
    if (!gameBootstrap.player.characterAppearance) {
      loading.hide();
      const appearance = await showCharacterCreationScreen();
      if (!appearance) {
        restoreTitleScreen(session);
        return;
      }
      gameBootstrap.player.characterAppearance = appearance;
      const resumedLoading = showLoadingScreen();
      activeLoading = resumedLoading;
      await startPlaySession(resumedLoading, {
        requireAuth: true,
        session,
        bootstrap: gameBootstrap,
      });
      return;
    }
    await startPlaySession(loading, {
      requireAuth: true,
      session,
      bootstrap: gameBootstrap,
    });
  };
  void start().catch((error) => {
    console.error('ClaudeCitizen play session failed to start.', error);
    activeLoading.hide();
    restoreTitleScreen(options.session);
  });
}

function launchSceneDocument(sceneId: string | null, onFailure: () => void): void {
  if (!sceneId) {
    console.error('Scene launch requires ?sceneId=<id>.');
    onFailure();
    return;
  }
  const loading = showLoadingScreen();
  loading.setStatus(`Loading scene "${sceneId}"...`);
  void loadSceneDocument(sceneId)
    .then((scene) => {
      if (!scene) throw new Error(`Scene "${sceneId}" was not found or is invalid.`);
      window.location.replace(sceneLaunchSearch(scene));
    })
    .catch((error) => {
      console.error('ClaudeCitizen scene failed to load.', error);
      loading.hide();
      onFailure();
    });
}

function showLoadingScene(sceneId: string | null): void {
  const loading = showLoadingScreen();
  loading.setStatus(`Loading ${sceneId ?? 'scene'}...`);
  loading.setProgress(0.42);
}

function openEditorSession(): void {
  if (!AUTHORING_ENABLED) return;
  import('../editor/editor_session')
    .then((module) => module.startEditorSession())
    .catch((error) => console.error('ClaudeCitizen editor failed to load.', error));
}

function openProjectsSession(): void {
  import('../editor/editor_session')
    .then((module) => module.startProjectsSession())
    .catch((error) => console.error('AsteronEngine Projects failed to load.', error));
}

/** Authoring / preview deep links. Returns true when a route was handled. */
function tryBootAuthoringRoute(
  params: URLSearchParams,
  boot: string | null,
  launchedScene: boolean,
  openTitleScreen: () => void,
): boolean {
  const allowPreview = AUTHORING_ENABLED || launchedScene;
  if (boot === 'projects' && AUTHORING_ENABLED) {
    openProjectsSession();
    return true;
  }
  if (boot === 'editor' && AUTHORING_ENABLED) {
    openEditorSession();
    return true;
  }
  const shipPrefabId = params.get('shipPrefab');
  if (shipPrefabId && allowPreview) {
    import('./ship_play_session')
      .then((module) => module.startShipPlaySession(shipPrefabId))
      .catch((error) => console.error('ClaudeCitizen ship sandbox failed to load.', error));
    return true;
  }
  if (boot === 'sidekickPreview' && allowPreview) {
    import('./sidekick_preview_session')
      .then((module) => module.startSidekickPreviewSession())
      .catch((error) => console.error('ClaudeCitizen Sidekick preview failed to load.', error));
    return true;
  }
  if (boot === 'characterCreator' && allowPreview) {
    void showCharacterCreationScreen().then(() => {
      window.history.replaceState({}, '', window.location.pathname);
      openTitleScreen();
    });
    return true;
  }
  if ((boot === 'play' || params.has('stationPrefab')) && allowPreview) {
    startPlayWithLoading({ requireAuth: false });
    return true;
  }
  return false;
}

export function bootstrap(): void {
  mountPlayChromeIcons();

  const params = new URLSearchParams(window.location.search);
  const boot = params.get('boot');
  const launchedScene = params.has('scene');
  const openTitleScreen = (): void => showTitleScreen({
    onPlay: (session) => startPlayWithLoading({ requireAuth: true, session }),
    onEditor: AUTHORING_ENABLED ? openEditorSession : undefined,
  });

  if (boot === 'scene') {
    launchSceneDocument(params.get('sceneId'), openTitleScreen);
    return;
  }
  if (boot === 'loadingPreview' && launchedScene) {
    showLoadingScene(params.get('scene'));
    return;
  }
  if (boot === 'admin') {
    import('./admin_screen')
      .then((module) => module.showAdminScreen())
      .catch((error) => console.error('ClaudeCitizen admin screen failed to load.', error));
    return;
  }
  if (tryBootAuthoringRoute(params, boot, launchedScene, openTitleScreen)) return;

  openTitleScreen();
}
