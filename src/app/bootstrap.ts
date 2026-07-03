import { showLoadingScreen } from './loading_screen';
import { showTitleScreen } from './title_screen';
import { startPlaySession } from './play_session';

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
function startPlayWithLoading(): void {
  const loading = showLoadingScreen();
  void startPlaySession(loading);
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
  if (boot === 'play' || params.has('stationPrefab')) {
    startPlayWithLoading();
    return;
  }

  showTitleScreen({
    onPlay: startPlayWithLoading,
    onEditor: import.meta.env.DEV ? openEditor : undefined,
  });
}
