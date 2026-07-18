import { showLoadingScreen } from './loading_screen';
import { restoreTitleScreen, showTitleScreen } from './title_screen';
import { startPlaySession } from './play_session';
import { fetchGameBootstrap, type AuthSession } from '../net/api';
import { showCharacterCreationScreen } from './character_creation_screen';
import { mountPlayChromeIcons } from '../ui/icons';

/**
 * Boot dispatcher.
 *
 * Default: title screen with Play. Dev builds also expose Editor (editor chunk
 * is only reachable behind import.meta.env.DEV).
 *
 * Deep links skip the title:
 *   ?boot=play              — jump into the game
 *   ?boot=play&planetId=&spawn=surface — offline planet surface playtest
 *   ?boot=play&systemId=    — load a System Map document (default `default`)
 *   ?boot=editor            — jump into the editor (dev only)
 *   ?boot=editor&tab=planet&planetId= — Planet Authoring tab
 *   ?boot=editor&tab=system&systemId= — System Map tab
 *   ?boot=editor&tab=menu — Menu Manager (HaloBand / play menu preview)
 *   ?boot=editor&tab=menu&menu=haloband — open a specific menu id
 *   ?stationPrefab=<id>     — jump into the game previewing a station prefab
 *   ?shipPrefab=<id>        — jump into the ship sandbox for a ship prefab (dev only)
 *   ?boot=sidekickPreview   — Sidekick modular character preview (dev only)
 *   ?boot=characterCreator  — Player character creation UI preview (dev only)
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

export function bootstrap(): void {
  mountPlayChromeIcons();

  const params = new URLSearchParams(window.location.search);
  const boot = params.get('boot');

  const openEditor = (): void => {
    if (!import.meta.env.DEV) return;
    import('../editor/editor_session')
      .then((module) => module.startEditorSession())
      .catch((error) => console.error('ClaudeCitizen editor failed to load.', error));
  };
  const openTitleScreen = (): void => showTitleScreen({
    onPlay: (session) => startPlayWithLoading({ requireAuth: true, session }),
    onEditor: import.meta.env.DEV ? openEditor : undefined,
  });

  if (boot === 'admin') {
    import('./admin_screen')
      .then((module) => module.showAdminScreen())
      .catch((error) => console.error('ClaudeCitizen admin screen failed to load.', error));
    return;
  }

  if (boot === 'editor' && import.meta.env.DEV) {
    openEditor();
    return;
  }
  const shipPrefabId = params.get('shipPrefab');
  if (shipPrefabId && import.meta.env.DEV) {
    import('./ship_play_session')
      .then((module) => module.startShipPlaySession(shipPrefabId))
      .catch((error) => console.error('ClaudeCitizen ship sandbox failed to load.', error));
    return;
  }
  if (boot === 'sidekickPreview' && import.meta.env.DEV) {
    import('./sidekick_preview_session')
      .then((module) => module.startSidekickPreviewSession())
      .catch((error) => console.error('ClaudeCitizen Sidekick preview failed to load.', error));
    return;
  }
  if (boot === 'characterCreator' && import.meta.env.DEV) {
    void showCharacterCreationScreen().then(() => {
      window.history.replaceState({}, '', window.location.pathname);
      openTitleScreen();
    });
    return;
  }
  if ((boot === 'play' || params.has('stationPrefab')) && import.meta.env.DEV) {
    startPlayWithLoading({ requireAuth: false });
    return;
  }

  openTitleScreen();
}
