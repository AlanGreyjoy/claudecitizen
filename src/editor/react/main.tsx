import { createRoot, type Root } from 'react-dom/client';
import { injectEditorStyles } from '../styles';
import { EditorApp } from './EditorApp';
import { ProjectsApp } from './ProjectsApp';

let reactRoot: Root | null = null;
let mountGeneration = 0;
let activeSession: 'editor' | 'projects' | null = null;

function prepareEditorDom(): HTMLElement {
  document.getElementById('title-screen')?.classList.add('is-hidden');
  document.getElementById('app')?.classList.add('is-hidden');
  injectEditorStyles();
  const root = document.getElementById('editor-root');
  if (!root) throw new Error('Missing #editor-root');
  root.classList.remove('is-hidden');
  return root;
}

function renderSession(session: 'editor' | 'projects'): void {
  const host = prepareEditorDom();
  if (!reactRoot) {
    reactRoot = createRoot(host);
  }
  mountGeneration += 1;
  activeSession = session;
  reactRoot.render(
    session === 'projects'
      ? <ProjectsApp key={`projects-${mountGeneration}`} />
      : <EditorApp key={`editor-${mountGeneration}`} />,
  );
}

/** Electron authoring entry — React shell with optional HMR soft remount support. */
export function startEditorSession(): void {
  renderSession('editor');
}

/** AsteronEngine Projects hub — create / open / recent before the editor workspace. */
export function startProjectsSession(): void {
  renderSession('projects');
}

export function disposeEditorSession(): void {
  reactRoot?.unmount();
  reactRoot = null;
  activeSession = null;
  const host = document.getElementById('editor-root');
  host?.replaceChildren();
  host?.classList.add('is-hidden');
}

if (import.meta.hot) {
  import.meta.hot.accept(() => {
    // Soft remount: EditorApp persists snapshot via hot.dispose / unmount cleanup.
    if (activeSession === 'projects') startProjectsSession();
    else startEditorSession();
  });
}
