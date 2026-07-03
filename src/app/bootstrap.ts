import { showTitleScreen } from './title_screen';
import { startPlaySession } from './play_session';

/**
 * Boot dispatcher.
 *
 * Production: straight into the game (no title screen, no editor code in the
 * bundle — the editor chunk is only reachable behind import.meta.env.DEV).
 *
 * Dev: title screen with Play + Editor. Deep links skip the title:
 *   ?boot=play              — jump into the game
 *   ?boot=editor            — jump into the editor
 *   ?stationPrefab=<id>     — jump into the game previewing a station prefab
 */
export function bootstrap(): void {
  if (!import.meta.env.DEV) {
    void startPlaySession();
    return;
  }

  const params = new URLSearchParams(window.location.search);
  const boot = params.get('boot');

  const openEditor = (): void => {
    import('../editor/editor_session')
      .then((module) => module.startEditorSession())
      .catch((error) => console.error('ClaudeCitizen editor failed to load.', error));
  };

  if (boot === 'editor') {
    openEditor();
    return;
  }
  if (boot === 'play' || params.has('stationPrefab')) {
    void startPlaySession();
    return;
  }

  showTitleScreen({
    onPlay: () => void startPlaySession(),
    onEditor: openEditor,
  });
}
