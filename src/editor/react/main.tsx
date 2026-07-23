import { createRoot, type Root } from 'react-dom/client';
import { injectEditorStyles } from '../styles';
import { EditorApp } from './EditorApp';

let reactRoot: Root | null = null;
let mountGeneration = 0;

function prepareEditorDom(): HTMLElement {
  document.getElementById('title-screen')?.classList.add('is-hidden');
  document.getElementById('app')?.classList.add('is-hidden');
  injectEditorStyles();
  const root = document.getElementById('editor-root');
  if (!root) throw new Error('Missing #editor-root');
  root.classList.remove('is-hidden');
  return root;
}

/** Dev-only editor entry — React shell with Fast Refresh + soft remount. */
export function startEditorSession(): void {
  const host = prepareEditorDom();
  if (!reactRoot) {
    reactRoot = createRoot(host);
  }
  mountGeneration += 1;
  reactRoot.render(<EditorApp key={mountGeneration} />);
}

export function disposeEditorSession(): void {
  reactRoot?.unmount();
  reactRoot = null;
  const host = document.getElementById('editor-root');
  host?.replaceChildren();
  host?.classList.add('is-hidden');
}

if (import.meta.hot) {
  import.meta.hot.accept(() => {
    // Soft remount: EditorApp persists snapshot via hot.dispose / unmount cleanup.
    startEditorSession();
  });
}
