import type { SceneDocument } from '../world/scenes/schema';
import { resolveScenePlayConfig } from '../world/scenes/scene_runtime';

/**
 * Converts a scene asset into a Play Mode / runtime route.
 * For gameplay scenes, prefers GameObject components (GameManager, Planet,
 * PlayerStart, prefab-instance) over legacy settings.
 */
export function sceneLaunchSearch(document: SceneDocument): string {
  const params = new URLSearchParams();
  params.set('scene', document.id);

  switch (document.kind) {
    case 'title':
      break;
    case 'loading':
      params.set('boot', 'loadingPreview');
      break;
    case 'character-creator':
      params.set('boot', 'characterCreator');
      break;
    case 'sidekick-preview':
      params.set('boot', 'sidekickPreview');
      break;
    case 'main-game': {
      const config = resolveScenePlayConfig(document);
      params.set('boot', 'play');
      params.set('systemId', config.systemId);
      params.set('planetId', config.planetId);
      if (config.spawn === 'surface') params.set('spawn', 'surface');
      if (config.stationPrefabId) {
        params.set('stationPrefab', config.stationPrefabId);
      }
      break;
    }
    case 'instance':
    case 'prefab-stage': {
      const config = resolveScenePlayConfig(document);
      if (config.shipPrefabId || document.settings.prefabKind === 'ship') {
        params.set(
          'shipPrefab',
          config.shipPrefabId ?? document.settings.prefabId ?? '',
        );
      } else {
        params.set('boot', 'play');
        params.set(
          'stationPrefab',
          config.stationPrefabId ?? document.settings.prefabId ?? '',
        );
      }
      break;
    }
  }

  return `/?${params.toString()}`;
}
