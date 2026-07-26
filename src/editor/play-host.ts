const PLAY_HOST_ID = 'editor-play-host';

export interface EditorPlayHost {
  element: HTMLElement;
  setPaused: (paused: boolean) => void;
  dispose: () => void;
}

/**
 * The fixed overlay every in-editor playtest renders into. It carries a CSS
 * transform so the HUD's `position: fixed` elements are contained by the Game
 * region instead of escaping to the whole window, and it must outrank
 * `#editor-root` or Play renders under opaque chrome (blank screen, audio
 * still running).
 */
export function createEditorPlayHost(): EditorPlayHost {
  const element = document.createElement('div');
  element.id = PLAY_HOST_ID;
  document.body.append(element);
  document.getElementById('editor-root')?.classList.add('is-playing');

  return {
    element,
    setPaused: (paused) => element.classList.toggle('is-paused', paused),
    dispose: () => {
      element.remove();
      document.getElementById('editor-root')?.classList.remove('is-playing');
    },
  };
}
