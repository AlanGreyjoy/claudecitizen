import { buildTerrainTileBuffers } from '../build/terrain_buffers';
import { activatePlanetDocument } from '../../../world/planets/runtime';
import type { TileWorkerInMessage, TileWorkerOutMessage } from '../../../types';

// Announce liveness as soon as the module executes. Some embedded browsers
// (e.g. the Cursor in-IDE tab) construct workers that never run and never
// fire an error event; the main thread uses this handshake to detect that
// and fall back to synchronous builds.
const readyMessage: TileWorkerOutMessage = { ready: true };
globalThis.postMessage(readyMessage);

globalThis.onmessage = (event: MessageEvent<TileWorkerInMessage>) => {
  const { buildId, info, key, planet, planetDocument, seed } = event.data;

  try {
    if (!planetDocument || typeof planetDocument !== 'object' || !('id' in planetDocument)) {
      throw new Error('tile worker message missing planetDocument');
    }
    activatePlanetDocument(planetDocument);
    const { colors, normals, positions } = buildTerrainTileBuffers(
      info,
      planet,
      seed,
    );
    const message: TileWorkerOutMessage = {
      buildId,
      colors,
      key,
      normals,
      positions,
    };
    globalThis.postMessage(message, [
      positions.buffer,
      colors.buffer,
      normals.buffer,
    ]);
  } catch (error) {
    const message: TileWorkerOutMessage = {
      buildId,
      error: error instanceof Error ? error.message : String(error),
      key,
    };
    globalThis.postMessage(message);
  }
};
