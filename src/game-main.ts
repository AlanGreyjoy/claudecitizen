import { showLoadingScreen } from './app/loading-screen';
import { restoreTitleScreen } from './app/title-screen';
import { startPlaySession } from './app/play-session';
import { showCharacterCreationScreen } from './app/character-creation-screen';
import { AUTHORING_ENABLED } from './build-mode';
import { createSceneHost } from './app/scene-host';
import { loadRuntimeConfig, runtimeConfig } from './net/runtime-config';
import {
  multiplayerDebugDescriptor,
  prepareMultiplayerDebug,
} from './app/multiplayer-debug-boot';

/**
 * Game runtime entry (`index.html`).
 *
 * This is the surface that File → Build Web ships and that in-editor Play
 * loads. Authoring surfaces live in `editor.html` / `editor-main.ts`.
 *
 * The default entry hands control to the scene host, which loads the `title`
 * scene and follows the `ui-screen` / `scene-link` GameObjects from there. The
 * remaining routes are editor previews that launch a single surface directly
 * from URL params.
 *
 *   (default)                          — scene host, starting at the boot scene
 *   ?boot=scene&sceneId=               — scene host, starting at that scene
 *   ?boot=play                         — direct playtest from URL params
 *   ?boot=play&planetId=&spawn=surface — planet surface playtest
 *   ?boot=play&systemId=               — system playtest
 *   ?boot=characterCreator             — character creator preview
 *   ?boot=loadingPreview&scene=        — loading screen preview
 *   ?stationPrefab=<id>                — station prefab playtest
 *   ?shipPrefab=<id>                   — ship sandbox
 */
function startPlaytest(): void {
  const loading = showLoadingScreen();
  void startPlaySession(loading, { requireAuth: false }).catch((error) => {
    console.error('ClaudeCitizen play session failed to start.', error);
    loading.hide();
    restoreTitleScreen(null);
  });
}

function showLoadingPreview(sceneId: string | null): void {
  const loading = showLoadingScreen();
  loading.setStatus(`Loading ${sceneId ?? 'scene'}...`);
  loading.setProgress(0.42);
}

/** Editor preview deep links. Returns true when a route was handled. */
function tryBootPreviewRoute(params: URLSearchParams, boot: string | null): boolean {
  const launchedScene = params.has('scene');
  const allowPreview = AUTHORING_ENABLED || launchedScene;
  if (!allowPreview) return false;

  const shipPrefabId = params.get('shipPrefab');
  if (shipPrefabId) {
    import('./app/ship-play-session')
      .then((module) => module.startShipPlaySession(shipPrefabId))
      .catch((error) => console.error('ClaudeCitizen ship sandbox failed to load.', error));
    return true;
  }
  if (boot === 'loadingPreview' && launchedScene) {
    showLoadingPreview(params.get('scene'));
    return true;
  }
  if (boot === 'characterCreator') {
    void showCharacterCreationScreen();
    return true;
  }
  if (boot === 'play' || params.has('stationPrefab')) {
    startPlaytest();
    return true;
  }
  return false;
}

function bootGame(): void {
  const params = new URLSearchParams(window.location.search);
  const boot = params.get('boot');

  if (boot === 'scene') {
    const sceneId = params.get('sceneId');
    if (!sceneId) {
      console.error('Scene launch requires ?sceneId=<id>.');
      return;
    }
    createSceneHost({ initialSceneId: sceneId, requireAuth: true });
    return;
  }
  if (tryBootPreviewRoute(params, boot)) return;

  createSceneHost({ initialSceneId: runtimeConfig().bootScene, requireAuth: true });
}

// Resolve the backend URL before anything can issue a request. A multiplayer
// debug window then provisions itself before the scene host asks for a session.
void loadRuntimeConfig().then(async () => {
  const descriptor = multiplayerDebugDescriptor();
  if (descriptor) {
    await prepareMultiplayerDebug(descriptor).catch((error: unknown) => {
      console.error('[mp-debug] Instance preparation failed.', error);
    });
  }
  bootGame();
});
