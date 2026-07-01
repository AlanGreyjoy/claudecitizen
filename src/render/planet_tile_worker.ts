import { buildTerrainTileBuffers } from './planet_tile_buffers';
import type { TileWorkerInMessage, TileWorkerOutMessage } from '../types';

globalThis.onmessage = (event: MessageEvent<TileWorkerInMessage>) => {
  const { buildId, info, key, planet, seed } = event.data;

  try {
    const { colors, normals, positions } = buildTerrainTileBuffers(info, planet, seed);
    const message: TileWorkerOutMessage = {
      buildId,
      colors,
      key,
      normals,
      positions,
    };
    globalThis.postMessage(message, [positions.buffer, colors.buffer, normals.buffer]);
  } catch (error) {
    const message: TileWorkerOutMessage = {
      buildId,
      error: error instanceof Error ? error.message : String(error),
      key,
    };
    globalThis.postMessage(message);
  }
};
