export interface TitleScreenOptions {
  onPlay: () => void;
  /** Editor entry — only provided in dev builds; button stays hidden otherwise. */
  onEditor?: () => void;
}

function requireElement<T extends HTMLElement>(id: string): T {
  const element = document.getElementById(id);
  if (!element) throw new Error(`Missing required element #${id}`);
  return element as T;
}

export function showTitleScreen(options: TitleScreenOptions): void {
  const screen = requireElement<HTMLElement>('title-screen');
  const playBtn = requireElement<HTMLButtonElement>('title-play-btn');
  const editorBtn = requireElement<HTMLButtonElement>('title-editor-btn');
  const editorHint = document.getElementById('title-editor-hint');

  screen.classList.remove('is-hidden');

  playBtn.addEventListener(
    'click',
    () => {
      screen.classList.add('is-hidden');
      options.onPlay();
    },
    { once: true },
  );

  if (options.onEditor) {
    const onEditor = options.onEditor;
    editorBtn.classList.remove('is-hidden');
    editorHint?.classList.remove('is-hidden');
    editorBtn.addEventListener(
      'click',
      () => {
        screen.classList.add('is-hidden');
        onEditor();
      },
      { once: true },
    );
  }
}
