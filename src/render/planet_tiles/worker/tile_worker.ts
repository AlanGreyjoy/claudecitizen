import { buildTerrainTileBuffers } from '../build/terrain_buffers';
import type { TileWorkerInMessage, TileWorkerOutMessage } from '../../../types';

// Announce liveness as soon as the module executes. Some embedded browsers
// (e.g. the Cursor in-IDE tab) construct workers that never run and never
// fire an error event; the main thread uses this handshake to detect that
// and fall back to synchronous builds.
const readyMessage: TileWorkerOutMessage = { ready: true };
globalThis.postMessage(readyMessage);

globalThis.onmessage = (event: MessageEvent<TileWorkerInMessage>) => {
  const { buildId, info, key, planet, seed } = event.data;

  try {
    const { colors, normals, positions, uvs, weights0, weights1 } = buildTerrainTileBuffers(
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
      uvs,
      weights0,
      weights1,
    };
    globalThis.postMessage(message, [
      positions.buffer,
      colors.buffer,
      normals.buffer,
      uvs.buffer,
      weights0.buffer,
      weights1.buffer,
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
