import { showLoadingScreen } from './loading_screen';
import { showTitleScreen } from './title_screen';
import { startPlaySession } from './play_session';
import type { AuthSession } from '../net/api';

/**
 * Boot dispatcher.
 *
 * Default: title screen with Play. Dev builds also expose Editor (editor chunk
 * is only reachable behind import.meta.env.DEV).
 *
 * Deep links skip the title:
 *   ?boot=play              — jump into the game
 *   ?boot=editor            — jump into the editor (dev only)
 *   ?stationPrefab=<id>     — jump into the game previewing a station prefab
 *   ?shipPrefab=<id>        — jump into the ship sandbox for a ship prefab (dev only)
 */
function startPlayWithLoading(options: { requireAuth: boolean; session?: AuthSession | null }): void {
  const loading = showLoadingScreen();
  void startPlaySession(loading, options).catch((error) => {
    console.error('ClaudeCitizen play session failed to start.', error);
    loading.hide();
    document.getElementById('title-screen')?.classList.remove('is-hidden');
  });
}

export function bootstrap(): void {
  const params = new URLSearchParams(window.location.search);
  const boot = params.get('boot');

  const openEditor = (): void => {
    if (!import.meta.env.DEV) return;
    import('../editor/editor_session')
      .then((module) => module.startEditorSession())
      .catch((error) => console.error('ClaudeCitizen editor failed to load.', error));
  };

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
  if ((boot === 'play' || params.has('stationPrefab')) && import.meta.env.DEV) {
    startPlayWithLoading({ requireAuth: false });
    return;
  }

  showTitleScreen({
    onPlay: (session) => startPlayWithLoading({ requireAuth: true, session }),
    onEditor: import.meta.env.DEV ? openEditor : undefined,
  });
}
