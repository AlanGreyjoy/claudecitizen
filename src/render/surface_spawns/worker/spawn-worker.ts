import { activatePlanetDocument } from '../../../world/planets/runtime';
import { collectTileSurfaceSpawns } from '../../../world/surface_spawns';
import type {
  SurfaceSpawnWorkerInMessage,
  SurfaceSpawnWorkerOutMessage,
} from '../../../types/surface_spawn_worker';

const readyMessage: SurfaceSpawnWorkerOutMessage = { ready: true };
globalThis.postMessage(readyMessage);

globalThis.onmessage = (event: MessageEvent<SurfaceSpawnWorkerInMessage>) => {
  const { buildId, key, info, planet, planetDocument, seed, catalog } = event.data;

  try {
    if (!planetDocument || typeof planetDocument !== 'object' || !('id' in planetDocument)) {
      throw new Error('spawn worker message missing planetDocument');
    }
    if (!catalog || typeof catalog !== 'object' || !Array.isArray(catalog.entries)) {
      throw new Error('spawn worker message missing catalog');
    }
    activatePlanetDocument(planetDocument);
    const instances = collectTileSurfaceSpawns(info, planet, seed, catalog);
    const message: SurfaceSpawnWorkerOutMessage = {
      buildId,
      key,
      instances,
    };
    globalThis.postMessage(message);
  } catch (error) {
    const message: SurfaceSpawnWorkerOutMessage = {
      buildId,
      key,
      error: error instanceof Error ? error.message : String(error),
    };
    globalThis.postMessage(message);
  }
};
