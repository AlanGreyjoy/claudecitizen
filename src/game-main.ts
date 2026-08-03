// Before any import that can pull `@takram/three-atmosphere` (LUT idle bind).
import './render/main/post/atmosphere-idle-bypass';
import { passRequiredWebGpuStartupGate } from './app/required-webgpu-gate';

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
async function bootGameEntry(): Promise<void> {
  const canStart = await passRequiredWebGpuStartupGate({
    productName: 'ClaudeCitizen',
  });
  if (!canStart) return;

  const [
    { showLoadingScreen },
    { restoreTitleScreen },
    { startPlaySession },
    { showCharacterCreationScreen },
    { AUTHORING_ENABLED },
    { createSceneHost },
    { loadRuntimeConfig, runtimeConfig },
    { multiplayerDebugDescriptor, prepareMultiplayerDebug },
  ] = await Promise.all([
    import('./app/loading-screen'),
    import('./app/title-screen'),
    import('./app/play-session'),
    import('./app/character-creation-screen'),
    import('./build-mode'),
    import('./app/scene-host'),
    import('./net/runtime-config'),
    import('./app/multiplayer-debug-boot'),
  ]);

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

  function tryBootPreviewRoute(
    params: URLSearchParams,
    boot: string | null,
  ): boolean {
    const launchedScene = params.has('scene');
    const allowPreview = AUTHORING_ENABLED || launchedScene;
    if (!allowPreview) return false;

    const shipPrefabId = params.get('shipPrefab');
    if (shipPrefabId) {
      import('./app/ship-play-session')
        .then((module) => module.startShipPlaySession(shipPrefabId))
        .catch((error) => {
          console.error('ClaudeCitizen ship sandbox failed to load.', error);
        });
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

    createSceneHost({
      initialSceneId: runtimeConfig().bootScene,
      requireAuth: true,
    });
  }

  // Resolve backend config before anything can issue a request. A multiplayer
  // debug window then provisions itself before the scene host asks for a session.
  await loadRuntimeConfig();
  const { setDefaultShipPrefabId } = await import('./world/ships');
  setDefaultShipPrefabId(runtimeConfig().defaultShipPrefab);
  const descriptor = multiplayerDebugDescriptor();
  if (descriptor) {
    await prepareMultiplayerDebug(descriptor).catch((error: unknown) => {
      console.error('[mp-debug] Instance preparation failed.', error);
    });
  }
  bootGame();
}

void bootGameEntry();
