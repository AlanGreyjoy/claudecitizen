import type { Planet } from './planet';
import type { TileInfo } from './terrain';

export interface TileWorkerInMessage {
  buildId: number;
  key: string;
  info: TileInfo;
  planet: Planet;
  seed: number;
}

export interface TileWorkerSuccessMessage {
  buildId: number;
  key: string;
  positions: Float32Array;
  colors: Float32Array;
  normals: Float32Array;
  uvs: Float32Array;
  weights0: Float32Array;
  weights1: Float32Array;
}

export interface TileWorkerErrorMessage {
  buildId: number;
  key: string;
  error: string;
}

/** Startup handshake proving the worker script actually executes. */
export interface TileWorkerReadyMessage {
  ready: true;
}

export type TileWorkerOutMessage =
  | TileWorkerReadyMessage
  | TileWorkerSuccessMessage
  | TileWorkerErrorMessage;
