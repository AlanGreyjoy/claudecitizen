import { startEditorSession, startProjectsSession } from './editor/editor-session';
import { loadRuntimeConfig } from './net/runtime-config';

/**
 * AsteronEngine editor renderer entry (`editor.html`).
 *
 * The Electron shell picks the surface with `?boot=projects` for the Projects
 * hub and `?boot=editor` once a project root is bound.
 */
const boot = new URLSearchParams(window.location.search).get('boot');

// React's dev build emits a `performance.measure` per render for the DevTools
// performance track, and the browser never evicts those entries — a long editor
// session grows the buffer until allocation fails ("DataCloneError: Failed to
// execute 'measure' on 'Performance': ... out of memory"). Nothing here reads
// the buffer outside an active profiling capture, so drop it periodically.
if (import.meta.env.DEV) {
  window.setInterval(() => {
    performance.clearMeasures();
    performance.clearMarks();
  }, 30_000);
}

// The Projects hub has no project bound yet, so backend config only resolves
// once the editor workspace opens.
if (boot === 'projects') {
  startProjectsSession();
} else {
  void loadRuntimeConfig().then(startEditorSession);
}
