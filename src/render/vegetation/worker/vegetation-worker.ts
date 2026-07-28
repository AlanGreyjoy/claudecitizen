import { activatePlanetDocument } from '../../../world/planets/runtime';
import { configureVegetationDensity } from '../domain/constants';
import { packVegetationInstances } from '../domain/packed-instances';
import { collectTileVegetationData } from '../domain/tile-data';
import type {
  VegetationWorkerInMessage,
  VegetationWorkerOutMessage,
} from '../../../types/vegetation-worker';

// Same startup handshake as the terrain tile worker: some embedded browsers
// construct workers that never run and never fire an error event, so the main
// thread needs positive proof of liveness before it stops building inline.
const readyMessage: VegetationWorkerOutMessage = { ready: true };
globalThis.postMessage(readyMessage);

globalThis.onmessage = (event: MessageEvent<VegetationWorkerInMessage>) => {
  const { assets, buildId, density, info, key, planet, planetDocument, seed, settings } =
    event.data;

  try {
    if (!planetDocument || typeof planetDocument !== 'object' || !('id' in planetDocument)) {
      throw new Error('vegetation worker message missing planetDocument');
    }
    activatePlanetDocument(planetDocument);
    configureVegetationDensity(density);
    const data = collectTileVegetationData(info, planet, seed, assets, settings);
    const grass = packVegetationInstances(data.grass);
    const trees = packVegetationInstances(data.trees);
    const message: VegetationWorkerOutMessage = {
      anchor: data.anchor,
      buildId,
      grass,
      key,
      trees,
    };
    globalThis.postMessage(message, [
      grass.matrices.buffer,
      grass.variantIndices.buffer,
      trees.matrices.buffer,
      trees.variantIndices.buffer,
    ]);
  } catch (error) {
    const message: VegetationWorkerOutMessage = {
      buildId,
      error: error instanceof Error ? error.message : String(error),
      key,
    };
    globalThis.postMessage(message);
  }
};
