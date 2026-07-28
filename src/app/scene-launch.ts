import type { SceneDocument } from '../world/scenes/schema';
import { resolveScenePlayConfig } from '../world/scenes/scene-runtime';

/**
 * Converts a scene asset into a runtime route for surfaces that still navigate
 * by URL (the external Play Mode window and editor tab previews). In-process
 * scene switching goes through `scene_host.ts` instead.
 */
export function sceneLaunchSearch(document: SceneDocument): string {
  const params = new URLSearchParams();
  params.set('scene', document.id);

  switch (document.kind) {
    // Both entry surfaces boot the scene host, which resolves the flow itself.
    case 'boot':
    case 'title':
      break;
    case 'loading':
      params.set('boot', 'loadingPreview');
      break;
    case 'character-creator':
      params.set('boot', 'characterCreator');
      break;
    case 'main-game': {
      const config = resolveScenePlayConfig(document);
      params.set('boot', 'play');
      if (config.systemId) params.set('systemId', config.systemId);
      if (config.planetId) params.set('planetId', config.planetId);
      if (config.spawn === 'surface') params.set('spawn', 'surface');
      if (config.stationPrefabId) {
        params.set('stationPrefab', config.stationPrefabId);
      }
      break;
    }
    case 'instance':
    case 'prefab-stage': {
      const config = resolveScenePlayConfig(document);
      if (config.shipPrefabId) {
        params.set('shipPrefab', config.shipPrefabId);
      } else {
        params.set('boot', 'play');
        params.set('stationPrefab', config.stationPrefabId ?? '');
      }
      break;
    }
  }

  return `/?${params.toString()}`;
}
