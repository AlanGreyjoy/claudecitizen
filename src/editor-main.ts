import { startEditorSession, startProjectsSession } from './editor/editor-session';
import { loadRuntimeConfig } from './net/runtime-config';

/**
 * AsteronEngine editor renderer entry (`editor.html`).
 *
 * The Electron shell picks the surface with `?boot=projects` for the Projects
 * hub and `?boot=editor` once a project root is bound.
 */
const boot = new URLSearchParams(window.location.search).get('boot');

// The Projects hub has no project bound yet, so backend config only resolves
// once the editor workspace opens.
if (boot === 'projects') {
  startProjectsSession();
} else {
  void loadRuntimeConfig().then(startEditorSession);
}
