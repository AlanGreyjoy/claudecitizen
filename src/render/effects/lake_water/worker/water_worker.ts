import type { WaterWorkerInMessage, WaterWorkerOutMessage } from '../../../../types';
import { buildLakeWaterGeometry } from '../build/buffers';

const readyMessage: WaterWorkerOutMessage = { ready: true };
globalThis.postMessage(readyMessage);

globalThis.onmessage = (event: MessageEvent<WaterWorkerInMessage>) => {
  const { buildId, info, key, planet, seed } = event.data;

  try {
    const buffers = buildLakeWaterGeometry(info, planet, seed);
    const message: WaterWorkerOutMessage = {
      buffers,
      buildId,
      key,
    };

    if (!buffers) {
      globalThis.postMessage(message);
      return;
    }

    globalThis.postMessage(message, [
      buffers.positions.buffer,
      buffers.barycentrics.buffer,
      buffers.colors.buffer,
      buffers.effectDetails.buffer,
      buffers.normals.buffer,
      buffers.shores.buffer,
      buffers.waterDepths.buffer,
    ]);
  } catch (error) {
    const message: WaterWorkerOutMessage = {
      buildId,
      error: error instanceof Error ? error.message : String(error),
      key,
    };
    globalThis.postMessage(message);
  }
};
