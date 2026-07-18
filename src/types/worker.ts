import type { Planet } from './planet';
import type { LakeWaterBuffers, TileInfo } from './terrain';
import type { PlanetDocument } from '../world/planets/schema';

export interface TileWorkerInMessage {
  buildId: number;
  key: string;
  info: TileInfo;
  planet: Planet;
  /** Full planet document so the worker activates the same generation knobs. */
  planetDocument: PlanetDocument;
  seed: number;
}

export interface TileWorkerSuccessMessage {
  buildId: number;
  key: string;
  positions: Float32Array;
  colors: Uint8Array;
  normals: Int16Array;
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

export type WaterWorkerInMessage = TileWorkerInMessage;

export interface WaterWorkerSuccessMessage {
  buildId: number;
  key: string;
  buffers: LakeWaterBuffers | null;
}

export type WaterWorkerErrorMessage = TileWorkerErrorMessage;

export type WaterWorkerOutMessage =
  | TileWorkerReadyMessage
  | WaterWorkerSuccessMessage
  | WaterWorkerErrorMessage;
